/**
 * Welcome questionnaire import: a real CSV export (Google Forms/Typeform/etc.)
 * with one column per question. Columns are matched by header keyword, not
 * fixed position, since form exports vary. Every column is kept in
 * raw_answers regardless of whether it matched a known field, so nothing is
 * silently dropped. Matches existing members the same way list imports do
 * (username → Telegram ID → email → exact name); unmatched rows go to the
 * review queue instead of creating a new member.
 */
import { pool } from '@/lib/db/client';
import { logMemberEvent } from '@/lib/timeline';
import { recomputeOpportunities } from '@/lib/opportunities/engine';
import { buildMemberIndex, matchIdentity, createReviewRow, isEmptyIdentity, type Identity, type ReviewReason } from '@/lib/import/matching';

// ── CSV parsing (quote-aware — form exports are real CSV, answers can contain commas) ──

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const HEADER_PATTERNS: Record<string, RegExp> = {
  telegramId: /(telegram|user).*id|^id$|tg.?id/i,
  email: /e-?mail/i,
  username: /user\s*name|handle|^user$/i,
  name: /full.?name|^name$|display.?name/i,
  ageRange: /\bage\b/i,
  location: /location|\bcity\b|\bcountry\b|where.*(from|live)/i,
  goals: /\bgoal/i,
  business: /business|industry|niche|occupation|what.*do.*you.*do/i,
  whyJoined: /why.*(join|here)|reason.*join/i,
};

export interface QuestionnaireRow extends Identity {
  ageRange: string | null;
  location: string | null;
  goals: string | null;
  business: string | null;
  whyJoined: string | null;
  rawAnswers: Record<string, string>;
}

export function parseQuestionnaireRows(text: string): QuestionnaireRow[] {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (table.length < 2) return []; // needs a header + at least one data row

  const header = table[0].map((h) => h.trim());
  const colIndex: Record<string, number> = {};
  for (const [key, pattern] of Object.entries(HEADER_PATTERNS)) {
    const idx = header.findIndex((h) => pattern.test(h));
    if (idx >= 0) colIndex[key] = idx;
  }

  const rows: QuestionnaireRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const get = (key: string) => (colIndex[key] != null ? cells[colIndex[key]]?.trim() || null : null);

    const rawAnswers: Record<string, string> = {};
    header.forEach((h, idx) => {
      const v = cells[idx]?.trim();
      if (h && v) rawAnswers[h] = v;
    });

    rows.push({
      name: get('name'),
      username: get('username')?.replace(/^@/, '') ?? null,
      telegramId: get('telegramId'),
      email: get('email')?.toLowerCase() ?? null,
      ageRange: get('ageRange'),
      location: get('location'),
      goals: get('goals'),
      business: get('business'),
      whyJoined: get('whyJoined'),
      rawAnswers,
    });
  }
  return rows;
}

// ── Applying ─────────────────────────────────────────────────────────────

/** Upsert a matched row's answers onto a member. Used directly and by the review-queue dispatcher. */
export async function applyQuestionnaireRow(userId: number, row: QuestionnaireRow): Promise<void> {
  await pool.query(
    `INSERT INTO questionnaire_responses (user_id, age_range, location, goals, business, why_joined, raw_answers, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       age_range = COALESCE(EXCLUDED.age_range, questionnaire_responses.age_range),
       location = COALESCE(EXCLUDED.location, questionnaire_responses.location),
       goals = COALESCE(EXCLUDED.goals, questionnaire_responses.goals),
       business = COALESCE(EXCLUDED.business, questionnaire_responses.business),
       why_joined = COALESCE(EXCLUDED.why_joined, questionnaire_responses.why_joined),
       raw_answers = questionnaire_responses.raw_answers || EXCLUDED.raw_answers,
       submitted_at = NOW()`,
    [userId, row.ageRange, row.location, row.goals, row.business, row.whyJoined, JSON.stringify(row.rawAnswers)]
  );
  await logMemberEvent(userId, 'IMPORT', 'Welcome questionnaire imported', { source: 'questionnaire_import' });
}

// ── Preview + apply ──────────────────────────────────────────────────────

export interface QuestionnairePreviewRow {
  input: QuestionnaireRow;
  status: 'update' | 'review' | 'skip';
  matchedUserName?: string;
  reason?: ReviewReason;
  candidateCount?: number;
}

export interface QuestionnairePreviewResult {
  rows: QuestionnairePreviewRow[];
  counts: { total: number; update: number; review: number; skip: number };
}

export async function previewQuestionnaire(text: string): Promise<QuestionnairePreviewResult> {
  const rows = parseQuestionnaireRows(text);
  const idx = await buildMemberIndex();
  const preview: QuestionnairePreviewRow[] = rows.map((input) => {
    if (isEmptyIdentity(input)) return { input, status: 'skip' };
    const m = matchIdentity(input, idx);
    if (m.user) return { input, status: 'update', matchedUserName: m.user.display_name ?? undefined };
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

export interface QuestionnaireSummary {
  total: number;
  updated: number;
  unmatched: number;
  skipped: number;
  errors: string[];
  batchId: number;
}

export async function applyQuestionnaire(text: string, fileName: string): Promise<QuestionnaireSummary> {
  const rows = parseQuestionnaireRows(text);
  const idx = await buildMemberIndex();

  let updated = 0;
  let unmatched = 0;
  let skipped = 0;
  const errors: string[] = [];
  const touched = new Set<number>();

  const batchRes = await pool.query<{ id: number }>(
    `INSERT INTO import_batches (kind, filename, total_rows) VALUES ('QUESTIONNAIRE', $1, $2) RETURNING id`,
    [fileName, rows.length]
  );
  const batchId = batchRes.rows[0].id;

  for (const row of rows) {
    if (isEmptyIdentity(row)) {
      skipped++;
      continue;
    }
    const m = matchIdentity(row, idx);
    if (m.user) {
      try {
        await applyQuestionnaireRow(m.user.id, row);
        touched.add(m.user.id);
        updated++;
      } catch (e) {
        errors.push(`${row.name ?? row.username ?? row.email}: ${(e as Error).message}`);
      }
    } else {
      unmatched++;
      await createReviewRow(batchId, 'QUESTIONNAIRE', m.reason ?? 'UNMATCHED', row, row, m.candidates);
    }
  }

  await pool.query(
    `UPDATE import_batches SET members_updated = $2, unmatched = $3, skipped = $4, error_count = $5 WHERE id = $1`,
    [batchId, updated, unmatched, skipped, errors.length]
  );

  if (touched.size) await recomputeOpportunities(Array.from(touched));

  return { total: rows.length, updated, unmatched, skipped, errors, batchId };
}
