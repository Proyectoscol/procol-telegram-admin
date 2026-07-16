import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { recomputeOpportunities } from '@/lib/opportunities/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Scheduled: recompute the Opportunity Engine for every member. */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const recomputed = await recomputeOpportunities();
    return NextResponse.json({ recomputed });
  } catch (err) {
    log.error('cron-recompute', 'Scheduled recompute failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Recompute failed' },
      { status: 500 }
    );
  }
}
