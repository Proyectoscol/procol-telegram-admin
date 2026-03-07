/**
 * GET /api/users/[fromId]/relationship-summary?otherFromId=xxx
 *   Returns stored relationship insight for this pair (if any).
 *
 * POST /api/users/[fromId]/relationship-summary
 *   Body: { otherFromId: string, chatIds?: number[] }
 *   Generates AI relationship summary and stores it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { buildRelationshipContext } from '@/lib/ai/relationship-context';
import { generateRelationshipSummary } from '@/lib/ai/openai';
import { computeCost } from '@/lib/ai/model-pricing';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';

async function resolveUserId(fromId: string): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM users WHERE from_id = $1', [fromId]);
  return rows.length > 0 ? rows[0].id : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const otherFromId = request.nextUrl.searchParams.get('otherFromId');
    if (!otherFromId) {
      return NextResponse.json({ error: 'otherFromId required' }, { status: 400 });
    }

    const userId = await resolveUserId(fromId);
    const otherUserId = await resolveUserId(otherFromId);
    if (userId == null || otherUserId == null) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { rows } = await pool.query(
      `SELECT summary, tone, mutual_or_one_sided, evolution, inference_evidence,
              model_used, prompt_tokens, completion_tokens, run_at
       FROM relationship_insights WHERE user_id = $1 AND other_user_id = $2`,
      [userId, otherUserId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No relationship summary yet' }, { status: 404 });
    }
    const r = rows[0] as Record<string, unknown>;
    return NextResponse.json({
      summary: r.summary,
      tone: r.tone,
      mutual_or_one_sided: r.mutual_or_one_sided,
      evolution: r.evolution,
      inference_evidence: r.inference_evidence,
      model_used: r.model_used,
      prompt_tokens: r.prompt_tokens,
      completion_tokens: r.completion_tokens,
      run_at: r.run_at,
    });
  } catch (err) {
    log.error('relationship-summary', 'GET relationship-summary failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load relationship summary' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const body = await request.json().catch(() => ({}));
    const otherFromId = body?.otherFromId ?? body?.other_from_id;
    const chatIds = Array.isArray(body?.chatIds) ? body.chatIds : undefined;

    if (!otherFromId || typeof otherFromId !== 'string') {
      return NextResponse.json({ error: 'otherFromId required' }, { status: 400 });
    }

    const userId = await resolveUserId(fromId);
    const otherUserId = await resolveUserId(otherFromId);
    if (userId == null || otherUserId == null) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const context = await buildRelationshipContext(fromId, otherFromId.trim(), chatIds);
    const result = await generateRelationshipSummary(context);

    const p = result.data;
    await pool.query(
      `INSERT INTO relationship_insights (
        user_id, other_user_id, summary, tone, mutual_or_one_sided, evolution, inference_evidence,
        model_used, prompt_tokens, completion_tokens, run_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (user_id, other_user_id) DO UPDATE SET
        summary = EXCLUDED.summary,
        tone = EXCLUDED.tone,
        mutual_or_one_sided = EXCLUDED.mutual_or_one_sided,
        evolution = EXCLUDED.evolution,
        inference_evidence = EXCLUDED.inference_evidence,
        model_used = EXCLUDED.model_used,
        prompt_tokens = EXCLUDED.prompt_tokens,
        completion_tokens = EXCLUDED.completion_tokens,
        run_at = EXCLUDED.run_at`,
      [
        userId,
        otherUserId,
        p.summary ?? '',
        p.tone ?? '',
        p.mutual_or_one_sided ?? '',
        p.evolution ?? '',
        p.inference_evidence ?? '',
        result.usage.model,
        result.usage.prompt_tokens,
        result.usage.completion_tokens,
      ]
    );

    const costEstimate = computeCost(
      result.usage.model,
      result.usage.prompt_tokens,
      result.usage.completion_tokens
    );
    await pool.query(
      `INSERT INTO ai_usage_logs (entity_type, entity_id, model, prompt_tokens, completion_tokens, total_tokens, cost_estimate)
       VALUES ('relationship_insight', $1, $2, $3, $4, $5, $6)`,
      [
        userId,
        result.usage.model,
        result.usage.prompt_tokens,
        result.usage.completion_tokens,
        result.usage.prompt_tokens + result.usage.completion_tokens,
        costEstimate ?? null,
      ]
    );
    log.aiUsage('relationship_insight', {
      prompt_tokens: result.usage.prompt_tokens,
      completion_tokens: result.usage.completion_tokens,
      model: result.usage.model,
      entity_type: 'relationship_insight',
      entity_id: userId,
    });

    const { rows } = await pool.query(
      `SELECT summary, tone, mutual_or_one_sided, evolution, inference_evidence,
              model_used, prompt_tokens, completion_tokens, run_at
       FROM relationship_insights WHERE user_id = $1 AND other_user_id = $2`,
      [userId, otherUserId]
    );
    const insight = rows[0] as Record<string, unknown>;
    return NextResponse.json({
      insight: {
        summary: insight.summary,
        tone: insight.tone,
        mutual_or_one_sided: insight.mutual_or_one_sided,
        evolution: insight.evolution,
        inference_evidence: insight.inference_evidence,
        model_used: insight.model_used,
        prompt_tokens: insight.prompt_tokens,
        completion_tokens: insight.completion_tokens,
        run_at: insight.run_at,
      },
      usage: result.usage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate relationship summary';
    if (message.includes('OpenAI API key not configured')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes('OpenAI')) {
      return NextResponse.json({ error: message }, { status: 502 });
    }
    log.error('relationship-summary', 'POST relationship-summary failed', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
