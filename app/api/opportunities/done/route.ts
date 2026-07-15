import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema, queryWithRetry } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/opportunities/done — mark an opportunity done (or reopen it).
 * Body: { userId: number, done: boolean }
 * Ticking done is sticky only while the opportunity stays the same; the next
 * recompute clears done_at automatically if the category/reason changed.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = Number(body?.userId);
    const done = !!body?.done;
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    await ensureSchema();
    await queryWithRetry(
      `UPDATE opportunity_scores SET done_at = $2 WHERE user_id = $1`,
      [userId, done ? new Date().toISOString() : null]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('opportunities', 'POST /api/opportunities/done failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update opportunity' },
      { status: 500 }
    );
  }
}
