import { ensureSchema, queryWithRetry } from '@/lib/db/client';
import { getOrFetch } from '@/lib/cache';
import {
  SETTING_OPENAI_API_KEY,
  SETTING_PERSONA_DAYS_BACK,
  SETTING_PERSONA_MAX_MESSAGES,
  SETTING_PERSONA_MAX_REACTIONS,
  SETTING_PERSONA_INCLUDE_BIO,
  SETTING_PERSONA_OPENAI_MODEL,
  SETTING_PERSONA_SYSTEM_PROMPT,
  SETTING_PERSONA_USER_PROMPT_TEMPLATE,
  SETTING_PERSONA_MAX_TEXT_LEN,
  SETTING_PERSONA_SCHEMA_DESCRIPTIONS,
  SETTING_UI_LIST_LIMIT_AI_USAGE,
  SETTING_UI_LIST_LIMIT_MESSAGES_PAGE,
  SETTING_UI_LIST_LIMIT_PERIOD_DETAIL,
  SETTING_UI_PERSONA_LABELS,
  SETTING_CACHE_TTL_STATS_MINUTES,
  SETTING_INGEST_MAIN_CHAT_SLUG,
  SETTING_PERSONA_CHAT_IDS,
  SETTING_DAY_INSIGHT_SYSTEM_PROMPT,
  SETTING_DAY_INSIGHT_USER_PROMPT_TEMPLATE,
  DEFAULT_PERSONA_MODEL,
  DEFAULT_PERSONA_SYSTEM_PROMPT,
  DEFAULT_PERSONA_USER_PROMPT_TEMPLATE,
  DEFAULT_PERSONA_MAX_TEXT_LEN,
  DEFAULT_PERSONA_SCHEMA_DESCRIPTIONS,
  DEFAULT_UI_PERSONA_LABELS,
  DEFAULT_DAY_INSIGHT_SYSTEM_PROMPT,
  DEFAULT_DAY_INSIGHT_USER_PROMPT_TEMPLATE,
  getPersonaPrompts,
  getDayInsightPrompts,
} from '@/lib/settings';
import { getTopMessagesDefaultAuthor } from '@/lib/data/top-messages';
import { PERSONA_MODEL_OPTIONS } from '@/lib/ai/model-pricing';

const PERSONA_KEYS_FOR_GET = [
  SETTING_PERSONA_DAYS_BACK,
  SETTING_PERSONA_MAX_MESSAGES,
  SETTING_PERSONA_MAX_REACTIONS,
  SETTING_PERSONA_INCLUDE_BIO,
  SETTING_PERSONA_OPENAI_MODEL,
  SETTING_PERSONA_SYSTEM_PROMPT,
  SETTING_PERSONA_USER_PROMPT_TEMPLATE,
  SETTING_PERSONA_MAX_TEXT_LEN,
  SETTING_PERSONA_SCHEMA_DESCRIPTIONS,
  SETTING_UI_LIST_LIMIT_AI_USAGE,
  SETTING_UI_LIST_LIMIT_MESSAGES_PAGE,
  SETTING_UI_LIST_LIMIT_PERIOD_DETAIL,
  SETTING_UI_PERSONA_LABELS,
  SETTING_CACHE_TTL_STATS_MINUTES,
  SETTING_INGEST_MAIN_CHAT_SLUG,
  SETTING_PERSONA_CHAT_IDS,
  SETTING_DAY_INSIGHT_SYSTEM_PROMPT,
  SETTING_DAY_INSIGHT_USER_PROMPT_TEMPLATE,
];

const SETTINGS_DATA_CACHE_KEY = 'settings-data';
const SETTINGS_DATA_TTL_MS = 60_000;

/** Returns full settings payload for GET /api/settings. Seeds default prompts if missing. Cached 60s to avoid pool pressure. */
export async function getSettingsData(): Promise<Record<string, unknown>> {
  return getOrFetch<Record<string, unknown>>(SETTINGS_DATA_CACHE_KEY, async () => {
    await ensureSchema();
    await getPersonaPrompts();
    await getDayInsightPrompts();
    const topMessagesDefaultAuthor = await getTopMessagesDefaultAuthor();
    const openaiRows = await queryWithRetry<{ key: string }>('SELECT key FROM settings WHERE key = $1', [SETTING_OPENAI_API_KEY]);
    const personaRows = await queryWithRetry<{ key: string; value: string }>(
      'SELECT key, value FROM settings WHERE key = ANY($1::text[])',
      [PERSONA_KEYS_FOR_GET]
    );
    const map = new Map((personaRows.rows as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    return {
    openai_api_key_configured: openaiRows.rows.length > 0,
    persona_days_back: map.get(SETTING_PERSONA_DAYS_BACK) ?? 'unlimited',
    persona_max_messages: map.get(SETTING_PERSONA_MAX_MESSAGES) ?? '80',
    persona_max_reactions: map.get(SETTING_PERSONA_MAX_REACTIONS) ?? '50',
    persona_include_bio: (map.get(SETTING_PERSONA_INCLUDE_BIO) ?? '1') === '1',
    persona_openai_model: map.get(SETTING_PERSONA_OPENAI_MODEL)?.trim() || DEFAULT_PERSONA_MODEL,
    persona_system_prompt: map.get(SETTING_PERSONA_SYSTEM_PROMPT)?.trim() ?? DEFAULT_PERSONA_SYSTEM_PROMPT,
    persona_user_prompt_template: map.get(SETTING_PERSONA_USER_PROMPT_TEMPLATE)?.trim() ?? DEFAULT_PERSONA_USER_PROMPT_TEMPLATE,
    persona_max_text_len: parseInt(map.get(SETTING_PERSONA_MAX_TEXT_LEN) ?? String(DEFAULT_PERSONA_MAX_TEXT_LEN), 10) || DEFAULT_PERSONA_MAX_TEXT_LEN,
    persona_chat_ids: (() => {
      const raw = map.get(SETTING_PERSONA_CHAT_IDS);
      if (!raw) return [];
      try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.map((c: unknown) => Number(c)).filter((n: number) => !Number.isNaN(n) && n > 0) : [];
      } catch {
        return [];
      }
    })(),
    persona_schema_descriptions: map.get(SETTING_PERSONA_SCHEMA_DESCRIPTIONS) ?? JSON.stringify(DEFAULT_PERSONA_SCHEMA_DESCRIPTIONS, null, 2),
    ui_list_limit_ai_usage: parseInt(map.get(SETTING_UI_LIST_LIMIT_AI_USAGE) ?? '50', 10) || 50,
    ui_list_limit_messages_page: parseInt(map.get(SETTING_UI_LIST_LIMIT_MESSAGES_PAGE) ?? '20', 10) || 20,
    ui_list_limit_period_detail: parseInt(map.get(SETTING_UI_LIST_LIMIT_PERIOD_DETAIL) ?? '20', 10) || 20,
    ui_persona_labels: map.get(SETTING_UI_PERSONA_LABELS) ?? JSON.stringify(DEFAULT_UI_PERSONA_LABELS, null, 2),
    cache_ttl_stats_minutes: parseInt(map.get(SETTING_CACHE_TTL_STATS_MINUTES) ?? '2', 10) || 2,
    ingest_main_chat_slug: map.get(SETTING_INGEST_MAIN_CHAT_SLUG)?.trim() ?? 'main',
    persona_model_options: PERSONA_MODEL_OPTIONS,
    day_insight_system_prompt: map.get(SETTING_DAY_INSIGHT_SYSTEM_PROMPT)?.trim() ?? DEFAULT_DAY_INSIGHT_SYSTEM_PROMPT,
    day_insight_user_prompt_template: map.get(SETTING_DAY_INSIGHT_USER_PROMPT_TEMPLATE)?.trim() ?? DEFAULT_DAY_INSIGHT_USER_PROMPT_TEMPLATE,
    top_messages_default_author: topMessagesDefaultAuthor,
  };
  }, SETTINGS_DATA_TTL_MS);
}
