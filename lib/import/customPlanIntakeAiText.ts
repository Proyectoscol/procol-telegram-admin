/**
 * AI-based free-text parser for the Custom Plan Intake Form import — an
 * alternative to uploading the Google Forms PDF, for admins who received a
 * respondent's answers as a plain message (Telegram DM, welcome message,
 * etc.) instead of a form export. Sends the raw text to OpenAI and asks it
 * to extract the same identity + structured fields the PDF/HTML parsers
 * produce (see lib/import/customPlanIntakeShared.ts), tolerating whatever
 * subset of questions the message actually answers and however it phrases
 * them — unlike the PDF/HTML path, there's no fixed layout to key off of.
 *
 * Never auto-creates or guesses an identity: if neither a Telegram handle
 * nor an email is found in the text, the caller (customPlanIntake.ts) routes
 * the entry to the review queue same as an unmatched PDF.
 */
import { getOpenAiApiKey, getPersonaOpenAIModel } from '@/lib/settings';
import { emptyCustomPlanIntakeParsed, type CustomPlanIntakeParsed, type SkillScores } from '@/lib/import/customPlanIntakeShared';

const SYSTEM_PROMPT = `You extract structured intake data from a freeform welcome/intake message sent by a new member of a paid community, so it can be matched to their CRM contact and saved. The message answers some or all of the topics below, in any order, using casual language — not necessarily formal question wording. Only fill a field when the text actually supports it; leave anything not mentioned as null. Never invent values.

Topics to look for:
- Telegram @handle and/or email — CRITICAL, used to find their CRM contact. Look anywhere in the text, including a signature line, for "@something" or an email address.
- Full name
- Country
- Primary income source / what they do for a living
- Niche or industry
- Monthly profit in USD (profit, not revenue)
- Monthly revenue in USD, only if mentioned separately from profit
- Their profit goal for the next 6 months, in USD
- The biggest problem holding them back / what's held them back so far
- Whether they have a sales funnel set up (true/false, only if unambiguous)
- Whether they've run paid ads before (true/false, only if unambiguous)
- Team structure: "ALONE" if they work alone, "CONTRACTORS" if freelancers/contractors, "EMPLOYEES" if they have a team/employees
- Current stage: "NO_AUDIENCE", "AUDIENCE_NO_MONETIZATION", "LOW_SCALE" (monetizing but small scale), or "SCALING_BOTTLENECK" (hitting a growth ceiling) — only if clearly inferable
- Seriousness/commitment score, normalized to a 1-10 integer scale. If the text gives a score out of 100, divide by 10 and round to the nearest integer.
- Skill self-ratings 1-10 for: content creation, copywriting, sales, offer creation, audience growth, branding, marketing, systems & automation — only if explicitly given as numbers

Also return an "extracted_fields" list of {label, value} pairs for every distinct piece of information you pulled out of the message (e.g. {label: "Instagram username", value: "@chielmeester"}), so nothing the message says is lost even if it doesn't map to one of the structured fields above.

Convert currency mentions to a plain number (strip symbols, commas, "k" suffixes → thousands).`;

const RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'custom_plan_intake_text',
    strict: true,
    schema: {
      type: 'object' as const,
      properties: {
        username: { type: ['string', 'null'] as const, description: 'Telegram @handle, without the @.' },
        email: { type: ['string', 'null'] as const },
        full_name: { type: ['string', 'null'] as const },
        country: { type: ['string', 'null'] as const },
        primary_income_source: { type: ['string', 'null'] as const },
        niche: { type: ['string', 'null'] as const },
        monthly_profit_usd: { type: ['number', 'null'] as const },
        monthly_revenue_usd: { type: ['number', 'null'] as const },
        profit_goal_6mo_usd: { type: ['number', 'null'] as const },
        biggest_problem: { type: ['string', 'null'] as const },
        has_sales_funnel: { type: ['boolean', 'null'] as const },
        ran_paid_ads: { type: ['boolean', 'null'] as const },
        team_structure: { type: ['string', 'null'] as const, enum: ['ALONE', 'CONTRACTORS', 'EMPLOYEES', null] },
        current_stage: {
          type: ['string', 'null'] as const,
          enum: ['NO_AUDIENCE', 'AUDIENCE_NO_MONETIZATION', 'LOW_SCALE', 'SCALING_BOTTLENECK', null],
        },
        seriousness_level: { type: ['integer', 'null'] as const },
        skill_scores: {
          type: 'object' as const,
          properties: {
            content_creation: { type: ['integer', 'null'] as const },
            copywriting: { type: ['integer', 'null'] as const },
            sales: { type: ['integer', 'null'] as const },
            offer_creation: { type: ['integer', 'null'] as const },
            audience_growth: { type: ['integer', 'null'] as const },
            branding: { type: ['integer', 'null'] as const },
            marketing: { type: ['integer', 'null'] as const },
            systems_automation: { type: ['integer', 'null'] as const },
          },
          required: [
            'content_creation', 'copywriting', 'sales', 'offer_creation',
            'audience_growth', 'branding', 'marketing', 'systems_automation',
          ],
          additionalProperties: false,
        },
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
        'username', 'email', 'full_name', 'country', 'primary_income_source', 'niche',
        'monthly_profit_usd', 'monthly_revenue_usd', 'profit_goal_6mo_usd', 'biggest_problem',
        'has_sales_funnel', 'ran_paid_ads', 'team_structure', 'current_stage', 'seriousness_level',
        'skill_scores', 'extracted_fields',
      ],
      additionalProperties: false,
    },
  },
};

interface AiExtraction {
  username: string | null;
  email: string | null;
  full_name: string | null;
  country: string | null;
  primary_income_source: string | null;
  niche: string | null;
  monthly_profit_usd: number | null;
  monthly_revenue_usd: number | null;
  profit_goal_6mo_usd: number | null;
  biggest_problem: string | null;
  has_sales_funnel: boolean | null;
  ran_paid_ads: boolean | null;
  team_structure: string | null;
  current_stage: string | null;
  seriousness_level: number | null;
  skill_scores: SkillScores;
  extracted_fields: { label: string; value: string }[];
}

/** Parses one respondent's freeform text into the same shape the PDF/HTML parsers produce. Throws if no OpenAI key is configured or the call fails. */
export async function parseCustomPlanIntakeText(text: string): Promise<CustomPlanIntakeParsed> {
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

  const base = emptyCustomPlanIntakeParsed();
  const warnings: string[] = [];
  if (!ai.username && !ai.email) {
    warnings.push('AI could not find a Telegram handle or email in the text — include one so this can be matched to a member.');
  }

  const rawAnswers: Record<string, string> = { 'Raw message': trimmed };
  for (const f of ai.extracted_fields ?? []) {
    if (f.label && f.value) rawAnswers[f.label] = f.value;
  }

  return {
    ...base,
    name: ai.full_name,
    username: ai.username ? ai.username.trim().replace(/^@/, '') : null,
    telegramId: null,
    email: ai.email ? ai.email.trim().toLowerCase() : null,
    fullName: ai.full_name,
    country: ai.country,
    qa: (ai.extracted_fields ?? []).map((f) => ({ question: f.label, answer: f.value })),
    rawAnswers,
    structured: {
      primaryIncomeSource: ai.primary_income_source,
      monthlyProfitUsd: ai.monthly_profit_usd,
      monthlyRevenueUsd: ai.monthly_revenue_usd,
      profitGoal6moUsd: ai.profit_goal_6mo_usd,
      niche: ai.niche,
      biggestProblem: ai.biggest_problem,
      hasSalesFunnel: ai.has_sales_funnel,
      ranPaidAds: ai.ran_paid_ads,
      teamStructure: ai.team_structure,
      seriousnessLevel: ai.seriousness_level,
      currentStage: ai.current_stage,
      skillScores: ai.skill_scores ?? base.structured.skillScores,
    },
    warnings,
  };
}
