import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { getOpportunityBoard, type PremiumFilter } from '@/lib/data/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_PREMIUM_FILTERS: PremiumFilter[] = ['all', 'only', 'exclude'];

/**
 * GET /api/opportunities — the Opportunity Engine board, grouped by category.
 * Query params: current=true|false (default true), premium=all|only|exclude (default all).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const currentOnly = searchParams.get('current') !== 'false';
    const premiumParam = searchParams.get('premium');
    const premiumFilter: PremiumFilter = VALID_PREMIUM_FILTERS.includes(premiumParam as PremiumFilter)
      ? (premiumParam as PremiumFilter)
      : 'all';
    const board = await getOpportunityBoard({ currentOnly, premiumFilter });
    return NextResponse.json(board);
  } catch (err) {
    log.error('opportunities', 'GET /api/opportunities failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load opportunities' },
      { status: 500 }
    );
  }
}
