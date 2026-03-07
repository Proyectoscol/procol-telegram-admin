/**
 * OpenAI Chat Completions helper for persona generation.
 * Uses getOpenAiApiKey() from settings. Server-only.
 */

import { getOpenAiApiKey, getPersonaOpenAIModel, getPersonaPrompts, getPersonaSchemaDescriptions } from '@/lib/settings';

export interface PersonaOutput {
  summary: string;
  topics: string[];
  inferred_profile: {
    age_range: string | null;
    occupation: string | null;
    goals: string[];
  };
  social_links: {
    instagram: string | null;
    twitter: string | null;
    linkedin: string | null;
    other: string[];
  };
  content_preferences: string;
  pain_points: string[];
  /** Key inferences with references to specific messages or reactions that support them. */
  inference_evidence: string;
}

export interface PersonaCompletionResult {
  data: PersonaOutput;
  usage: { model: string; prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function buildPersonaJsonSchema(descriptions: Record<string, string>) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: 'persona',
      strict: true,
      schema: {
        type: 'object' as const,
        properties: {
          summary: { type: 'string' as const, description: descriptions.summary ?? '' },
          topics: { type: 'array' as const, items: { type: 'string' as const }, description: descriptions.topics ?? '' },
          inferred_profile: {
            type: 'object' as const,
            properties: {
              age_range: { type: ['string', 'null'] as const, description: descriptions.age_range ?? '' },
              occupation: { type: ['string', 'null'] as const, description: descriptions.occupation ?? '' },
              goals: { type: 'array' as const, items: { type: 'string' as const }, description: descriptions.goals ?? '' },
            },
            required: ['age_range', 'occupation', 'goals'],
            additionalProperties: false,
          },
          social_links: {
            type: 'object' as const,
            properties: {
              instagram: { type: ['string', 'null'] as const },
              twitter: { type: ['string', 'null'] as const },
              linkedin: { type: ['string', 'null'] as const },
              other: { type: 'array' as const, items: { type: 'string' as const } },
            },
            required: ['instagram', 'twitter', 'linkedin', 'other'],
            additionalProperties: false,
          },
          content_preferences: { type: 'string' as const, description: descriptions.content_preferences ?? '' },
          pain_points: { type: 'array' as const, items: { type: 'string' as const }, description: descriptions.pain_points ?? '' },
          inference_evidence: { type: 'string' as const, description: descriptions.inference_evidence ?? '' },
        },
        required: ['summary', 'topics', 'inferred_profile', 'social_links', 'content_preferences', 'pain_points', 'inference_evidence'],
        additionalProperties: false,
      },
    },
  };
}

export async function generatePersona(context: {
  bio: string;
  messagesBlob: string;
  repliesBlob: string;
  reactionsBlob: string;
}): Promise<PersonaCompletionResult> {
  const [apiKey, model, prompts, schemaDescriptions] = await Promise.all([
    getOpenAiApiKey(),
    getPersonaOpenAIModel(),
    getPersonaPrompts(),
    getPersonaSchemaDescriptions(),
  ]);
  if (!apiKey) {
    throw new Error('OpenAI API key not configured in Settings');
  }
  const modelToUse = model?.trim() || 'gpt-4o-mini-2024-07-18';

  const userPrompt = prompts.userPromptTemplate
    .replace(/\{\{bio\}\}/g, context.bio)
    .replace(/\{\{messagesBlob\}\}/g, context.messagesBlob)
    .replace(/\{\{repliesBlob\}\}/g, context.repliesBlob)
    .replace(/\{\{reactionsBlob\}\}/g, context.reactionsBlob);

  const response_format = buildPersonaJsonSchema(schemaDescriptions);
  const body = {
    model: modelToUse,
    messages: [
      { role: 'system' as const, content: prompts.systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ],
    response_format,
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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
  const choice = data.choices?.[0];
  if (!choice?.message?.content) {
    throw new Error('OpenAI returned no content');
  }

  let parsed: PersonaOutput;
  try {
    parsed = JSON.parse(choice.message.content) as PersonaOutput;
  } catch {
    throw new Error('OpenAI response was not valid JSON');
  }

  const usage = data.usage ?? {};
  return {
    data: parsed,
    usage: {
      model: data.model ?? modelToUse,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    },
  };
}

// --- Relationship summary (interactions between two members) ---

export interface RelationshipSummaryOutput {
  summary: string;
  tone: string;
  mutual_or_one_sided: string;
  evolution: string;
  inference_evidence: string;
}

export interface RelationshipSummaryResult {
  data: RelationshipSummaryOutput;
  usage: { model: string; prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const RELATIONSHIP_SYSTEM_PROMPT = `You are an analyst for a community. You will be given two members and their interactions — messages where they reply to each other, and reactions they give to each other's messages — and must produce a short relationship summary.

- Always refer to the two members by their real names (as provided in the prompt). Do not use "A", "B", "Member A", or "Member B" in your summary, tone, evolution, or inference_evidence.
- Focus on: what they tend to engage on (topics), the tone of their exchanges, whether the engagement is mutual or one-sided, and how it has evolved over time.
- Be specific and evidence-based. For each claim, reference the exact message or reaction (quote or describe) that supports it, using the members' real names.
- The inference_evidence field is required: 2–4 bullet points that cite specific messages or reactions (dates, quotes) as proof, using the members' real names.`;

const RELATIONSHIP_USER_PROMPT_TEMPLATE = `Member 1: {{memberAName}}
Member 2: {{memberBName}}

## Messages between them (chronological; [REPLY TO X: "…"] = reply context)
{{messagesBetweenBlob}}

## Reactions {{memberAName}} gave to {{memberBName}}'s messages
{{reactionsAtoBBlob}}

## Reactions {{memberBName}} gave to {{memberAName}}'s messages
{{reactionsBtoABlob}}

## Reply pairs (who replied to whom and to what)
{{repliesBlob}}

Produce the JSON relationship summary: summary, tone, mutual_or_one_sided, evolution, inference_evidence. Use the members' real names ({{memberAName}} and {{memberBName}}) throughout your summary and evidence — never use "A" or "B".`;

export async function generateRelationshipSummary(context: import('@/lib/ai/relationship-context').RelationshipContext): Promise<RelationshipSummaryResult> {
  const [apiKey, model] = await Promise.all([getOpenAiApiKey(), getPersonaOpenAIModel()]);
  if (!apiKey) throw new Error('OpenAI API key not configured in Settings');
  const modelToUse = model?.trim() || 'gpt-4o-mini-2024-07-18';

  const userPrompt = RELATIONSHIP_USER_PROMPT_TEMPLATE
    .replace(/\{\{memberAName\}\}/g, context.memberAName)
    .replace(/\{\{memberBName\}\}/g, context.memberBName)
    .replace(/\{\{messagesBetweenBlob\}\}/g, context.messagesBetweenBlob)
    .replace(/\{\{reactionsAtoBBlob\}\}/g, context.reactionsAtoBBlob)
    .replace(/\{\{reactionsBtoABlob\}\}/g, context.reactionsBtoABlob)
    .replace(/\{\{repliesBlob\}\}/g, context.repliesBlob);

  const response_format = {
    type: 'json_schema' as const,
    json_schema: {
      name: 'relationship_summary',
      strict: true,
      schema: {
        type: 'object' as const,
        properties: {
          summary: { type: 'string' as const, description: 'Short summary of the relationship and how they interact.' },
          tone: { type: 'string' as const, description: 'Tone of their exchanges (e.g. supportive, playful, professional).' },
          mutual_or_one_sided: { type: 'string' as const, description: 'Whether engagement is mutual or mostly one-sided; briefly explain.' },
          evolution: { type: 'string' as const, description: 'How the interaction has evolved over time if visible from the data.' },
          inference_evidence: { type: 'string' as const, description: '2-4 bullet points citing specific messages or reactions as proof.' },
        },
        required: ['summary', 'tone', 'mutual_or_one_sided', 'evolution', 'inference_evidence'],
        additionalProperties: false,
      },
    },
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelToUse,
      messages: [
        { role: 'system' as const, content: RELATIONSHIP_SYSTEM_PROMPT },
        { role: 'user' as const, content: userPrompt },
      ],
      response_format,
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
  const choice = data.choices?.[0];
  if (!choice?.message?.content) throw new Error('OpenAI returned no content');

  let parsed: RelationshipSummaryOutput;
  try {
    parsed = JSON.parse(choice.message.content) as RelationshipSummaryOutput;
  } catch {
    throw new Error('OpenAI response was not valid JSON');
  }

  const usage = data.usage ?? {};
  return {
    data: parsed,
    usage: {
      model: data.model ?? modelToUse,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    },
  };
}
