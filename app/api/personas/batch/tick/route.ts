import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { generateAndSavePersona } from '@/lib/ai/run-persona';
import { log } from '@/lib/logger';
import { JOB_KEY, QUEUE_KEY, LOG_KEY } from '@/lib/batch/persona-batch-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface QueueEntry { userId: number; name: string }

export async function POST() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis not configured' }, { status: 503 });

  try {
    const [status, totalStr, processedStr, failedStr] = await Promise.all([
      redis.hget(JOB_KEY, 'status'),
      redis.hget(JOB_KEY, 'total'),
      redis.hget(JOB_KEY, 'processed'),
      redis.hget(JOB_KEY, 'failed'),
    ]);

    const total = parseInt(totalStr ?? '0', 10);
    const processed = parseInt(processedStr ?? '0', 10);
    const failed = parseInt(failedStr ?? '0', 10);

    if (status === 'aborted' || status === 'done' || !status) {
      return NextResponse.json({ status: status ?? 'idle', total, processed, failed });
    }

    if (status !== 'running') {
      return NextResponse.json({ status, total, processed, failed });
    }

    const raw = await redis.lpop(QUEUE_KEY);
    if (!raw) {
      await redis.hset(JOB_KEY, { status: 'done', finished_at: new Date().toISOString() });
      return NextResponse.json({ status: 'done', total, processed, failed });
    }

    let entry: QueueEntry;
    try {
      entry = JSON.parse(raw) as QueueEntry;
    } catch {
      await redis.hincrby(JOB_KEY, 'failed', 1);
      return NextResponse.json({ status: 'running', total, processed, failed: failed + 1, lastUser: { name: '(parse error)', success: false } });
    }

    let success = false;
    let errorMsg = '';
    try {
      await generateAndSavePersona(entry.userId);
      success = true;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Unknown error';
      log.error('batch', `Persona failed for userId=${entry.userId} name=${entry.name}: ${errorMsg}`);
    }

    const logEntry = JSON.stringify({
      ts: Date.now(),
      userId: entry.userId,
      name: entry.name,
      success,
      error: errorMsg || undefined,
    });
    await redis.pipeline()
      .hincrby(JOB_KEY, success ? 'processed' : 'failed', 1)
      .lpush(LOG_KEY, logEntry)
      .ltrim(LOG_KEY, 0, 99)
      .exec();

    const remaining = await redis.llen(QUEUE_KEY);
    if (remaining === 0) {
      await redis.hset(JOB_KEY, { status: 'done', finished_at: new Date().toISOString() });
    }

    return NextResponse.json({
      status: remaining === 0 ? 'done' : 'running',
      total,
      processed: processed + (success ? 1 : 0),
      failed: failed + (success ? 0 : 1),
      remaining,
      lastUser: { userId: entry.userId, name: entry.name, success, error: errorMsg || undefined },
    });
  } catch (err) {
    log.error('batch', 'Batch tick failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Tick failed' }, { status: 500 });
  }
}
