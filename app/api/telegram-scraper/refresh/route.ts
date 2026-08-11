import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { refreshMembers } from '@/lib/telegram-scraper/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // scraping + upserting a large group can take a while

/** POST /api/telegram-scraper/refresh — the "Actualizar miembros" button. Scrapes the Main/Premium-role groups and applies the same DB writes as the manual CSV import. */
export async function POST() {
  try {
    const result = await refreshMembers();
    return NextResponse.json(result);
  } catch (err) {
    log.error('telegram-scraper', 'refresh failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Refresh failed' }, { status: 500 });
  }
}
