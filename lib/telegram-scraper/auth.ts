/**
 * Bridges GramJS's callback-driven TelegramClient.start() login flow to a
 * multi-step HTTP API (send code -> submit code -> optionally submit 2FA
 * password), since start() normally blocks on interactive input() calls.
 *
 * How the bridge works: start() is invoked once with phoneCode/password
 * callbacks that each return a Promise created via a "deferred" pattern —
 * the promise's resolve function is stashed on module state instead of
 * awaited inline. A later HTTP request (submitCode/submitPassword) resolves
 * it, which unblocks GramJS's internal retry loop (client/auth.ts: it
 * re-invokes the same callback on invalid code/password, and switches from
 * phoneCode to password automatically on SESSION_PASSWORD_NEEDED — verified
 * against the actual gram-js/teleproto source, not assumed).
 *
 * Single pending login at a time (private single-admin app) — state lives in
 * module scope, not the DB, since it's transient and tied to one live
 * TelegramClient/MTProto connection.
 */

import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { log } from '@/lib/logger';

export type LoginEventStatus = 'pending_code' | 'pending_password' | 'connected' | 'error';

export interface LoginEvent {
  status: LoginEventStatus;
  error?: string;
  sessionString?: string;
}

interface PendingLogin {
  client: TelegramClient;
  phoneNumber: string;
  resolveCode?: (code: string) => void;
  resolvePassword?: (password: string) => void;
  nextEventResolve?: (ev: LoginEvent) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

let pending: PendingLogin | null = null;

const PENDING_LOGIN_TIMEOUT_MS = 10 * 60 * 1000; // abandon a half-finished login after 10 min

function armNextEvent(): Promise<LoginEvent> {
  return new Promise((resolve) => {
    if (pending) pending.nextEventResolve = resolve;
  });
}

function fireEvent(ev: LoginEvent) {
  if (pending?.nextEventResolve) {
    const resolve = pending.nextEventResolve;
    pending.nextEventResolve = undefined;
    resolve(ev);
  }
}

function resetTimeout() {
  if (!pending) return;
  clearTimeout(pending.timeoutHandle);
  pending.timeoutHandle = setTimeout(() => {
    log.startup('[telegram-scraper] Pending login timed out after 10 min of inactivity — cancelling');
    cancelLogin();
  }, PENDING_LOGIN_TIMEOUT_MS);
}

export function hasPendingLogin(): boolean {
  return pending !== null;
}

export function cancelLogin(): void {
  if (!pending) return;
  clearTimeout(pending.timeoutHandle);
  const client = pending.client;
  pending = null;
  client.disconnect().catch(() => {});
}

/** Starts a fresh login: connects, sends the SMS/app code, and resolves once Telegram is ready to receive it. */
export async function startLogin(apiId: number, apiHash: string, phoneNumber: string): Promise<LoginEvent> {
  if (pending) cancelLogin();

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 3,
  });

  try {
    await client.connect();
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }

  pending = {
    client,
    phoneNumber,
    timeoutHandle: setTimeout(() => {
      log.startup('[telegram-scraper] Pending login timed out after 10 min of inactivity — cancelling');
      cancelLogin();
    }, PENDING_LOGIN_TIMEOUT_MS),
  };

  const firstEvent = armNextEvent();

  client
    .start({
      phoneNumber,
      phoneCode: async () => {
        resetTimeout();
        fireEvent({ status: 'pending_code' });
        return new Promise<string>((resolve) => {
          if (pending) pending.resolveCode = resolve;
        });
      },
      password: async () => {
        resetTimeout();
        fireEvent({ status: 'pending_password' });
        return new Promise<string>((resolve) => {
          if (pending) pending.resolvePassword = resolve;
        });
      },
      onError: async (err: Error) => {
        log.error('telegram-scraper', 'Login error', err);
        fireEvent({ status: 'error', error: (err as { errorMessage?: string }).errorMessage || err.message });
        return false; // never stop — let GramJS's own retry loop re-prompt
      },
    })
    .then(() => {
      const sessionString = client.session.save() as unknown as string;
      log.startup('[telegram-scraper] Login succeeded, session saved');
      fireEvent({ status: 'connected', sessionString });
      if (pending) clearTimeout(pending.timeoutHandle);
      pending = null;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error('telegram-scraper', 'Login failed', err);
      fireEvent({ status: 'error', error: message });
      if (pending) {
        clearTimeout(pending.timeoutHandle);
        client.disconnect().catch(() => {});
      }
      pending = null;
    });

  return firstEvent;
}

export async function submitCode(code: string): Promise<LoginEvent> {
  if (!pending || !pending.resolveCode) {
    return { status: 'error', error: 'No pending login is waiting for a code.' };
  }
  const next = armNextEvent();
  const resolve = pending.resolveCode;
  pending.resolveCode = undefined;
  resolve(code);
  return next;
}

export async function submitPassword(password: string): Promise<LoginEvent> {
  if (!pending || !pending.resolvePassword) {
    return { status: 'error', error: 'No pending login is waiting for a 2FA password.' };
  }
  const next = armNextEvent();
  const resolve = pending.resolvePassword;
  pending.resolvePassword = undefined;
  resolve(password);
  return next;
}
