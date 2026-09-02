/**
 * AI-based free-text parser for the Welcome questionnaire import — an
 * alternative to the CSV export, for admins who have a member's welcome
 * message/intro (a Telegram DM, an intro post, etc.) instead of a form
 * response row. Sends the raw text to OpenAI and asks it to extract the
 * same fields the CSV importer keys off of by header (see
 * lib/import/questionnaireImport.ts), regardless of how the message is
 * structured — numbered Q&A, a free paragraph, or anything in between.
 *
 * Never auto-creates or guesses an identity: if neither a Telegram handle
 * nor an email is found, the caller routes the entry to the review queue
 * same as an unmatched CSV row.
 */
import { getOpenAiApiKey, getPersonaOpenAIModel } from '@/lib/settings';
import type { QuestionnaireRow } from '@/lib/import/questionnaireImport';

const SYSTEM_PROMPT = `You extract structured info from a new community member's welcome message or intro, so it can be matched to their CRM contact and saved. The message may answer numbered questions, or just be a free-flowing intro paragraph — extract whatever the text actually supports and leave the rest null. Never invent values.

Fields to look for:
- Telegram @handle and/or email — CRITICAL, used to find their CRM contact. Look anywhere in the text, including a signature line, for "@something" or an email address.
- Full name
- Age range (e.g. an age, birthday, or age bracket if given)
- Location (country and/or city they're from or live in)
- Their goals (what they want to achieve, e.g. over the next months)
- Their business/occupation/niche (what they do for a living, their industry)
- Why they joined / what they're hoping to get out of the community

Also return an "extracted_fields" list of {label, value} pairs for every other distinct piece of information in the message that doesn't fit the fields above (e.g. Instagram handle, gym habits, a favorite quote), so nothing is lost.`;

const RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'questionnaire_text',
    strict: true,
    schema: {
      type: 'object' as const,
      properties: {
        username: { type: ['string', 'null'] as const, description: 'Telegram @handle, without the @.' },
        email: { type: ['string', 'null'] as const },
        full_name: { type: ['string', 'null'] as const },
        age_range: { type: ['string', 'null'] as const },
        location: { type: ['string', 'null'] as const },
        goals: { type: ['string', 'null'] as const },
        business: { type: ['string', 'null'] as const },
        why_joined: { type: ['string', 'null'] as const },
        extracted_fields: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: { label: { type: 'string' as const }, value: { type: 'string' as const } },
            required: ['label', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: [
        'username', 'email', 'full_name', 'age_range', 'location', 'goals', 'business',
        'why_joined', 'extracted_fields',
      ],
      additionalProperties: false,
    },
  },
};

interface AiExtraction {
  username: string | null;
  email: string | null;
  full_name: string | null;
  age_range: string | null;
  location: string | null;
  goals: string | null;
  business: string | null;
  why_joined: string | null;
  extracted_fields: { label: string; value: string }[];
}

/** Parses one member's freeform welcome message into the same shape the CSV importer produces. Throws if no OpenAI key is configured or the call fails. */
export async function parseQuestionnaireText(text: string): Promise<QuestionnaireRow> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Empty text.');

  const apiKey = await getOpenAiApiKey();
  if (!apiKey) throw new Error('OpenAI API key not configured in Settings — required to parse pasted text.');
  const model = (await getPersonaOpenAIModel())?.trim() || 'gpt-4o-mini-2024-07-18';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system' as const, content: SYSTEM_PROMPT },
        { role: 'user' as const, content: trimmed },
      ],
      response_format: RESPONSE_FORMAT,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    let message = `OpenAI API error ${res.status}`;
    try {
      const j = JSON.parse(errBody);
      if (j.error?.message) message = j.error.message;
    } catch {
      if (errBody) message = errBody.slice(0, 200);
    }
    throw new Error(message);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no content');

  let ai: AiExtraction;
  try {
    ai = JSON.parse(content) as AiExtraction;
  } catch {
    throw new Error('OpenAI response was not valid JSON');
  }

  const rawAnswers: Record<string, string> = { 'Raw message': trimmed };
  for (const f of ai.extracted_fields ?? []) {
    if (f.label && f.value) rawAnswers[f.label] = f.value;
  }

  return {
    name: ai.full_name,
    username: ai.username ? ai.username.trim().replace(/^@/, '') : null,
    telegramId: null,
    email: ai.email ? ai.email.trim().toLowerCase() : null,
    ageRange: ai.age_range,
    location: ai.location,
    goals: ai.goals,
    business: ai.business,
    whyJoined: ai.why_joined,
    rawAnswers,
  };
}
