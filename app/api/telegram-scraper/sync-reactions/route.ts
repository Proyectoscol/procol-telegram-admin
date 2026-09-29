import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { backfillReactionTotals } from '@/lib/telegram-scraper/reactionsBackfill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 290; // matches reactionsBackfill's internal ~4.5 min soft budget, with headroom

/** POST /api/telegram-scraper/sync-reactions — the "Backfill reaction totals" button. Re-fetches already-synced messages to pick up their true per-emoji reaction totals. */
export async function POST() {
  try {
    const result = await backfillReactionTotals();
    return NextResponse.json(result);
  } catch (err) {
    log.error('telegram-scraper', 'sync-reactions failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Backfill failed' }, { status: 500 });
  }
}
