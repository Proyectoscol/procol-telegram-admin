import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { JOB_KEY, LOG_KEY, QUEUE_KEY } from '@/lib/batch/persona-batch-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis not configured' }, { status: 503 });

  const [job, logEntries, remaining] = await Promise.all([
    redis.hgetall(JOB_KEY),
    redis.lrange(LOG_KEY, 0, 29),
    redis.llen(QUEUE_KEY),
  ]);

  if (!job || !job.status) {
    return NextResponse.json({ status: 'idle' });
  }

  const logs = logEntries.map((raw) => {
    try { return JSON.parse(raw); } catch { return { raw }; }
  });

  return NextResponse.json({
    status: job.status,
    filter: job.filter ?? 'all',
    total: parseInt(job.total ?? '0', 10),
    processed: parseInt(job.processed ?? '0', 10),
    failed: parseInt(job.failed ?? '0', 10),
    remaining,
    started_at: job.started_at ?? null,
    finished_at: job.finished_at ?? null,
    logs,
  });
}
