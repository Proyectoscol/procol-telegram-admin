/**
 * Symmetric encryption for secrets that grant more than API-key-level access
 * (e.g. a live Telegram user session). Unlike the plain base64 "encoding" used
 * for the OpenAI key in lib/settings.ts, this is real AES-256-GCM so a DB leak
 * alone doesn't hand over the Telegram account.
 */

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.SCRAPER_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'SCRAPER_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to your environment.'
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'SCRAPER_ENCRYPTION_KEY must decode to 32 bytes — generate it with `openssl rand -base64 32`.'
    );
  }
  return key;
}

/** Encrypts a UTF-8 string. Returns a single base64 blob (iv + authTag + ciphertext). */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Reverses encryptSecret(). Throws if the payload was tampered with or the key is wrong. */
export function decryptSecret(payload: string): string {
  const key = getKey();
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function isScraperEncryptionConfigured(): boolean {
  return !!process.env.SCRAPER_ENCRYPTION_KEY;
}
