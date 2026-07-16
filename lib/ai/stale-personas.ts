import { pool } from '@/lib/db/client';

/**
 * Members whose AI persona is missing or stale: no persona yet, or new
 * member_events / messages since their last persona run. Never-generated
 * members come first, then the oldest-stale. Only current members —
 * generating for someone who left doesn't help anyone act on it.
 */
export async function getStaleMemberIds(limit: number): Promise<{ id: number; name: string | null }[]> {
  const { rows } = await pool.query<{ id: number; name: string | null }>(
    `SELECT u.id, u.display_name AS name
     FROM users u
     LEFT JOIN contact_personas cp ON cp.user_id = u.id
     WHERE COALESCE(u.is_current_member, false) = true
       AND (
         cp.user_id IS NULL
         OR EXISTS (SELECT 1 FROM member_events me WHERE me.user_id = u.id AND me.occurred_at > cp.run_at)
         OR (u.from_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM messages m WHERE m.from_id = u.from_id AND m.type = 'message' AND m.date > cp.run_at
            ))
       )
     ORDER BY (cp.run_at IS NULL) DESC, cp.run_at ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  );
  return rows;
}
