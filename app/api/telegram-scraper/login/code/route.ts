import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { saveSession, setAccountStatus } from '@/lib/telegram-scraper/account';
import { submitCode, hasPendingLogin } from '@/lib/telegram-scraper/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/telegram-scraper/login/code — { code }. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const code = String(body.code || '').trim();
    if (!code) return NextResponse.json({ error: 'Enter the code Telegram sent you.' }, { status: 400 });

    const event = await submitCode(code);

    if (event.status === 'connected' && event.sessionString) {
      await saveSession(event.sessionString);
    } else if (event.status === 'pending_password') {
      await setAccountStatus('pending_password');
    } else if (event.status === 'error' && !hasPendingLogin()) {
      // Only give up if GramJS's own retry loop also gave up (fatal, e.g. code expired).
      // A single invalid-code attempt keeps `pending` alive so the user can retry.
      await setAccountStatus('error', event.error ?? 'Login failed');
    }

    return NextResponse.json({ status: event.status, error: event.error });
  } catch (err) {
    log.error('telegram-scraper', 'login/code failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to submit code' }, { status: 500 });
  }
}
