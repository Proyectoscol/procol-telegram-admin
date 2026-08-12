import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { syncProfiles } from '@/lib/telegram-scraper/profileSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 290; // matches profileSync's internal ~4.5 min soft budget, with headroom

/** POST /api/telegram-scraper/sync-profiles — the "Sync profiles" button. Pulls bio/flags/status/photos for current Main+Premium members. */
export async function POST() {
  try {
    const result = await syncProfiles();
    return NextResponse.json(result);
  } catch (err) {
    log.error('telegram-scraper', 'sync-profiles failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 });
  }
}
