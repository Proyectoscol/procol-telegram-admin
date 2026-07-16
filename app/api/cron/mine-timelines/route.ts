import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { mineAllMemberTimelines } from '@/lib/timeline/mineMessages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Scheduled: mine new messages for timeline events (idempotent, never duplicates). */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await mineAllMemberTimelines();
    return NextResponse.json(result);
  } catch (err) {
    log.error('cron-mine-timelines', 'Scheduled timeline mining failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Timeline mining failed' },
      { status: 500 }
    );
  }
}
