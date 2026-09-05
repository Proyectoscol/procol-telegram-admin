/**
 * Shared deterministic matching used by every "match a pasted/uploaded row
 * against an existing member" importer: list imports and the questionnaire
 * import. Username → Telegram ID → email → exact name, in that order.
 */
import { pool } from '@/lib/db/client';
import type { MatchSuggestion } from '@/lib/ai/memberMatch';

export const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export type ReviewReason = 'DUPLICATE_NAME' | 'UNMATCHED' | 'MISSING_IDENTIFIER' | 'AMBIGUOUS_FUZZY_MATCH';

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

/**
 * Finds an "@handle" embedded inside a field, not just a field that IS the
 * handle — pasted list rows are often free text like
 * "29. @itzmomen | 23 | momen | 12th August 1200/4000", where the username
 * isn't its own column. Requires a preceding boundary (start of string or
 * whitespace) so it doesn't grab the domain half of an email like
 * "user@example.com".
 */
export function findUsernameToken(parts: string[]): string | null {
  for (const p of parts) {
    if (EMAIL_RE.test(p)) continue;
    const m = p.match(/(?:^|\s)@(\w{5,32})\b/);
    if (m) return normalizeUsername(`@${m[1]}`);
  }
  return null;
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

/** Splits a pasted blob into individual entries on a standalone "---" separator line, so several people's welcome/intake messages can be pasted and imported in one batch (AI-text importers). */
export function splitTextEntries(raw: string): string[] {
  return raw
    .split(/\r?\n[ \t]*-{3,}[ \t]*\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface UserLite {
  id: number;
  display_name: string | null;
  from_id: string | null;
  username: string | null;
  email: string | null;
}

export interface MemberIndex {
  all: UserLite[];
  byUsername: Map<string, UserLite>;
  byFromId: Map<string, UserLite>;
  byEmail: Map<string, UserLite>;
  byName: Map<string, UserLite[]>;
}

export async function buildMemberIndex(): Promise<MemberIndex> {
  const { rows } = await pool.query<UserLite>(`SELECT id, display_name, from_id, username, email FROM users`);
  const idx: MemberIndex = { all: rows, byUsername: new Map(), byFromId: new Map(), byEmail: new Map(), byName: new Map() };
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
  const hasIdentifier = !!(row.username || row.telegramId || row.email || row.name);
  return { reason: hasIdentifier ? 'UNMATCHED' : 'MISSING_IDENTIFIER' };
}

// ── Fuzzy username matching (Custom Plan Intake import) ─────────────────────
// A separate matcher from matchIdentity above — that one is exact-only and
// stays that way for the existing list/questionnaire imports. This form's
// Telegram username is hand-typed into a Google Form text field, so typos,
// stray spaces, and a missing/extra "@" are common; username is also the
// only identifier this form reliably has (no Telegram numeric ID), so it's
// worth tolerating small edits before falling back to email.

/** >= this normalized similarity is a confident auto-match. Roughly "one or two character edits away" for a typical username length. */
export const FUZZY_USERNAME_MATCH_THRESHOLD = 0.9;
/** >= this (but below the match threshold) is still worth surfacing as a review-queue candidate. */
export const FUZZY_USERNAME_CANDIDATE_THRESHOLD = 0.6;

export function normalizeUsernameLoose(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase().replace(/^@/, '').replace(/\s+/g, '');
  return s.length > 0 ? s : null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
    }
    prev = row;
  }
  return prev[n];
}

/** 0-1 similarity, 1 = identical, after normalizing both sides. */
export function usernameSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Fuzzy-username-first, email-fallback matcher for the Custom Plan Intake
 * import. Never falls back to name matching (this form's "Full name" field
 * is freeform prose in some responses, not a reliable match key).
 */
export function matchIdentityFuzzy(row: Identity, idx: MemberIndex): MatchResult {
  const target = normalizeUsernameLoose(row.username);
  let weakCandidates: UserLite[] = [];

  if (target) {
    const exact = idx.byUsername.get(target);
    if (exact) return { user: exact, matchedBy: 'username' };

    const scored = idx.all
      .filter((u): u is UserLite & { username: string } => !!u.username)
      .map((u) => ({ u, score: usernameSimilarity(target, u.username.toLowerCase()) }))
      .filter((s) => s.score >= FUZZY_USERNAME_CANDIDATE_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    const confident = scored.filter((s) => s.score >= FUZZY_USERNAME_MATCH_THRESHOLD);
    if (confident.length === 1) return { user: confident[0].u, matchedBy: 'username' };
    if (confident.length > 1) return { reason: 'AMBIGUOUS_FUZZY_MATCH', candidates: scored.map((s) => s.u) };
    weakCandidates = scored.map((s) => s.u);
  }

  if (row.email && idx.byEmail.has(row.email.toLowerCase())) {
    return { user: idx.byEmail.get(row.email.toLowerCase()), matchedBy: 'email' };
  }

  const hasIdentifier = !!(row.username || row.email);
  return { reason: hasIdentifier ? 'UNMATCHED' : 'MISSING_IDENTIFIER', candidates: weakCandidates.length ? weakCandidates : undefined };
}

/** Insert an import_reviews row for a row that couldn't be confidently matched. */
export async function createReviewRow(
  batchId: number | null,
  importType: string,
  reason: ReviewReason,
  rawRow: unknown,
  identity: Identity,
  candidates?: UserLite[],
  aiSuggestions?: MatchSuggestion[]
): Promise<void> {
  await pool.query(
    `INSERT INTO import_reviews (batch_id, import_type, reason, raw_row, suggested_name, suggested_username, suggested_telegram_id, suggested_email, candidate_ids, ai_suggestions)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`,
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
      aiSuggestions && aiSuggestions.length > 0 ? JSON.stringify(aiSuggestions) : null,
    ]
  );
}
