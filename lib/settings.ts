/**
 * Server-only helpers to read settings from DB (e.g. for OpenAI calls).
 * Never expose raw keys to the client.
 */

import { pool, queryWithRetry } from '@/lib/db/client';
import { log } from '@/lib/logger';

export const SETTING_OPENAI_API_KEY = 'openai_api_key';
export const SETTING_PERSONA_DAYS_BACK = 'persona_days_back';
export const SETTING_PERSONA_MAX_MESSAGES = 'persona_max_messages';
export const SETTING_PERSONA_MAX_REACTIONS = 'persona_max_reactions';
export const SETTING_PERSONA_INCLUDE_BIO = 'persona_include_bio';
export const SETTING_PERSONA_OPENAI_MODEL = 'persona_openai_model';
export const SETTING_PERSONA_SYSTEM_PROMPT = 'persona_system_prompt';
export const SETTING_PERSONA_USER_PROMPT_TEMPLATE = 'persona_user_prompt_template';
export const SETTING_PERSONA_MAX_TEXT_LEN = 'persona_max_text_len';
export const SETTING_PERSONA_SCHEMA_DESCRIPTIONS = 'persona_schema_descriptions';
export const SETTING_UI_LIST_LIMIT_AI_USAGE = 'ui_list_limit_ai_usage';
export const SETTING_UI_LIST_LIMIT_MESSAGES_PAGE = 'ui_list_limit_messages_page';
export const SETTING_UI_LIST_LIMIT_PERIOD_DETAIL = 'ui_list_limit_period_detail';
export const SETTING_UI_PERSONA_LABELS = 'ui_persona_labels';
export const SETTING_CACHE_TTL_STATS_MINUTES = 'cache_ttl_stats_minutes';
export const SETTING_INGEST_MAIN_CHAT_SLUG = 'ingest_main_chat_slug';
export const SETTING_PERSONA_CHAT_IDS = 'persona_chat_ids';
export const SETTING_DAY_INSIGHT_SYSTEM_PROMPT = 'day_insight_system_prompt';
export const SETTING_DAY_INSIGHT_USER_PROMPT_TEMPLATE = 'day_insight_user_prompt_template';

export const DEFAULT_PERSONA_MODEL = 'gpt-4o-mini-2024-07-18';
export const DEFAULT_PERSONA_MAX_TEXT_LEN = 500;

/** Default system prompt for persona generation. Seeded into settings on first use if missing. */
export const DEFAULT_PERSONA_SYSTEM_PROMPT = `You are an analyst for a community about money and personal improvement. Given a member's profile, their recent messages (including when they reply to another message — the [REPLY TO: "..."] shows the message they replied to), and what messages they reacted to, produce a structured buyer persona including sales intelligence.

- Do a thorough, intensive analysis. Use as many tokens as needed for a detailed, evidence-based answer.
- Do NOT use generic opening phrases like "X is an enthusiastic member of a money-focused community, actively engaging...". The summary must be factual and specific; if little is known, say so briefly.
- For every inference (topics, content preferences, goals, pain points): when possible, reference the specific message or reaction that supports it (e.g. "Inferred from message on 2026-02-27: '...'" or "Reacts with heart to posts about X — e.g. to '...'").
- Infer age, occupation, and goals only when there is clear evidence; use null otherwise. Extract social links only if mentioned in bio or messages.
- The inference_evidence field is required: write 2–5 bullet points or short paragraphs that explain your key inferences and cite the exact message or reaction (quote or describe) that supports each.

Sales intelligence fields (required — fill for every member):
- buying_intent_score (0–10): how likely this person is to purchase. 0=no signal, 10=actively asking to buy. Most will score 0–4; reserve 7+ for clear purchase intent signals.
- buying_signals: specific phrases or behaviors from their messages showing purchase intent. Empty array if none.
- follow_up_priority: 'hot' (score ≥7 + active), 'warm' (score 4–6 or engaged), 'cold' (low engagement, no signals), 'nurture' (lurker/passive).
- engagement_level: 'champion' (drives conversations, frequent quality posts), 'active' (regular participation), 'passive' (occasional), 'lurker' (rarely or never posts).
- outreach_approach: 1–2 sentences — personalized recommendation for how a sales rep should approach this exact person based on their communication style and interests.
- objection_patterns: likely sales objections inferred from their messages. Empty array if insufficient data.
- spending_capacity: 'high' (mentions significant purchases or high income signals), 'medium', 'low' (frugal signals), 'unknown' (insufficient data).`;

/** Default user prompt template. Use placeholders: {{bio}}, {{messagesBlob}}, {{repliesBlob}}, {{reactionsBlob}}. Seeded into settings on first use if missing. */
export const DEFAULT_PERSONA_USER_PROMPT_TEMPLATE = `## Profile / Bio
{{bio}}

## Recent messages (newest last; [REPLY TO: "…"] shows the message they were replying to)
{{messagesBlob}}

## Reply context (explicit pairs: what they said → what they replied to)
{{repliesBlob}}

## Reactions they gave (emoji + message they reacted to)
{{reactionsBlob}}

Produce the JSON persona for this member. Include inference_evidence with explicit references to messages or reactions.`;

/** Default system prompt for day insight ("why was there activity this day?"). */
export const DEFAULT_DAY_INSIGHT_SYSTEM_PROMPT = `You are an analyst for a community chat. Given a day's messages (and optionally filtered to one member's messages plus the messages they replied to), explain why there was this level of activity that day.

- For "all contacts" scope: explain what drove the conversation (topics, events), why message volume was high or low compared to a typical day, and what the main themes were.
- For "single contact" scope: explain what this person contributed that day, what they were responding to, and what likely motivated their participation.
- Be concise but specific. Reference concrete topics or message content when relevant.`;

/** Default user prompt template for day insight. Placeholders: {{periodLabel}}, {{messageCount}}, {{userCount}}, {{scope}}, {{fromId}}, {{messagesBlob}}. */
export const DEFAULT_DAY_INSIGHT_USER_PROMPT_TEMPLATE = `## Period
{{periodLabel}}

## Scope
{{scope}} ({{scopeDetail}})

## Stats
- Messages in this period: {{messageCount}}
- Unique participants: {{userCount}}

## Messages (chronological)
{{messagesBlob}}

Analyze why there was this level of activity on this day. If scope is "contact", focus on this person's role and what prompted their messages. Return a short summary (2–5 sentences).`;

function decodeSecret(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf8');
}

/** Returns the stored OpenAI API key or null if not set. Use only server-side. */
export async function getOpenAiApiKey(): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1',
    [SETTING_OPENAI_API_KEY]
  );
  if (rows.length === 0) return null;
  return decodeSecret(rows[0].value);
}

export interface PersonaSettings {
  /** Days back for messages/reactions; null = unlimited. */
  daysBack: number | null;
  maxMessages: number;
  maxReactions: number;
  includeBio: boolean;
  /** OpenAI model id for persona (e.g. gpt-4o-mini-2024-07-18). */
  openaiModel: string;
  /** Max characters per message/reaction text when building context. */
  maxTextLen: number;
}

export const DEFAULT_PERSONA_SCHEMA_DESCRIPTIONS: Record<string, string> = {
  summary: 'Factual 1-2 sentence summary. No generic filler like "is an enthusiastic member of a community". Be specific and evidence-based.',
  topics: 'Interests/themes they talk about or react to',
  age_range: 'e.g. 25-35 or null if no evidence',
  occupation: 'What they do or null',
  goals: 'Goals mentioned',
  content_preferences: 'What content they react to; cite specific messages/reactions when inferring (e.g. "Reacts to X — e.g. reacted with heart to \\"...\\"")',
  pain_points: 'Pain points or objections',
  inference_evidence: '2-5 bullet points or short paragraphs: key inferences with explicit references to the message or reaction that supports each (quote or describe the source). Required.',
  buying_intent_score: 'Integer 0–10. 0=no purchase signal, 10=actively asking to buy. Be conservative; most people score 0–4. Use 7+ only with clear explicit purchase intent.',
  buying_signals: 'Array of specific phrases, questions, or behaviors showing purchase intent. E.g. ["Asked about pricing on 2026-01-15", "Commented wanting access"]. Empty array if no signals.',
  follow_up_priority: 'One of: hot (score 7+, actively engaged), warm (score 4-6 or engaged with community), cold (low engagement, no clear signals), nurture (lurker or very passive).',
  engagement_level: 'One of: champion (frequently posts, drives conversations, high quality), active (regular participation), passive (occasional posts), lurker (rarely or never posts).',
  outreach_approach: '1-2 sentences: personalized recommendation for a sales rep on how to approach this exact person, referencing their specific interests, communication style, and pain points.',
  objection_patterns: 'Array of likely sales objections inferred from their communication. E.g. ["Skeptical about pricing", "Prefers free tools"]. Empty array if insufficient data.',
  spending_capacity: 'One of: high (mentions significant purchases or high income signals), medium, low (frugal signals or cost-sensitive language), unknown (insufficient data).',
};

export const DEFAULT_UI_PERSONA_LABELS: Record<string, string> = {
  title: 'AI Buyer Persona',
  generateBtn: 'Generate persona',
  regenerating: 'Regenerating…',
  summary: 'Summary',
  topics: 'Topics / interests',
  inferredProfile: 'Inferred profile',
  contentPreferences: 'Content preferences',
  painPoints: 'Pain points',
  evidence: 'Evidence / reasoning',
  noPersonaYet: 'No persona generated yet. Use AI to build a buyer persona from profile, messages, and reactions.',
};

const PERSONA_KEYS = [SETTING_PERSONA_DAYS_BACK, SETTING_PERSONA_MAX_MESSAGES, SETTING_PERSONA_MAX_REACTIONS, SETTING_PERSONA_INCLUDE_BIO, SETTING_PERSONA_OPENAI_MODEL, SETTING_PERSONA_MAX_TEXT_LEN] as const;

/** Returns persona context settings from DB. Used when building persona context. */
export async function getPersonaSettings(): Promise<PersonaSettings> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key = ANY($1::text[])",
    [PERSONA_KEYS]
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const daysBackRaw = map.get(SETTING_PERSONA_DAYS_BACK);
  const daysBackParsed = daysBackRaw === 'unlimited' || daysBackRaw == null ? null : parseInt(daysBackRaw, 10);
  const daysBack = daysBackParsed != null && !Number.isNaN(daysBackParsed) ? daysBackParsed : null;
  const maxMessages = Math.max(1, parseInt(map.get(SETTING_PERSONA_MAX_MESSAGES) ?? '80', 10) || 80);
  const maxReactions = Math.max(0, parseInt(map.get(SETTING_PERSONA_MAX_REACTIONS) ?? '50', 10) || 50);
  const includeBio = (map.get(SETTING_PERSONA_INCLUDE_BIO) ?? '1') === '1';
  const openaiModel = map.get(SETTING_PERSONA_OPENAI_MODEL)?.trim() || DEFAULT_PERSONA_MODEL;
  const maxTextLen = Math.max(100, Math.min(2000, parseInt(map.get(SETTING_PERSONA_MAX_TEXT_LEN) ?? String(DEFAULT_PERSONA_MAX_TEXT_LEN), 10) || DEFAULT_PERSONA_MAX_TEXT_LEN));
  return {
    daysBack,
    maxMessages,
    maxReactions,
    includeBio,
    openaiModel,
    maxTextLen,
  };
}

/** Returns schema field descriptions for persona JSON (used by OpenAI). Keys: summary, topics, age_range, occupation, goals, content_preferences, pain_points, inference_evidence. */
export async function getPersonaSchemaDescriptions(): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1',
    [SETTING_PERSONA_SCHEMA_DESCRIPTIONS]
  );
  if (rows.length === 0) return { ...DEFAULT_PERSONA_SCHEMA_DESCRIPTIONS };
  try {
    const parsed = JSON.parse(rows[0].value) as Record<string, string>;
    return { ...DEFAULT_PERSONA_SCHEMA_DESCRIPTIONS, ...parsed };
  } catch {
    return { ...DEFAULT_PERSONA_SCHEMA_DESCRIPTIONS };
  }
}

/** List limits for UI (AI usage rows, messages per page, period detail top N). */
export async function getListLimits(): Promise<{ aiUsage: number; messagesPage: number; periodDetail: number }> {
  if (_listLimitsCache && Date.now() < _listLimitsCache.expiresAt) {
    return _listLimitsCache.value;
  }
  const { rows } = await pool.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key = ANY($1::text[])",
    [[SETTING_UI_LIST_LIMIT_AI_USAGE, SETTING_UI_LIST_LIMIT_MESSAGES_PAGE, SETTING_UI_LIST_LIMIT_PERIOD_DETAIL]]
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const aiUsage = Math.max(10, Math.min(500, parseInt(map.get(SETTING_UI_LIST_LIMIT_AI_USAGE) ?? '50', 10) || 50));
  const messagesPage = Math.max(5, Math.min(200, parseInt(map.get(SETTING_UI_LIST_LIMIT_MESSAGES_PAGE) ?? '20', 10) || 20));
  const periodDetail = Math.max(5, Math.min(100, parseInt(map.get(SETTING_UI_LIST_LIMIT_PERIOD_DETAIL) ?? '20', 10) || 20));
  const value = { aiUsage, messagesPage, periodDetail };
  _listLimitsCache = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

/** Persona card labels for UserProfile (title, summary, etc.). */
export async function getPersonaLabels(): Promise<Record<string, string>> {
  if (_personaLabelsCache && Date.now() < _personaLabelsCache.expiresAt) {
    return _personaLabelsCache.value;
  }
  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1',
    [SETTING_UI_PERSONA_LABELS]
  );
  let result: Record<string, string>;
  if (rows.length === 0) {
    result = { ...DEFAULT_UI_PERSONA_LABELS };
  } else {
    try {
      const parsed = JSON.parse(rows[0].value) as Record<string, string>;
      result = { ...DEFAULT_UI_PERSONA_LABELS, ...parsed };
    } catch {
      result = { ...DEFAULT_UI_PERSONA_LABELS };
    }
  }
  _personaLabelsCache = { value: result, expiresAt: Date.now() + 60_000 };
  return result;
}

// Process-level caches so that hot-path callers (overview, users-summary, users-list)
// don't hit the DB on every request. TTLs are intentionally short so settings changes
// propagate within a minute.
let _cacheTtlCache: { value: number; expiresAt: number } | null = null;
let _cacheTtlPromise: Promise<number> | null = null;
let _personaPromptsCache: { value: { systemPrompt: string; userPromptTemplate: string }; expiresAt: number } | null = null;
let _dayInsightPromptsCache: { value: { systemPrompt: string; userPromptTemplate: string }; expiresAt: number } | null = null;
let _listLimitsCache: { value: { aiUsage: number; messagesPage: number; periodDetail: number }; expiresAt: number } | null = null;
let _personaLabelsCache: { value: Record<string, string>; expiresAt: number } | null = null;

/** Stats cache TTL in minutes (1–60). Result is cached in-process for 60 s. */
export async function getCacheTtlStatsMinutes(): Promise<number> {
  if (_cacheTtlCache && Date.now() < _cacheTtlCache.expiresAt) {
    log.db(`[DBG-01a8b2 H6] getCacheTtlStatsMinutes cache hit value=${_cacheTtlCache.value}`);
    return _cacheTtlCache.value;
  }
  if (_cacheTtlPromise) {
    log.db('[DBG-01a8b2 H6] getCacheTtlStatsMinutes join inflight refresh');
    return _cacheTtlPromise;
  }
  log.db('[DBG-01a8b2 H6] getCacheTtlStatsMinutes cache miss');
  _cacheTtlPromise = (async () => {
    const { rows } = await queryWithRetry<{ value: string }>(
      'SELECT value FROM settings WHERE key = $1',
      [SETTING_CACHE_TTL_STATS_MINUTES]
    );
    const raw = rows.length === 0 ? 2 : parseInt(rows[0].value, 10);
    const value = Number.isNaN(raw) ? 2 : Math.max(1, Math.min(60, raw));
    _cacheTtlCache = { value, expiresAt: Date.now() + 60_000 };
    log.db(`[DBG-01a8b2 H6] getCacheTtlStatsMinutes refresh done value=${value}`);
    return value;
  })().finally(() => {
    _cacheTtlPromise = null;
  });
  return _cacheTtlPromise;
}

/** Ingest: slug for the main chat (e.g. "main"). Deprecated: ingest now uses per-chat slug. */
export async function getIngestMainChatSlug(): Promise<string> {
  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1',
    [SETTING_INGEST_MAIN_CHAT_SLUG]
  );
  if (rows.length === 0) return 'main';
  const v = rows[0].value?.trim();
  return v || 'main';
}

/** Chats to include in persona context. Empty array or null = all chats. */
export async function getPersonaChatIds(): Promise<number[] | null> {
  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1',
    [SETTING_PERSONA_CHAT_IDS]
  );
  if (rows.length === 0) return null;
  try {
    const parsed = JSON.parse(rows[0].value);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.map((c: unknown) => Number(c)).filter((n: number) => !Number.isNaN(n) && n > 0);
    return ids.length === 0 ? null : ids;
  } catch {
    return null;
  }
}

/** Returns the OpenAI model id to use for persona generation. */
export async function getPersonaOpenAIModel(): Promise<string> {
  const settings = await getPersonaSettings();
  return settings.openaiModel;
}

/** Returns system prompt and user prompt template for persona. Seeds defaults into settings if missing (e.g. on first deploy). */
export async function getPersonaPrompts(): Promise<{ systemPrompt: string; userPromptTemplate: string }> {
  if (_personaPromptsCache && Date.now() < _personaPromptsCache.expiresAt) {
    return _personaPromptsCache.value;
  }
  const { rows } = await pool.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key = ANY($1::text[])",
    [[SETTING_PERSONA_SYSTEM_PROMPT, SETTING_PERSONA_USER_PROMPT_TEMPLATE]]
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  let systemPrompt = map.get(SETTING_PERSONA_SYSTEM_PROMPT)?.trim();
  let userPromptTemplate = map.get(SETTING_PERSONA_USER_PROMPT_TEMPLATE)?.trim();

  if (!systemPrompt || !userPromptTemplate) {
    if (!systemPrompt) {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO NOTHING`,
        [SETTING_PERSONA_SYSTEM_PROMPT, DEFAULT_PERSONA_SYSTEM_PROMPT]
      );
      systemPrompt = DEFAULT_PERSONA_SYSTEM_PROMPT;
    }
    if (!userPromptTemplate) {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO NOTHING`,
        [SETTING_PERSONA_USER_PROMPT_TEMPLATE, DEFAULT_PERSONA_USER_PROMPT_TEMPLATE]
      );
      userPromptTemplate = DEFAULT_PERSONA_USER_PROMPT_TEMPLATE;
    }
  }

  const result = {
    systemPrompt: systemPrompt ?? DEFAULT_PERSONA_SYSTEM_PROMPT,
    userPromptTemplate: userPromptTemplate ?? DEFAULT_PERSONA_USER_PROMPT_TEMPLATE,
  };
  _personaPromptsCache = { value: result, expiresAt: Date.now() + 60_000 };
  return result;
}

/** Returns system prompt and user prompt template for day insight. Seeds defaults if missing. */
export async function getDayInsightPrompts(): Promise<{ systemPrompt: string; userPromptTemplate: string }> {
  if (_dayInsightPromptsCache && Date.now() < _dayInsightPromptsCache.expiresAt) {
    return _dayInsightPromptsCache.value;
  }
  const { rows } = await pool.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key = ANY($1::text[])",
    [[SETTING_DAY_INSIGHT_SYSTEM_PROMPT, SETTING_DAY_INSIGHT_USER_PROMPT_TEMPLATE]]
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  let systemPrompt = map.get(SETTING_DAY_INSIGHT_SYSTEM_PROMPT)?.trim();
  let userPromptTemplate = map.get(SETTING_DAY_INSIGHT_USER_PROMPT_TEMPLATE)?.trim();

  if (!systemPrompt || !userPromptTemplate) {
    if (!systemPrompt) {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO NOTHING`,
        [SETTING_DAY_INSIGHT_SYSTEM_PROMPT, DEFAULT_DAY_INSIGHT_SYSTEM_PROMPT]
      );
      systemPrompt = DEFAULT_DAY_INSIGHT_SYSTEM_PROMPT;
    }
    if (!userPromptTemplate) {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO NOTHING`,
        [SETTING_DAY_INSIGHT_USER_PROMPT_TEMPLATE, DEFAULT_DAY_INSIGHT_USER_PROMPT_TEMPLATE]
      );
      userPromptTemplate = DEFAULT_DAY_INSIGHT_USER_PROMPT_TEMPLATE;
    }
  }

  const result = {
    systemPrompt: systemPrompt ?? DEFAULT_DAY_INSIGHT_SYSTEM_PROMPT,
    userPromptTemplate: userPromptTemplate ?? DEFAULT_DAY_INSIGHT_USER_PROMPT_TEMPLATE,
  };
  _dayInsightPromptsCache = { value: result, expiresAt: Date.now() + 60_000 };
  return result;
}
