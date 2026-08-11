import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { clearAccount } from '@/lib/telegram-scraper/account';
import { cancelLogin } from '@/lib/telegram-scraper/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE /api/telegram-scraper/account — forgets the account/session ("log out" in Settings). */
export async function DELETE() {
  try {
    cancelLogin();
    await clearAccount();
    return NextResponse.json({ status: 'disconnected' });
  } catch (err) {
    log.error('telegram-scraper', 'account DELETE failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to disconnect' }, { status: 500 });
  }
}
