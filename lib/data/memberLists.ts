/**
 * Member rosters for the "Copy Main members" / "Copy Premium members"
 * buttons on the Import page — same shape/columns as the Analytics export
 * (components/ExportCsvModal.tsx), so they can reuse that CSV/formatted-text
 * copy-to-clipboard UI as-is.
 */
import { ensureSchema, pool } from '@/lib/db/client';
import { getOrFetch, cacheKey } from '@/lib/cache';
import { getCacheTtlStatsMinutes } from '@/lib/settings';

export interface MemberRosterRow {
  from_id: string;
  display_name: string | null;
  username: string | null;
  is_current_member: boolean;
  is_premium: boolean;
  messages_sent: number;
  reactions_given: number;
}

export type RosterRole = 'main' | 'premium';

async function fetchRoster(role: RosterRole): Promise<MemberRosterRow[]> {
  await ensureSchema();
  const whereClause = role === 'main' ? 'u.is_current_member = TRUE' : 'u.is_premium = TRUE';
  const { rows } = await pool.query<MemberRosterRow>(
    `SELECT
       u.from_id,
       u.display_name,
       u.username,
       u.is_current_member,
       u.is_premium,
       COALESCE(m.cnt, 0)::int AS messages_sent,
       COALESCE(r.cnt, 0)::int AS reactions_given
     FROM users u
     LEFT JOIN (
       SELECT from_id, COUNT(*) AS cnt FROM messages WHERE from_id IS NOT NULL AND type = 'message' GROUP BY from_id
     ) m ON m.from_id = u.from_id
     LEFT JOIN (
       SELECT reactor_from_id, COUNT(*) AS cnt FROM reactions GROUP BY reactor_from_id
     ) r ON r.reactor_from_id = u.from_id
     WHERE ${whereClause}
     ORDER BY u.display_name NULLS LAST, u.username NULLS LAST`
  );
  return rows;
}

/** Cached (same TTL as the stats pages) — this scans all messages/reactions, so avoid re-running it on every click. */
export async function getMemberRoster(role: RosterRole): Promise<MemberRosterRow[]> {
  const key = cacheKey('member-roster', { role });
  const cacheTtlMs = (await getCacheTtlStatsMinutes()) * 60 * 1000;
  return getOrFetch(key, () => fetchRoster(role), cacheTtlMs);
}
