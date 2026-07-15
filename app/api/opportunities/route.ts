import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { getOpportunityBoard } from '@/lib/data/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/opportunities — the Opportunity Engine board, grouped by category. */
export async function GET() {
  try {
    const board = await getOpportunityBoard();
    return NextResponse.json(board);
  } catch (err) {
    log.error('opportunities', 'GET /api/opportunities failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load opportunities' },
      { status: 500 }
    );
  }
}
