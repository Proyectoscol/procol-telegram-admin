import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { buildPersonaContext } from '@/lib/ai/persona';
import { generatePersona } from '@/lib/ai/openai';
import { runPersonaSerial } from '@/lib/ai/persona-queue';
import { computeCost } from '@/lib/ai/model-pricing';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveUserIdFromFromId(fromId: string): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM users WHERE from_id = $1', [fromId]);
  return rows.length > 0 ? rows[0].id : null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const userId = await resolveUserIdFromFromId(fromId);
    if (userId == null) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const { rows } = await pool.query(
      `SELECT id, user_id, summary, topics, inferred_age_range, inferred_occupation, inferred_goals,
              social_links, content_preferences, pain_points, inference_evidence,
              model_used, prompt_tokens, completion_tokens, run_at, generated_for_range
       FROM contact_personas WHERE user_id = $1`,
      [userId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No persona generated yet' }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    log.error('persona', 'GET persona failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load persona' },
      { status: 500 }
    );
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const userId = await resolveUserIdFromFromId(fromId);
    if (userId == null) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const body = await _request.json().catch(() => ({}));
    const start = typeof body?.start === 'string' ? body.start : undefined;
    const end = typeof body?.end === 'string' ? body.end : undefined;
    const chatIds = Array.isArray(body?.chatIds) ? body.chatIds : undefined;
    const rangeLabel = typeof body?.rangeLabel === 'string' ? body.rangeLabel : undefined;

    const result = await runPersonaSerial(async () => {
      const context = await buildPersonaContext(userId, { chatIds, start, end });
      return generatePersona(context);
    });

    const p = result.data;
    const profile = p.inferred_profile ?? { age_range: null, occupation: null, goals: [] };
    const social = p.social_links ?? { instagram: null, twitter: null, linkedin: null, other: [] };

    await pool.query(
      `INSERT INTO contact_personas (
        user_id, summary, topics, inferred_age_range, inferred_occupation, inferred_goals,
        social_links, content_preferences, pain_points, inference_evidence,
        model_used, prompt_tokens, completion_tokens, run_at, generated_for_range
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14)
      ON CONFLICT (user_id) DO UPDATE SET
        summary = EXCLUDED.summary,
        topics = EXCLUDED.topics,
        inferred_age_range = EXCLUDED.inferred_age_range,
        inferred_occupation = EXCLUDED.inferred_occupation,
        inferred_goals = EXCLUDED.inferred_goals,
        social_links = EXCLUDED.social_links,
        content_preferences = EXCLUDED.content_preferences,
        pain_points = EXCLUDED.pain_points,
        inference_evidence = EXCLUDED.inference_evidence,
        model_used = EXCLUDED.model_used,
        prompt_tokens = EXCLUDED.prompt_tokens,
        completion_tokens = EXCLUDED.completion_tokens,
        run_at = EXCLUDED.run_at,
        generated_for_range = EXCLUDED.generated_for_range`,
      [
        userId,
        p.summary ?? '',
        JSON.stringify(p.topics ?? []),
        profile.age_range ?? null,
        profile.occupation ?? null,
        JSON.stringify(profile.goals ?? []),
        JSON.stringify(social),
        p.content_preferences ?? '',
        JSON.stringify(p.pain_points ?? []),
        p.inference_evidence ?? '',
        result.usage.model,
        result.usage.prompt_tokens,
        result.usage.completion_tokens,
        rangeLabel ?? null,
      ]
    );

    const costEstimate = computeCost(
      result.usage.model,
      result.usage.prompt_tokens,
      result.usage.completion_tokens
    );
    await pool.query(
      `INSERT INTO ai_usage_logs (entity_type, entity_id, model, prompt_tokens, completion_tokens, total_tokens, cost_estimate)
       VALUES ('persona_run', $1, $2, $3, $4, $5, $6)`,
      [
        userId,
        result.usage.model,
        result.usage.prompt_tokens,
        result.usage.completion_tokens,
        result.usage.total_tokens,
        costEstimate ?? null,
      ]
    );
    log.aiUsage('persona_run', {
      prompt_tokens: result.usage.prompt_tokens,
      completion_tokens: result.usage.completion_tokens,
      model: result.usage.model,
      entity_type: 'persona_run',
      entity_id: userId,
    });

    const { rows } = await pool.query(
      `SELECT id, user_id, summary, topics, inferred_age_range, inferred_occupation, inferred_goals,
              social_links, content_preferences, pain_points, inference_evidence,
              model_used, prompt_tokens, completion_tokens, run_at, generated_for_range
       FROM contact_personas WHERE user_id = $1`,
      [userId]
    );
    const persona = rows[0];
    return NextResponse.json({ persona, usage: result.usage });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate persona';
    if (message.includes('OpenAI API key not configured')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes('OpenAI')) {
      return NextResponse.json({ error: message }, { status: 502 });
    }
    log.error('persona', 'POST persona failed', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
