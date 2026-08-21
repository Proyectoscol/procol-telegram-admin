/**
 * Teachable course-progress sync: a CSV export with one row per
 * (member, course) — a member enrolled in several courses has several rows
 * (email, name, joined, course, percent_complete, delta, completed_at).
 * Rows are grouped by person (email, falling back to name when email is
 * missing) before matching, so one Telegram member with 6 course rows
 * produces a single match decision and a single review-queue entry instead
 * of six. Matches existing members the same way every other importer does
 * (username → Telegram ID → email → exact name); unmatched people go to the
 * review queue instead of creating a new member — the boss was explicit that
 * a match must be certain (email, or a name with no other candidate) before
 * it's auto-applied.
 */
import { pool } from '@/lib/db/client';
import { logMemberEvent } from '@/lib/timeline';
import { recomputeOpportunities } from '@/lib/opportunities/engine';
import { buildMemberIndex, matchIdentity, createReviewRow, isEmptyIdentity, type Identity, type ReviewReason } from '@/lib/import/matching';
import { suggestMemberMatches } from '@/lib/ai/memberMatch';

// ── CSV parsing (quote-aware) ───────────────────────────────────────────────

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
  email: /e-?mail/i,
  name: /^name$|full.?name|display.?name/i,
  joined: /join/i,
  course: /course/i,
  percentComplete: /percent.*complete|%.*complete|progress/i,
  delta: /delta/i,
  completedAt: /complet(ed|ion).*at|complet(ed|ion).*date/i,
};

export interface TeachableCourseRow {
  courseName: string | null;
  joinedAt: string | null;
  percentComplete: number | null;
  delta: string | null;
  completedAt: string | null;
}

export interface TeachablePerson extends Identity {
  courses: TeachableCourseRow[];
}

function parseNumeric(field: string | null): number | null {
  if (!field) return null;
  const n = Number(field.replace('%', '').trim());
  return Number.isNaN(n) ? null : n;
}

/** Parse the raw CSV and group rows by person (email, falling back to name). */
export function parseTeachableRows(text: string): TeachablePerson[] {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (table.length < 2) return [];

  const header = table[0].map((h) => h.trim());
  const colIndex: Record<string, number> = {};
  for (const [key, pattern] of Object.entries(HEADER_PATTERNS)) {
    const idx = header.findIndex((h) => pattern.test(h));
    if (idx >= 0) colIndex[key] = idx;
  }

  const byKey = new Map<string, TeachablePerson>();
  const order: string[] = [];

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const get = (key: string) => (colIndex[key] != null ? cells[colIndex[key]]?.trim() || null : null);

    const email = get('email')?.toLowerCase() ?? null;
    const name = get('name');
    const key = email || (name ? `name:${name.trim().toLowerCase()}` : null);
    if (!key) continue; // no way to identify this row at all — nothing to group or match on

    const course: TeachableCourseRow = {
      courseName: get('course'),
      joinedAt: get('joined'),
      percentComplete: parseNumeric(get('percentComplete')),
      delta: get('delta'),
      completedAt: get('completedAt'),
    };

    let person = byKey.get(key);
    if (!person) {
      person = { name, username: null, telegramId: null, email, courses: [] };
      byKey.set(key, person);
      order.push(key);
    }
    person.courses.push(course);
  }

  return order.map((k) => byKey.get(k)!);
}

// ── Applying ─────────────────────────────────────────────────────────────

/** Upsert a matched person's course rows onto a member. Used directly and by the review-queue dispatcher. */
export async function applyTeachablePerson(userId: number, person: TeachablePerson): Promise<void> {
  for (const course of person.courses) {
    if (!course.courseName) continue;
    await pool.query(
      `INSERT INTO course_progress (user_id, course_name, teachable_email, teachable_name, joined_at, percent_complete, delta, completed_at, last_synced_at, raw)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8::timestamptz, NOW(), $9::jsonb)
       ON CONFLICT (user_id, course_name) DO UPDATE SET
         teachable_email = EXCLUDED.teachable_email,
         teachable_name = EXCLUDED.teachable_name,
         joined_at = COALESCE(course_progress.joined_at, EXCLUDED.joined_at),
         percent_complete = EXCLUDED.percent_complete,
         delta = EXCLUDED.delta,
         completed_at = COALESCE(EXCLUDED.completed_at, course_progress.completed_at),
         last_synced_at = NOW(),
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        userId,
        course.courseName,
        person.email,
        person.name,
        course.joinedAt,
        course.percentComplete,
        course.delta,
        course.completedAt,
        JSON.stringify(course),
      ]
    );
  }

  // Backfill the member's email from Teachable if we don't have one yet — this
  // makes future syncs match by email (the most reliable identifier) instead
  // of falling back to name matching.
  if (person.email) {
    await pool.query(`UPDATE users SET email = COALESCE(email, $2), updated_at = NOW() WHERE id = $1`, [userId, person.email]);
  }

  const courseNames = person.courses.map((c) => c.courseName).filter(Boolean).join(', ');
  await logMemberEvent(userId, 'COURSE_PROGRESS', `Teachable progress synced (${person.courses.length} course${person.courses.length === 1 ? '' : 's'})`, {
    description: courseNames || undefined,
    source: 'teachable_import',
  });
}

// ── Preview + apply ──────────────────────────────────────────────────────

export interface TeachablePreviewRow {
  input: TeachablePerson;
  status: 'update' | 'review' | 'skip';
  matchedUserName?: string;
  reason?: ReviewReason;
  candidateCount?: number;
}

export interface TeachablePreviewResult {
  rows: TeachablePreviewRow[];
  counts: { total: number; update: number; review: number; skip: number };
}

export async function previewTeachable(text: string): Promise<TeachablePreviewResult> {
  const people = parseTeachableRows(text);
  const idx = await buildMemberIndex();
  const preview: TeachablePreviewRow[] = people.map((input) => {
    if (isEmptyIdentity(input)) return { input, status: 'skip' };
    const m = matchIdentity(input, idx);
    if (m.user) return { input, status: 'update', matchedUserName: m.user.display_name ?? undefined };
    return { input, status: 'review', reason: m.reason, candidateCount: m.candidates?.length ?? 0 };
  });
  const counts = {
    total: people.length,
    update: preview.filter((r) => r.status === 'update').length,
    review: preview.filter((r) => r.status === 'review').length,
    skip: preview.filter((r) => r.status === 'skip').length,
  };
  return { rows: preview, counts };
}

export interface TeachableSummary {
  totalPeople: number;
  totalCourseRows: number;
  updated: number;
  unmatched: number;
  skipped: number;
  errors: string[];
  batchId: number;
}

export async function applyTeachable(text: string, fileName: string): Promise<TeachableSummary> {
  const people = parseTeachableRows(text);
  const idx = await buildMemberIndex();

  let updated = 0;
  let unmatched = 0;
  let skipped = 0;
  const errors: string[] = [];
  const touched = new Set<number>();
  const totalCourseRows = people.reduce((n, p) => n + p.courses.length, 0);

  const batchRes = await pool.query<{ id: number }>(
    `INSERT INTO import_batches (kind, filename, total_rows) VALUES ('TEACHABLE', $1, $2) RETURNING id`,
    [fileName, people.length]
  );
  const batchId = batchRes.rows[0].id;

  const pendingReview: { person: TeachablePerson; reason: ReviewReason; candidates?: ReturnType<typeof matchIdentity>['candidates'] }[] = [];

  for (const person of people) {
    if (isEmptyIdentity(person)) {
      skipped++;
      continue;
    }
    const m = matchIdentity(person, idx);
    if (m.user) {
      try {
        await applyTeachablePerson(m.user.id, person);
        touched.add(m.user.id);
        updated++;
      } catch (e) {
        errors.push(`${person.name ?? person.email}: ${(e as Error).message}`);
      }
    } else {
      unmatched++;
      pendingReview.push({ person, reason: m.reason ?? 'UNMATCHED', candidates: m.candidates });
    }
  }

  // One batched AI call covers every unmatched person in this import,
  // reusing the same roster context — cheaper and lets the model disambiguate
  // across the whole batch instead of guessing each row in isolation.
  const aiSuggestions = await suggestMemberMatches(
    pendingReview
      .filter((r) => r.reason !== 'MISSING_IDENTIFIER') // nothing to match on
      .map((r) => ({ key: r.person.email ?? r.person.name ?? '', name: r.person.name, email: r.person.email })),
    idx.all
  );

  for (const r of pendingReview) {
    const key = r.person.email ?? r.person.name ?? '';
    await createReviewRow(batchId, 'TEACHABLE', r.reason, r.person, r.person, r.candidates, aiSuggestions.get(key));
  }

  await pool.query(
    `UPDATE import_batches SET members_updated = $2, unmatched = $3, skipped = $4, error_count = $5 WHERE id = $1`,
    [batchId, updated, unmatched, skipped, errors.length]
  );

  if (touched.size) await recomputeOpportunities(Array.from(touched));

  return { totalPeople: people.length, totalCourseRows, updated, unmatched, skipped, errors, batchId };
}
