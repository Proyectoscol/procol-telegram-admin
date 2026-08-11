import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { cancelLogin } from '@/lib/telegram-scraper/auth';
import { setAccountStatus } from '@/lib/telegram-scraper/account';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/telegram-scraper/login/cancel — abandons a half-finished login (e.g. user closed the code prompt). */
export async function POST() {
  try {
    cancelLogin();
    await setAccountStatus('disconnected', null);
    return NextResponse.json({ status: 'disconnected' });
  } catch (err) {
    log.error('telegram-scraper', 'login/cancel failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to cancel' }, { status: 500 });
  }
}
