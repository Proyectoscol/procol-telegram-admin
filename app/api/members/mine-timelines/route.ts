import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { mineAllMemberTimelines } from '@/lib/timeline/mineMessages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/members/mine-timelines — scan every member's message history for
 * goals, wins, problems, and dollar amounts, and back-fill their timeline.
 * Idempotent: safe to re-run, never duplicates an already-mined message.
 */
export async function POST() {
  try {
    await ensureSchema();
    const result = await mineAllMemberTimelines();
    return NextResponse.json(result);
  } catch (err) {
    log.error('mine-timelines', 'POST /api/members/mine-timelines failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to mine timelines' },
      { status: 500 }
    );
  }
}
