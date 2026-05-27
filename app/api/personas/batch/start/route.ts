import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, queryWithRetry } from '@/lib/db/client';
import { getRedis } from '@/lib/redis';
import { log } from '@/lib/logger';
import { JOB_KEY, QUEUE_KEY, LOG_KEY } from '@/lib/batch/persona-batch-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Filter = 'all' | 'premium' | 'no_persona';

async function getEstimate() {
  const { rows } = await queryWithRetry<{
    avg_prompt: string;
    avg_completion: string;
    avg_cost: string;
    run_count: string;
  }>(
    `SELECT
       COALESCE(AVG(prompt_tokens), 2000)::int        AS avg_prompt,
       COALESCE(AVG(completion_tokens), 400)::int      AS avg_completion,
       COALESCE(AVG(cost_estimate::numeric), 0.0004)   AS avg_cost,
       COUNT(*)                                        AS run_count
     FROM ai_usage_logs
     WHERE entity_type = 'persona_run'`
  );
  const s = rows[0];
  return {
    avgPromptTokens: parseInt(s.avg_prompt, 10) || 2000,
    avgCompletionTokens: parseInt(s.avg_completion, 10) || 400,
    avgCostPerRun: parseFloat(s.avg_cost) || 0.0004,
    basedOnRuns: parseInt(s.run_count, 10),
  };
}

export async function POST(request: NextRequest) {
  try {
    const redis = getRedis();
    if (!redis) return NextResponse.json({ error: 'Redis not configured (REDIS_URL missing)' }, { status: 503 });

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const filter: Filter = (body.filter as Filter) ?? 'no_persona';
    const dryRun = body.dryRun === true;

    if (!dryRun) {
      const status = await redis.hget(JOB_KEY, 'status');
      if (status === 'running') {
        return NextResponse.json({ error: 'A batch job is already running. Abort it first.' }, { status: 409 });
      }
    }

    await ensureSchema();

    let query = `
      SELECT u.id, u.display_name
      FROM users u
      WHERE COALESCE(u.is_current_member, false) = true
    `;
    if (filter === 'premium') query += ` AND u.is_premium = true`;
    if (filter === 'no_persona') {
      query += ` AND NOT EXISTS (SELECT 1 FROM contact_personas cp WHERE cp.user_id = u.id)`;
    }
    query += ` ORDER BY u.id`;

    const { rows: users } = await queryWithRetry<{ id: number; display_name: string }>(query);
    const total = users.length;

    const est = await getEstimate();
    const estimate = {
      ...est,
      totalCost: Math.round(est.avgCostPerRun * total * 100) / 100,
      totalTokens: (est.avgPromptTokens + est.avgCompletionTokens) * total,
      estimatedMinutes: Math.max(1, Math.ceil((total * 4) / 60)),
    };

    if (dryRun || total === 0) {
      return NextResponse.json({ total, filter, estimate });
    }

    const pipeline = redis.pipeline();
    pipeline.del(QUEUE_KEY);
    pipeline.del(LOG_KEY);
    pipeline.hset(JOB_KEY, {
      status: 'running',
      filter,
      total: String(total),
      processed: '0',
      failed: '0',
      started_at: new Date().toISOString(),
      finished_at: '',
    });
    if (users.length > 0) {
      pipeline.rpush(QUEUE_KEY, ...users.map((u) => JSON.stringify({ userId: u.id, name: u.display_name ?? 'Unknown' })));
    }
    await pipeline.exec();

    log.api(`batch/start: filter=${filter} total=${total}`);
    return NextResponse.json({ ok: true, total, filter, estimate });
  } catch (err) {
    log.error('batch', 'Batch start failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to start batch' }, { status: 500 });
  }
}
