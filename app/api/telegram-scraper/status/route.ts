import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { getAccountView } from '@/lib/telegram-scraper/account';
import { listGroups } from '@/lib/telegram-scraper/groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/telegram-scraper/status — account connection state + discovered groups (with role assignments). */
export async function GET() {
  try {
    const [account, groups] = await Promise.all([getAccountView(), listGroups()]);
    return NextResponse.json({ account, groups });
  } catch (err) {
    log.error('telegram-scraper', 'status failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load status' }, { status: 500 });
  }
}
