import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { recomputeOpportunities } from '@/lib/opportunities/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/opportunities/recompute — re-run the rules engine for every member. */
export async function POST() {
  try {
    const recomputed = await recomputeOpportunities();
    return NextResponse.json({ recomputed });
  } catch (err) {
    log.error('opportunities', 'POST /api/opportunities/recompute failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to recompute opportunities' },
      { status: 500 }
    );
  }
}
