import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { getOpportunityBoard } from '@/lib/data/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/opportunities — the Opportunity Engine board, grouped by category.
 * Query params: active=true|false (default true), premium=true|false (default false).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') !== 'false';
    const premiumOnly = searchParams.get('premium') === 'true';
    const board = await getOpportunityBoard({ activeOnly, premiumOnly });
    return NextResponse.json(board);
  } catch (err) {
    log.error('opportunities', 'GET /api/opportunities failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load opportunities' },
      { status: 500 }
    );
  }
}
