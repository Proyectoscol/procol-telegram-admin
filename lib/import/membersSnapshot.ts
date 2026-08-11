/**
 * Shared core for "group members" snapshots: resets/upserts is_current_member
 * for a group's members, and marking matched users as premium. Used by both
 * the manual CSV upload routes (app/api/import/members*) and the Telegram
 * scraper's automated refresh (app/api/telegram-scraper/refresh), so the two
 * paths can never drift in behavior.
 */

import { pool } from '@/lib/db/client';
import { log } from '@/lib/logger';
import type { MemberRow } from '@/lib/import/parseMembersCSV';

const BATCH_SIZE = 200;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface MembersSnapshotResult {
  added: number;
  updated: number;
  total: number;
  groupId: string | null;
  durationMs: number;
  errors: string[];
}

/**
 * 1. Resets is_current_member = FALSE for all users previously in the group
 *    (via messages/reactions in chat_id = groupId, or everyone if groupId is
 *    unknown).
 * 2. Upserts each row, setting is_current_member = TRUE.
 */
export async function applyMembersSnapshot(
  rows: MemberRow[],
  groupId: bigint | null,
  sourceLabel: string
): Promise<MembersSnapshotResult> {
  const t0 = Date.now();
  let added = 0;
  let updated = 0;
  const errors: string[] = [];
  const maxErrors = 50;

  log.startup(`[members-import] ▶ Starting — ${rows.length} members from ${sourceLabel} groupId=${groupId}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (groupId !== null) {
      await client.query(
        `UPDATE users SET is_current_member = FALSE, updated_at = NOW()
         WHERE from_id IN (
           SELECT DISTINCT from_id FROM messages WHERE chat_id = $1 AND from_id IS NOT NULL
           UNION
           SELECT DISTINCT reactor_from_id FROM reactions WHERE chat_id = $1
         )`,
        [String(groupId)]
      );
      log.startup(`[members-import] Reset is_current_member=FALSE for group ${groupId}`);
    } else {
      await client.query(`UPDATE users SET is_current_member = FALSE, updated_at = NOW()`);
      log.startup(`[members-import] Reset is_current_member=FALSE for all users (no groupId)`);
    }

    const fromIds = rows.map((r) => r.fromId);
    const existingRes = await client.query<{ from_id: string }>(
      'SELECT from_id FROM users WHERE from_id = ANY($1::text[])',
      [fromIds]
    );
    const existingSet = new Set(existingRes.rows.map((r) => r.from_id));

    const batches = chunks(rows, BATCH_SIZE);
    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      const batch = batches[bIdx];
      try {
        await client.query(
          `INSERT INTO users (from_id, display_name, username, is_current_member, member_since, updated_at)
           SELECT
             unnest($1::text[]),
             unnest($2::text[]),
             unnest($3::text[]),
             TRUE,
             NOW(),
             NOW()
           ON CONFLICT (from_id) DO UPDATE SET
             is_current_member = TRUE,
             display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name),
             username = COALESCE(NULLIF(EXCLUDED.username, ''), users.username),
             member_since = COALESCE(users.member_since, NOW()),
             updated_at = NOW()`,
          [
            batch.map((r) => r.fromId),
            batch.map((r) => r.displayName ?? r.fromId),
            batch.map((r) => r.username),
          ]
        );
        for (const r of batch) {
          if (existingSet.has(r.fromId)) updated++;
          else added++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (errors.length < maxErrors) errors.push(`batch ${bIdx + 1}: ${msg}`);
        log.error('members-import', `Batch ${bIdx + 1} failed`, err);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const durationMs = Date.now() - t0;
  log.startup(`[members-import] 🏁 Done — ${durationMs}ms | added=${added} | updated=${updated} | total=${rows.length} | groupId=${groupId}`);

  return {
    added,
    updated,
    total: rows.length,
    groupId: groupId != null ? String(groupId) : null,
    durationMs,
    errors,
  };
}

export interface MembersPremiumSnapshotResult {
  updated: number;
  total: number;
  durationMs: number;
}

/**
 * For each row that matches an existing user by from_id, sets is_premium =
 * TRUE and premium_since = COALESCE(premium_since, NOW()) — and, since
 * Premium always implies Lifetime, also sets is_lifetime = TRUE /
 * lifetime_since. Does not insert new users; does not unset is_premium for
 * anyone missing from the rows (that's a manual/other-flow decision).
 */
export async function applyMembersPremiumSnapshot(
  rows: MemberRow[],
  sourceLabel: string
): Promise<MembersPremiumSnapshotResult> {
  const t0 = Date.now();
  log.startup(`[members-premium-import] ▶ Starting — ${rows.length} rows from ${sourceLabel}`);

  const fromIds: string[] = [];
  const seen: Record<string, boolean> = {};
  for (const row of rows) {
    if (!seen[row.fromId]) {
      seen[row.fromId] = true;
      fromIds.push(row.fromId);
    }
  }

  const result = await pool.query(
    `UPDATE users
     SET is_premium = TRUE,
         premium_since = COALESCE(premium_since, NOW()),
         is_lifetime = TRUE,
         lifetime_since = COALESCE(lifetime_since, NOW()),
         updated_at = NOW()
     WHERE from_id = ANY($1::text[])`,
    [fromIds]
  );

  const updated = result.rowCount ?? 0;
  const durationMs = Date.now() - t0;
  log.startup(`[members-premium-import] 🏁 Done — ${durationMs}ms | updated=${updated} | total rows=${rows.length}`);

  return { updated, total: rows.length, durationMs };
}
