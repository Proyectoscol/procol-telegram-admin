import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { saveSession, setAccountStatus } from '@/lib/telegram-scraper/account';
import { submitPassword, hasPendingLogin } from '@/lib/telegram-scraper/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/telegram-scraper/login/password — { password }. Only relevant when status is pending_password (2FA). */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const password = String(body.password || '');
    if (!password) return NextResponse.json({ error: 'Enter your 2FA password.' }, { status: 400 });

    const event = await submitPassword(password);

    if (event.status === 'connected' && event.sessionString) {
      await saveSession(event.sessionString);
    } else if (event.status === 'error' && !hasPendingLogin()) {
      await setAccountStatus('error', event.error ?? 'Login failed');
    }
    // A single wrong-password attempt keeps `pending` alive (GramJS retries), so status stays pending_password.

    return NextResponse.json({ status: event.status, error: event.error });
  } catch (err) {
    log.error('telegram-scraper', 'login/password failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to submit password' }, { status: 500 });
  }
}
