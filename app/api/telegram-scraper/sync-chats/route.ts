import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { syncAllEnabledChats } from '@/lib/telegram-scraper/chatSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 290; // matches chatSync's internal ~4.5 min soft budget, with headroom

/** POST /api/telegram-scraper/sync-chats — the "Sync chats" button. Pulls message/reaction history for every group with sync_chat = true. */
export async function POST() {
  try {
    const result = await syncAllEnabledChats();
    return NextResponse.json(result);
  } catch (err) {
    log.error('telegram-scraper', 'sync-chats failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 });
  }
}
