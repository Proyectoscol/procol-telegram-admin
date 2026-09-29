import { ensureSchema, queryWithRetry } from '@/lib/db/client';
import { getOrFetch, cacheKey } from '@/lib/cache';
import { getCacheTtlStatsMinutes } from '@/lib/settings';

/** Returns users-summary rows. Uses cache; falls back to heavy CTE query. */
export async function getUsersSummaryData(
  chatIds?: number[],
  start?: string | null,
  end?: string | null
): Promise<unknown[]> {
  const key = cacheKey('users-summary', {
    chatIds: chatIds?.join(',') ?? 'all',
    start: start ?? '',
    end: end ?? '',
  });
  const cacheTtlMs = (await getCacheTtlStatsMinutes()) * 60 * 1000;
  return getOrFetch<unknown[]>(key, async () => {
  await ensureSchema();

  const params: (string | number | number[])[] = [];
  const msgFilters: string[] = [];
  const msgFiltersM: string[] = [];
  const reactFiltersR: string[] = [];
  let idx = 1;

  if (chatIds && chatIds.length > 0) {
    params.push(chatIds);
    msgFilters.push(`chat_id = ANY($${idx}::bigint[])`);
    msgFiltersM.push(`m.chat_id = ANY($${idx}::bigint[])`);
    reactFiltersR.push(`r.chat_id = ANY($${idx}::bigint[])`);
    idx++;
  }
  if (start) {
    params.push(start);
    msgFilters.push(`date >= $${idx}::timestamptz`);
    msgFiltersM.push(`m.date >= $${idx}::timestamptz`);
    reactFiltersR.push(`r.reacted_at >= $${idx}::timestamptz`);
    idx++;
  }
  if (end) {
    params.push(end);
    msgFilters.push(`date <= $${idx}::timestamptz`);
    msgFiltersM.push(`m.date <= $${idx}::timestamptz`);
    reactFiltersR.push(`r.reacted_at <= $${idx}::timestamptz`);
    idx++;
  }

  const chatCond = msgFilters.length > 0 ? `AND ${msgFilters.join(' AND ')}` : '';
  const chatCondM = msgFiltersM.length > 0 ? `AND ${msgFiltersM.join(' AND ')}` : '';
  const chatCondR = reactFiltersR.length > 0 ? `AND ${reactFiltersR.join(' AND ')}` : '';

  const summaryQuery = `
    WITH unified AS (
      SELECT from_id AS uid, type, media_type, edited_at, reply_to_message_id, text, date FROM messages WHERE from_id IS NOT NULL AND type = 'message' ${chatCond}
      UNION ALL
      SELECT actor_id AS uid, type, media_type, edited_at, reply_to_message_id, text, date FROM messages WHERE actor_id IS NOT NULL AND type = 'service' ${chatCond}
    ),
    msg_agg AS (
      SELECT
        uid AS from_id,
        COUNT(*) FILTER (WHERE type = 'message') AS messages_sent,
        COUNT(*) FILTER (WHERE type = 'service') AS service_messages,
        COUNT(*) FILTER (WHERE media_type = 'photo') AS photos,
        COUNT(*) FILTER (WHERE media_type = 'video_file' OR media_type = 'video_message') AS videos,
        COUNT(*) FILTER (WHERE media_type = 'file' OR (media_type IS NOT NULL AND media_type NOT IN ('photo', 'video_file', 'video_message', 'audio_file'))) AS files,
        COUNT(*) FILTER (WHERE media_type = 'audio_file') AS audios,
        COUNT(*) FILTER (WHERE edited_at IS NOT NULL) AS messages_edited,
        COUNT(*) FILTER (WHERE reply_to_message_id IS NOT NULL) AS replies,
        COALESCE(SUM(LENGTH(COALESCE(text, ''))), 0)::bigint AS total_chars,
        COALESCE(SUM(GREATEST(0, LENGTH(TRIM(COALESCE(text, '')))::int - LENGTH(REPLACE(TRIM(COALESCE(text, '')), ' ', '')) + 1)), 0)::bigint AS total_words,
        MIN(date) AS first_activity,
        MAX(date) AS last_activity,
        COUNT(DISTINCT DATE(date))::int AS active_days
      FROM unified
      GROUP BY uid
    ),
    reactions_received AS (
      SELECT m.from_id,
             SUM(COALESCE(rt.total, rc.cnt, 0))::int AS reactions_received
      FROM messages m
      LEFT JOIN LATERAL (SELECT SUM(mrt.total_count)::int AS total FROM message_reaction_totals mrt WHERE mrt.chat_id = m.chat_id AND mrt.message_id = m.message_id) rt ON true
      LEFT JOIN LATERAL (SELECT COUNT(*)::int AS cnt FROM reactions r2 WHERE r2.chat_id = m.chat_id AND r2.message_id = m.message_id) rc ON true
      WHERE m.from_id IS NOT NULL ${chatCondM}
      GROUP BY m.from_id
    ),
    reactions_given AS (
      SELECT r.reactor_from_id AS from_id, COUNT(*)::int AS reactions_given
      FROM reactions r
      WHERE 1=1 ${chatCondR}
      GROUP BY r.reactor_from_id
    ),
    top_reacted AS (
      SELECT DISTINCT ON (r.reactor_from_id) r.reactor_from_id AS from_id, m.from_id AS reacted_to_id
      FROM reactions r
      JOIN messages m ON r.chat_id = m.chat_id AND r.message_id = m.message_id
      WHERE m.from_id IS NOT NULL ${chatCondM}
      GROUP BY r.reactor_from_id, m.from_id
      ORDER BY r.reactor_from_id, COUNT(*) DESC
    ),
    distinct_days AS (
      SELECT u.uid AS from_id, (u.date)::date AS d
      FROM unified u
      GROUP BY u.uid, (u.date)::date
    ),
    with_grp AS (
      SELECT from_id, d,
        d - (ROW_NUMBER() OVER (PARTITION BY from_id ORDER BY d)::int) AS grp
      FROM distinct_days
    ),
    streak_lengths AS (
      SELECT from_id, grp, COUNT(*)::int AS streak_len
      FROM with_grp
      GROUP BY from_id, grp
    ),
    longest_streak AS (
      SELECT from_id, MAX(streak_len)::int AS longest_streak_days
      FROM streak_lengths
      GROUP BY from_id
    )
    SELECT
      u.from_id,
      u.display_name,
      u.username,
      u.is_premium,
      COALESCE(u.is_current_member, FALSE) AS is_current_member,
      COALESCE(ma.messages_sent, 0)::int AS messages_sent,
      COALESCE(ma.service_messages, 0)::int AS service_messages,
      (COALESCE(ma.messages_sent, 0) + COALESCE(ma.service_messages, 0))::int AS total_activity,
      COALESCE(rr.reactions_received, 0) AS reactions_received,
      COALESCE(rg.reactions_given, 0) AS reactions_given,
      COALESCE(ma.photos, 0)::int AS photos,
      COALESCE(ma.videos, 0)::int AS videos,
      COALESCE(ma.files, 0)::int AS files,
      COALESCE(ma.audios, 0)::int AS audios,
      COALESCE(ma.messages_edited, 0)::int AS messages_edited,
      COALESCE(ma.replies, 0)::int AS replies,
      COALESCE(ma.total_words, 0)::bigint AS total_words,
      COALESCE(ma.total_chars, 0)::bigint AS total_chars,
      ma.first_activity,
      ma.last_activity,
      COALESCE(ma.active_days, 0)::int AS active_days,
      COALESCE(ls.longest_streak_days, 0)::int AS longest_streak_days,
      CASE WHEN (COALESCE(ma.messages_sent, 0) + COALESCE(ma.service_messages, 0)) > 0
        THEN ROUND(COALESCE(rr.reactions_received, 0)::numeric / (COALESCE(ma.messages_sent, 0) + COALESCE(ma.service_messages, 0)), 2)
        ELSE 0 END AS reactions_ratio,
      tr.reacted_to_id AS top_reacted_to_id
    FROM users u
    LEFT JOIN msg_agg ma ON ma.from_id = u.from_id
    LEFT JOIN reactions_received rr ON rr.from_id = u.from_id
    LEFT JOIN reactions_given rg ON rg.from_id = u.from_id
    LEFT JOIN top_reacted tr ON tr.from_id = u.from_id
    LEFT JOIN longest_streak ls ON ls.from_id = u.from_id
    ORDER BY COALESCE(u.is_current_member, FALSE) DESC, (COALESCE(ma.messages_sent, 0) + COALESCE(ma.service_messages, 0)) DESC NULLS LAST, u.display_name ASC NULLS LAST
  `;

  const summaryResult = await queryWithRetry(summaryQuery, params);
  const fromIds = Array.from(summaryResult.rows)
    .map((r: { top_reacted_to_id?: string }) => r.top_reacted_to_id)
    .filter(Boolean) as string[];
  const namesQuery =
    fromIds.length > 0
      ? await queryWithRetry(
          'SELECT from_id, display_name FROM users WHERE from_id = ANY($1)',
          [Array.from(new Set(fromIds))]
        )
      : { rows: [] };
  const nameMap = new Map<string, string>();
  for (const r of Array.from(namesQuery.rows)) {
    nameMap.set((r as { from_id: string; display_name: string }).from_id, (r as { display_name: string }).display_name);
  }

  const rows = Array.from(summaryResult.rows).map((r: Record<string, unknown>) => ({
    ...r,
    top_reacted_to_name: r.top_reacted_to_id ? nameMap.get(r.top_reacted_to_id as string) ?? r.top_reacted_to_id : null,
  }));

  return rows;
  }, cacheTtlMs);
}
