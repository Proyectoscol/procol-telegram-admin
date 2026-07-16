/**
 * Deterministic list-import pipeline: parse pasted rows → match against
 * existing users (username → Telegram ID → email → exact name) → apply
 * per-type rules + tags, sending anything uncertain to the review queue.
 * No AI, no fuzzy matching. Ported from new-money-crm-code's
 * src/lib/importCenter.ts onto this project's Postgres `users` table.
 *
 * Payment/list rows are never auto-created as new users — an admin resolves
 * unmatched rows in the review queue instead, so a mistyped name doesn't
 * silently create a duplicate contact.
 */
import { pool } from '@/lib/db/client';
import { logMemberEvent } from '@/lib/timeline';
import { recomputeOpportunities } from '@/lib/opportunities/engine';
import {
  EMAIL_RE,
  splitLine,
  looksLikeId,
  normalizeUsername,
  parseAmount,
  isEmptyIdentity,
  buildMemberIndex,
  matchIdentity,
  createReviewRow,
  type Identity,
  type ReviewReason,
} from '@/lib/import/matching';

export interface ImportTypeConfig {
  id: string;
  label: string;
  hint: string;
  tag?: string;
  offerType?: string;
  paymentStatus?: string;
  premiumAccess?: boolean;
}

export const IMPORT_TYPES: ImportTypeConfig[] = [
  { id: 'EMAIL', label: 'Email list', hint: 'name / username, email — one per line, comma or tab separated.' },
  { id: 'PAYMENT_PLAN', label: 'Payment plan list', hint: 'name / username / email, amount (optional).', tag: 'Payment Plan', offerType: 'PAYMENT_PLAN', paymentStatus: 'PAYMENT_PLAN' },
  // Lifetime is a superset of Premium — Lifetime members get Premium access too.
  { id: 'LIFETIME', label: 'Lifetime member list', hint: 'name / username / email, amount (optional).', tag: 'Lifetime', offerType: 'LIFETIME', paymentStatus: 'PAID', premiumAccess: true },
  { id: 'PREMIUM', label: 'Premium member list', hint: 'name / username / email.', tag: 'Premium', offerType: 'PREMIUM', premiumAccess: true },
  { id: 'EVENT_TICKET', label: 'Event ticket list', hint: 'name / username / email.', tag: 'Event Ticket', offerType: 'EVENT_TICKET' },
  { id: 'MEMBER_UPDATE', label: 'General member update / notes', hint: 'name / username / email, plus notes and/or amount.' },
];

export function getImportType(id: string): ImportTypeConfig | undefined {
  return IMPORT_TYPES.find((t) => t.id === id);
}

// ── Parsing ────────────────────────────────────────────────────────────────

export interface MemberRow extends Identity {
  amount: number | null;
  notes: string | null;
}

export type RowStatus = 'update' | 'review' | 'skip';

export interface PreviewRow {
  input: MemberRow;
  status: RowStatus;
  matchedBy?: 'username' | 'id' | 'email' | 'name';
  matchedUserId?: number;
  matchedUserName?: string;
  reason?: ReviewReason;
  candidateCount?: number;
}

export interface ListSummary {
  total: number;
  updated: number;
  tagged: number;
  unmatched: number;
  skipped: number;
  /** Matched a member but the row had nothing to apply (e.g. a header-less notes field). */
  noChange: number;
  errors: string[];
  batchId: number;
}

export function parseMemberRows(text: string): MemberRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^﻿/, '').trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  let start = 0;
  let cols: Record<string, number> | null = null;
  const first = splitLine(lines[0]).map((s) => s.toLowerCase());
  // A single pasted line is always data — there'd be nothing left to import
  // otherwise. Without this, a lone row whose free-text field happens to
  // contain a column-name-like word (e.g. "note") gets misread as a header
  // and silently produces zero rows.
  const headerish =
    lines.length > 1 &&
    first.some((c) => /e-?mail|username|name|note|amount|price|paid|id|handle/.test(c)) &&
    !first.some((c) => looksLikeId(c) || EMAIL_RE.test(c));
  if (headerish) {
    start = 1;
    const find = (re: RegExp, not?: number[]) => first.findIndex((c, i) => (!not || !not.includes(i)) && re.test(c));
    const id = find(/(telegram|user).*id|^id$|tg.?id/);
    const email = find(/e-?mail/);
    const username = find(/user\s*name|handle|^user$/, [id, email]);
    const name = find(/full.?name|^name$|display/, [id, email, username]);
    const amount = find(/amount|price|paid|value/);
    const notes = find(/note|comment|remark|memo/);
    cols = { id, email, username, name, amount, notes };
  }

  const rows: MemberRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const parts = splitLine(lines[i]);
    const at = (idx: number | undefined) => (idx !== undefined && idx >= 0 ? parts[idx] : undefined);

    const telegramId = looksLikeId(at(cols?.id)) ?? parts.map(looksLikeId).find(Boolean) ?? null;
    let email: string | null = at(cols?.email)?.trim().toLowerCase() ?? null;
    if (!email || !EMAIL_RE.test(email)) email = parts.find((p) => EMAIL_RE.test(p))?.toLowerCase() ?? null;
    let username = normalizeUsername(at(cols?.username));
    if (!username) username = normalizeUsername(parts.find((p) => p.startsWith('@')));
    let name: string | null = at(cols?.name)?.trim() || null;
    if (name && (looksLikeId(name) || EMAIL_RE.test(name) || normalizeUsername(name) === username)) name = null;
    if (!name) {
      const cand = parts.find(
        (p) => p && !looksLikeId(p) && !EMAIL_RE.test(p) && normalizeUsername(p) === null && !p.startsWith('@') && parseAmount(p) === null
      );
      name = cand?.trim() || null;
    }
    const amount = parseAmount(at(cols?.amount)) ?? (cols ? null : parts.map(parseAmount).find((a) => a != null) ?? null);
    const notes = at(cols?.notes)?.trim() || null;

    rows.push({ name, username, telegramId, email, amount, notes });
  }
  return rows;
}

export const isEmptyRow = isEmptyIdentity;

// ── Applying rules ─────────────────────────────────────────────────────────

/**
 * Apply a list-import type's rules (tag/offer/payment/email/notes) to a member.
 * Used directly and by the review-queue dispatcher. Returns whether anything
 * was actually written — a row with a header-less "notes" field (there's no
 * positional heuristic to find free text; add a header row like
 * "name,notes" to capture it) can match a member but have nothing to apply.
 */
export async function applyTypeRules(userId: number, typeId: string, row: MemberRow): Promise<boolean> {
  const cfg = getImportType(typeId);
  if (!cfg) return false;

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };

  if (cfg.offerType) push('offer_type', cfg.offerType);
  if (cfg.paymentStatus) push('payment_status', cfg.paymentStatus);
  if (cfg.premiumAccess) push('is_premium', true);
  if (row.amount != null) push('amount_paid', row.amount);
  if (typeId === 'EMAIL' && row.email) push('email', row.email);
  if (typeId === 'MEMBER_UPDATE') {
    if (row.email) push('email', row.email);
    if (row.notes) push('notes', row.notes);
  }

  if (cfg.tag) {
    // tags is a JSONB text array; add the tag if not already present.
    params.push(JSON.stringify([cfg.tag]));
    sets.push(`tags = (SELECT COALESCE(jsonb_agg(DISTINCT t), '[]'::jsonb) FROM jsonb_array_elements_text(tags || $${params.length}::jsonb) AS t)`);
  }

  if (sets.length === 0) return false;
  params.push(userId);
  await pool.query(`UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);

  await logMemberEvent(userId, 'IMPORT', `${cfg.label} import applied`, {
    description: row.notes ?? undefined,
    source: 'list_import',
  });
  return true;
}

// ── Preview + apply ──────────────────────────────────────────────────────

export interface PreviewResult {
  rows: PreviewRow[];
  counts: { total: number; update: number; review: number; skip: number };
}

export async function previewList(typeId: string, text: string): Promise<PreviewResult> {
  const rows = parseMemberRows(text);
  const idx = await buildMemberIndex();
  const preview: PreviewRow[] = rows.map((input) => {
    if (isEmptyRow(input)) return { input, status: 'skip' };
    const m = matchIdentity(input, idx);
    if (m.user) {
      return { input, status: 'update', matchedBy: m.matchedBy, matchedUserId: m.user.id, matchedUserName: m.user.display_name ?? undefined };
    }
    return { input, status: 'review', reason: m.reason, candidateCount: m.candidates?.length ?? 0 };
  });
  const counts = {
    total: rows.length,
    update: preview.filter((r) => r.status === 'update').length,
    review: preview.filter((r) => r.status === 'review').length,
    skip: preview.filter((r) => r.status === 'skip').length,
  };
  return { rows: preview, counts };
}

export async function applyList(typeId: string, text: string, fileName: string): Promise<ListSummary> {
  const rows = parseMemberRows(text);
  const idx = await buildMemberIndex();
  const cfg = getImportType(typeId);

  let updated = 0;
  let tagged = 0;
  let unmatched = 0;
  let skipped = 0;
  let noChange = 0;
  const errors: string[] = [];
  const touched = new Set<number>();

  const batchRes = await pool.query<{ id: number }>(
    `INSERT INTO import_batches (kind, filename, total_rows) VALUES ($1, $2, $3) RETURNING id`,
    [typeId, fileName, rows.length]
  );
  const batchId = batchRes.rows[0].id;

  for (const row of rows) {
    if (isEmptyRow(row)) {
      skipped++;
      continue;
    }
    const m = matchIdentity(row, idx);
    if (m.user) {
      try {
        const wrote = await applyTypeRules(m.user.id, typeId, row);
        if (wrote) {
          touched.add(m.user.id);
          updated++;
          if (cfg?.tag) tagged++;
        } else {
          noChange++;
        }
      } catch (e) {
        errors.push(`${row.name ?? row.username ?? row.email}: ${(e as Error).message}`);
      }
    } else {
      unmatched++;
      await createReviewRow(batchId, typeId, m.reason ?? 'UNMATCHED', row, row, m.candidates);
    }
  }

  await pool.query(
    `UPDATE import_batches SET members_updated = $2, tagged = $3, unmatched = $4, skipped = $5, error_count = $6 WHERE id = $1`,
    [batchId, updated, tagged, unmatched, skipped, errors.length]
  );

  if (touched.size) await recomputeOpportunities(Array.from(touched));

  return { total: rows.length, updated, tagged, unmatched, skipped, noChange, errors, batchId };
}
