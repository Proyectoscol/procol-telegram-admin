import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { discoverGroups } from '@/lib/telegram-scraper/groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/telegram-scraper/groups/discover — lists megagroups on the logged-in account and upserts them. */
export async function POST() {
  try {
    const groups = await discoverGroups();
    return NextResponse.json({ groups });
  } catch (err) {
    log.error('telegram-scraper', 'groups/discover failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to discover groups' }, { status: 500 });
  }
}
