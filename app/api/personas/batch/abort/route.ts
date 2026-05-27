import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { JOB_KEY, QUEUE_KEY } from '@/lib/batch/persona-batch-keys';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis not configured' }, { status: 503 });

  await redis.pipeline()
    .hset(JOB_KEY, { status: 'aborted', finished_at: new Date().toISOString() })
    .del(QUEUE_KEY)
    .exec();

  log.api('batch/abort: job aborted');
  return NextResponse.json({ ok: true });
}
