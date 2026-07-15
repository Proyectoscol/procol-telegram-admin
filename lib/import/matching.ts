/**
 * Shared deterministic matching used by every "match a pasted/uploaded row
 * against an existing member" importer: list imports and the questionnaire
 * import. Username → Telegram ID → email → exact name, in that order.
 */
import { pool } from '@/lib/db/client';

export const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export type ReviewReason = 'DUPLICATE_NAME' | 'UNMATCHED' | 'MISSING_IDENTIFIER';

export interface Identity {
  name: string | null;
  username: string | null;
  telegramId: string | null;
  email: string | null;
}

export function splitLine(line: string): string[] {
  for (const d of ['\t', ',', ';']) {
    if (line.includes(d)) return line.split(d).map((s) => s.trim());
  }
  return [line.trim()];
}

export function looksLikeId(field: string | undefined): string | null {
  if (!field) return null;
  const s = field.trim();
  if (/^user\d+$/i.test(s)) return s.replace(/\D/g, '');
  if (/^\d{6,}$/.test(s)) return s;
  return null;
}

export function normalizeUsername(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s.startsWith('@')) s = s.slice(1);
  return /^[A-Za-z0-9_]{5,32}$/.test(s) ? s : null;
}

export function parseAmount(field: string | undefined): number | null {
  if (!field) return null;
  const s = field.replace(/[$,€£\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

export function isEmptyIdentity(row: Identity): boolean {
  return !row.name && !row.username && !row.telegramId && !row.email;
}

export interface UserLite {
  id: number;
  display_name: string | null;
  from_id: string | null;
  username: string | null;
  email: string | null;
}

export interface MemberIndex {
  byUsername: Map<string, UserLite>;
  byFromId: Map<string, UserLite>;
  byEmail: Map<string, UserLite>;
  byName: Map<string, UserLite[]>;
}

export async function buildMemberIndex(): Promise<MemberIndex> {
  const { rows } = await pool.query<UserLite>(`SELECT id, display_name, from_id, username, email FROM users`);
  const idx: MemberIndex = { byUsername: new Map(), byFromId: new Map(), byEmail: new Map(), byName: new Map() };
  for (const u of rows) {
    if (u.username) idx.byUsername.set(u.username.toLowerCase(), u);
    if (u.from_id) idx.byFromId.set(u.from_id, u);
    if (u.email) idx.byEmail.set(u.email.toLowerCase(), u);
    if (u.display_name) {
      const key = u.display_name.trim().toLowerCase();
      const arr = idx.byName.get(key);
      if (arr) arr.push(u);
      else idx.byName.set(key, [u]);
    }
  }
  return idx;
}

export interface MatchResult {
  user?: UserLite;
  matchedBy?: 'username' | 'id' | 'email' | 'name';
  reason?: ReviewReason;
  candidates?: UserLite[];
}

export function matchIdentity(row: Identity, idx: MemberIndex): MatchResult {
  if (row.username && idx.byUsername.has(row.username.toLowerCase())) {
    return { user: idx.byUsername.get(row.username.toLowerCase()), matchedBy: 'username' };
  }
  const tgId = row.telegramId ? `user${row.telegramId}` : null;
  if (tgId && idx.byFromId.has(tgId)) {
    return { user: idx.byFromId.get(tgId), matchedBy: 'id' };
  }
  if (row.telegramId && idx.byFromId.has(row.telegramId)) {
    return { user: idx.byFromId.get(row.telegramId), matchedBy: 'id' };
  }
  if (row.email && idx.byEmail.has(row.email.toLowerCase())) {
    return { user: idx.byEmail.get(row.email.toLowerCase()), matchedBy: 'email' };
  }
  if (row.name) {
    const arr = idx.byName.get(row.name.trim().toLowerCase());
    if (arr && arr.length === 1) return { user: arr[0], matchedBy: 'name' };
    if (arr && arr.length > 1) return { reason: 'DUPLICATE_NAME', candidates: arr };
  }
  const hasIdentifier = !!(row.username || row.telegramId || row.email);
  return { reason: hasIdentifier ? 'UNMATCHED' : 'MISSING_IDENTIFIER' };
}

/** Insert an import_reviews row for a row that couldn't be confidently matched. */
export async function createReviewRow(
  batchId: number | null,
  importType: string,
  reason: ReviewReason,
  rawRow: unknown,
  identity: Identity,
  candidates?: UserLite[]
): Promise<void> {
  await pool.query(
    `INSERT INTO import_reviews (batch_id, import_type, reason, raw_row, suggested_name, suggested_username, suggested_telegram_id, suggested_email, candidate_ids)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb)`,
    [
      batchId,
      importType,
      reason,
      JSON.stringify(rawRow),
      identity.name,
      identity.username,
      identity.telegramId,
      identity.email,
      candidates ? JSON.stringify(candidates.map((c) => c.id)) : null,
    ]
  );
}
