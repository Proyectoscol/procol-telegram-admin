import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { saveNewCredentials, setAccountStatus, saveSession } from '@/lib/telegram-scraper/account';
import { startLogin } from '@/lib/telegram-scraper/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/telegram-scraper/login/start — { apiId, apiHash, phoneNumber }. Sends the Telegram login code. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const apiId = Number(body.apiId);
    const apiHash = String(body.apiHash || '').trim();
    const phoneNumber = String(body.phoneNumber || '').trim();

    if (!Number.isFinite(apiId) || apiId <= 0) {
      return NextResponse.json({ error: 'Enter a valid numeric API ID (from my.telegram.org).' }, { status: 400 });
    }
    if (!apiHash) {
      return NextResponse.json({ error: 'Enter the API hash (from my.telegram.org).' }, { status: 400 });
    }
    if (!phoneNumber.startsWith('+')) {
      return NextResponse.json({ error: 'Enter the phone number with country code, e.g. +573001234567.' }, { status: 400 });
    }

    await saveNewCredentials(apiId, apiHash, phoneNumber);
    const event = await startLogin(apiId, apiHash, phoneNumber);

    if (event.status === 'connected' && event.sessionString) {
      await saveSession(event.sessionString);
    } else if (event.status === 'pending_password') {
      await setAccountStatus('pending_password');
    } else if (event.status === 'error') {
      await setAccountStatus('error', event.error ?? 'Login failed');
    }

    return NextResponse.json({ status: event.status, error: event.error });
  } catch (err) {
    log.error('telegram-scraper', 'login/start failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to start login' }, { status: 500 });
  }
}
