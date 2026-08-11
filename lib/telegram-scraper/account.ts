/**
 * DB-backed CRUD for the singleton telegram_scraper_account row. Credentials
 * and the login session are AES-256-GCM encrypted (lib/crypto/secretBox.ts)
 * before being written — callers here only ever see decrypted values inside
 * this module or via getDecryptedAccount(), never a plaintext round-trip
 * through the API layer.
 */

import { pool, ensureSchema } from '@/lib/db/client';
import { encryptSecret, decryptSecret } from '@/lib/crypto/secretBox';

export type ScraperAccountStatus = 'disconnected' | 'pending_code' | 'pending_password' | 'connected' | 'error';

export interface ScraperAccountView {
  configured: boolean;
  status: ScraperAccountStatus;
  phoneNumberDisplay: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
}

interface AccountRow {
  api_id: string;
  api_hash: string;
  phone_number: string;
  phone_number_display: string | null;
  session_string: string | null;
  status: ScraperAccountStatus;
  last_error: string | null;
  last_connected_at: string | null;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.length <= 5) return digits;
  const head = digits.slice(0, 3);
  const tail = digits.slice(-2);
  return `${head}${'*'.repeat(Math.max(3, digits.length - 5))}${tail}`;
}

/** Public status for the Settings UI — never returns credentials or the session. */
export async function getAccountView(): Promise<ScraperAccountView> {
  await ensureSchema();
  const { rows } = await pool.query<AccountRow>(
    'SELECT api_id, api_hash, phone_number, phone_number_display, session_string, status, last_error, last_connected_at FROM telegram_scraper_account WHERE id = 1'
  );
  if (rows.length === 0) {
    return { configured: false, status: 'disconnected', phoneNumberDisplay: null, lastConnectedAt: null, lastError: null };
  }
  const row = rows[0];
  return {
    configured: true,
    status: row.status,
    phoneNumberDisplay: row.phone_number_display,
    lastConnectedAt: row.last_connected_at,
    lastError: row.last_error,
  };
}

/** Starts (or restarts) a login: stores fresh encrypted credentials, clears any old session. */
export async function saveNewCredentials(apiId: number, apiHash: string, phoneNumber: string): Promise<void> {
  await ensureSchema();
  await pool.query(
    `INSERT INTO telegram_scraper_account (id, api_id, api_hash, phone_number, phone_number_display, session_string, status, last_error, updated_at)
     VALUES (1, $1, $2, $3, $4, NULL, 'pending_code', NULL, NOW())
     ON CONFLICT (id) DO UPDATE SET
       api_id = EXCLUDED.api_id,
       api_hash = EXCLUDED.api_hash,
       phone_number = EXCLUDED.phone_number,
       phone_number_display = EXCLUDED.phone_number_display,
       session_string = NULL,
       status = 'pending_code',
       last_error = NULL,
       updated_at = NOW()`,
    [encryptSecret(String(apiId)), encryptSecret(apiHash), encryptSecret(phoneNumber), maskPhone(phoneNumber)]
  );
}

export async function setAccountStatus(status: ScraperAccountStatus, error?: string | null): Promise<void> {
  await pool.query(
    `UPDATE telegram_scraper_account SET status = $1, last_error = $2, updated_at = NOW() WHERE id = 1`,
    [status, error ?? null]
  );
}

export async function saveSession(sessionString: string): Promise<void> {
  await pool.query(
    `UPDATE telegram_scraper_account
     SET session_string = $1, status = 'connected', last_error = NULL, last_connected_at = NOW(), updated_at = NOW()
     WHERE id = 1`,
    [encryptSecret(sessionString)]
  );
}

export interface DecryptedAccount {
  apiId: number;
  apiHash: string;
  sessionString: string;
}

/** For the scraper to open a connection. Returns null if never connected. */
export async function getDecryptedAccount(): Promise<DecryptedAccount | null> {
  await ensureSchema();
  const { rows } = await pool.query<AccountRow>(
    "SELECT api_id, api_hash, session_string FROM telegram_scraper_account WHERE id = 1 AND status = 'connected'"
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (!row.session_string) return null;
  return {
    apiId: Number(decryptSecret(row.api_id)),
    apiHash: decryptSecret(row.api_hash),
    sessionString: decryptSecret(row.session_string),
  };
}

/** Forgets the account entirely ("log out" in Settings). Caller is responsible for disconnecting any live client first. */
export async function clearAccount(): Promise<void> {
  await pool.query('DELETE FROM telegram_scraper_account WHERE id = 1');
}
