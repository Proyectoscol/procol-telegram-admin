import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { log } from '@/lib/logger';
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
  SETTING_PERSONA_CHAT_IDS,
  SETTING_UI_LIST_LIMIT_AI_USAGE,
  SETTING_UI_LIST_LIMIT_MESSAGES_PAGE,
  SETTING_UI_LIST_LIMIT_PERIOD_DETAIL,
  SETTING_UI_PERSONA_LABELS,
  SETTING_CACHE_TTL_STATS_MINUTES,
  SETTING_INGEST_MAIN_CHAT_SLUG,
  SETTING_DAY_INSIGHT_SYSTEM_PROMPT,
  SETTING_DAY_INSIGHT_USER_PROMPT_TEMPLATE,
  SETTING_TOP_MESSAGES_DEFAULT_AUTHOR,
  DEFAULT_PERSONA_MODEL,
  DEFAULT_PERSONA_SYSTEM_PROMPT,
  DEFAULT_PERSONA_USER_PROMPT_TEMPLATE,
  DEFAULT_PERSONA_MAX_TEXT_LEN,
  DEFAULT_PERSONA_SCHEMA_DESCRIPTIONS,
  DEFAULT_UI_PERSONA_LABELS,
  DEFAULT_DAY_INSIGHT_SYSTEM_PROMPT,
  DEFAULT_DAY_INSIGHT_USER_PROMPT_TEMPLATE,
} from '@/lib/settings';
import { getSettingsData } from '@/lib/data/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function encodeSecret(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

/** GET /api/settings – returns which keys are configured (never the actual key) and persona options. Seeds persona prompts if missing. */
export async function GET() {
  try {
    const data = await getSettingsData();
    return NextResponse.json(data);
  } catch (err) {
    log.error('settings', 'GET settings failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load settings' },
      { status: 500 }
    );
  }
}

/** POST /api/settings – body: { openai_api_key?, persona_days_back?, persona_max_messages?, persona_max_reactions?, persona_include_bio? }. */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const body = await request.json().catch(() => ({}));

    const openaiApiKey = body.openai_api_key as string | null | undefined;
    if (openaiApiKey !== undefined) {
      if (openaiApiKey === null || openaiApiKey === '') {
        await pool.query('DELETE FROM settings WHERE key = $1', [SETTING_OPENAI_API_KEY]);
      } else {
        const value = typeof openaiApiKey === 'string' ? openaiApiKey.trim() : '';
        if (!value) {
          return NextResponse.json(
            { error: 'openai_api_key must be a non-empty string or null to remove' },
            { status: 400 }
          );
        }
        const encoded = encodeSecret(value);
        await pool.query(
          `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [SETTING_OPENAI_API_KEY, encoded]
        );
      }
    }

    const personaDaysBack = body.persona_days_back as string | undefined;
    if (personaDaysBack !== undefined) {
      const v = String(personaDaysBack).trim();
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_PERSONA_DAYS_BACK, v === '' ? 'unlimited' : v]
      );
    }
    const personaMaxMessages = body.persona_max_messages;
    if (personaMaxMessages !== undefined) {
      const v = String(Math.max(1, parseInt(String(personaMaxMessages), 10) || 80));
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_PERSONA_MAX_MESSAGES, v]
      );
    }
    const personaMaxReactions = body.persona_max_reactions;
    if (personaMaxReactions !== undefined) {
      const v = String(Math.max(0, parseInt(String(personaMaxReactions), 10) || 50));
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_PERSONA_MAX_REACTIONS, v]
      );
    }
    const personaIncludeBio = body.persona_include_bio;
    if (personaIncludeBio !== undefined) {
      const v = personaIncludeBio ? '1' : '0';
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_PERSONA_INCLUDE_BIO, v]
      );
    }
    const personaOpenAIModel = body.persona_openai_model;
    if (personaOpenAIModel !== undefined) {
      const v = typeof personaOpenAIModel === 'string' ? personaOpenAIModel.trim() || DEFAULT_PERSONA_MODEL : DEFAULT_PERSONA_MODEL;
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_PERSONA_OPENAI_MODEL, v]
      );
    }
    const personaSystemPrompt = body.persona_system_prompt;
    if (personaSystemPrompt !== undefined) {
      const v = typeof personaSystemPrompt === 'string' ? personaSystemPrompt : DEFAULT_PERSONA_SYSTEM_PROMPT;
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_PERSONA_SYSTEM_PROMPT, v]
      );
    }
    const personaUserPromptTemplate = body.persona_user_prompt_template;
    if (personaUserPromptTemplate !== undefined) {
      const v = typeof personaUserPromptTemplate === 'string' ? personaUserPromptTemplate : DEFAULT_PERSONA_USER_PROMPT_TEMPLATE;
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_PERSONA_USER_PROMPT_TEMPLATE, v]
      );
    }
    const personaMaxTextLen = body.persona_max_text_len;
    if (personaMaxTextLen !== undefined) {
      const v = String(Math.max(100, Math.min(2000, parseInt(String(personaMaxTextLen), 10) || DEFAULT_PERSONA_MAX_TEXT_LEN)));
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_PERSONA_MAX_TEXT_LEN, v]
      );
    }
    const personaChatIds = body.persona_chat_ids;
    if (personaChatIds !== undefined) {
      const arr = Array.isArray(personaChatIds)
        ? personaChatIds.map((c: unknown) => Number(c)).filter((n: number) => !Number.isNaN(n) && n > 0)
        : [];
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_PERSONA_CHAT_IDS, JSON.stringify(arr)]
      );
    }
    const personaSchemaDescriptions = body.persona_schema_descriptions;
    if (personaSchemaDescriptions !== undefined && typeof personaSchemaDescriptions === 'string') {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_PERSONA_SCHEMA_DESCRIPTIONS, personaSchemaDescriptions]
      );
    }
    const uiListLimitAiUsage = body.ui_list_limit_ai_usage;
    if (uiListLimitAiUsage !== undefined) {
      const v = String(Math.max(10, Math.min(500, parseInt(String(uiListLimitAiUsage), 10) || 50)));
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_UI_LIST_LIMIT_AI_USAGE, v]
      );
    }
    const uiListLimitMessagesPage = body.ui_list_limit_messages_page;
    if (uiListLimitMessagesPage !== undefined) {
      const v = String(Math.max(5, Math.min(200, parseInt(String(uiListLimitMessagesPage), 10) || 20)));
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_UI_LIST_LIMIT_MESSAGES_PAGE, v]
      );
    }
    const uiListLimitPeriodDetail = body.ui_list_limit_period_detail;
    if (uiListLimitPeriodDetail !== undefined) {
      const v = String(Math.max(5, Math.min(100, parseInt(String(uiListLimitPeriodDetail), 10) || 20)));
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_UI_LIST_LIMIT_PERIOD_DETAIL, v]
      );
    }
    const uiPersonaLabels = body.ui_persona_labels;
    if (uiPersonaLabels !== undefined && typeof uiPersonaLabels === 'string') {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_UI_PERSONA_LABELS, uiPersonaLabels]
      );
    }
    const cacheTtlStatsMinutes = body.cache_ttl_stats_minutes;
    if (cacheTtlStatsMinutes !== undefined) {
      const v = String(Math.max(1, Math.min(60, parseInt(String(cacheTtlStatsMinutes), 10) || 2)));
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_CACHE_TTL_STATS_MINUTES, v]
      );
    }
    const ingestMainChatSlug = body.ingest_main_chat_slug;
    if (ingestMainChatSlug !== undefined) {
      const v = typeof ingestMainChatSlug === 'string' ? ingestMainChatSlug.trim() || 'main' : 'main';
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_INGEST_MAIN_CHAT_SLUG, v]
      );
    }
    const dayInsightSystemPrompt = body.day_insight_system_prompt;
    if (dayInsightSystemPrompt !== undefined) {
      const v = typeof dayInsightSystemPrompt === 'string' ? dayInsightSystemPrompt : DEFAULT_DAY_INSIGHT_SYSTEM_PROMPT;
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_DAY_INSIGHT_SYSTEM_PROMPT, v]
      );
    }
    const dayInsightUserPromptTemplate = body.day_insight_user_prompt_template;
    if (dayInsightUserPromptTemplate !== undefined) {
      const v = typeof dayInsightUserPromptTemplate === 'string' ? dayInsightUserPromptTemplate : DEFAULT_DAY_INSIGHT_USER_PROMPT_TEMPLATE;
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [SETTING_DAY_INSIGHT_USER_PROMPT_TEMPLATE, v]
      );
    }
    const topMessagesDefaultAuthorFromId = body.top_messages_default_author_from_id as string | null | undefined;
    if (topMessagesDefaultAuthorFromId !== undefined) {
      if (topMessagesDefaultAuthorFromId === null || topMessagesDefaultAuthorFromId === '') {
        await pool.query('DELETE FROM settings WHERE key = $1', [SETTING_TOP_MESSAGES_DEFAULT_AUTHOR]);
      } else {
        await pool.query(
          `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [SETTING_TOP_MESSAGES_DEFAULT_AUTHOR, String(topMessagesDefaultAuthorFromId)]
        );
      }
    }

    const data = await getSettingsData();
    return NextResponse.json(data);
  } catch (err) {
    log.error('settings', 'POST settings failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save settings' },
      { status: 500 }
    );
  }
}
