/**
 * GET /api/users/[fromId]/top-relationships
 *
 * Returns the top 3 members this user has interacted with the most (reactions and replies, both directions).
 */
import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, queryWithRetry } from '@/lib/db/client';
import { parseChatIds } from '@/lib/api/chat-params';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const { searchParams } = request.nextUrl;
    const chatIds = parseChatIds(searchParams);
    const start = searchParams.get('start') || null;
    const end = searchParams.get('end') || null;
    const hasRange = start != null && start !== '' && end != null && end !== '';

    const paramsArr: (string | number[])[] = [fromId];
    if (chatIds && chatIds.length > 0) paramsArr.push(chatIds);
    if (hasRange) {
      paramsArr.push(start!);
      paramsArr.push(end!);
    }
    const idxChat = chatIds && chatIds.length > 0 ? 2 : 0;
    const idxStart = hasRange ? (idxChat ? 3 : 2) : 0;
    const idxEnd = hasRange ? (idxChat ? 4 : 3) : 0;

    const chatCond = idxChat ? ` AND m.chat_id = ANY($${idxChat}::bigint[])` : '';
    const chatCondR = idxChat ? ` AND r.chat_id = ANY($${idxChat}::bigint[])` : '';
    const chatCondParent = idxChat ? ` AND parent.chat_id = ANY($${idxChat}::bigint[])` : '';
    const chatCondM = idxChat ? ` AND m.chat_id = ANY($${idxChat}::bigint[])` : '';
    const dateCondMsg = hasRange ? ` AND m.date >= $${idxStart}::timestamptz AND m.date <= $${idxEnd}::timestamptz` : '';
    const dateCondParent = hasRange ? ` AND parent.date >= $${idxStart}::timestamptz AND parent.date <= $${idxEnd}::timestamptz` : '';
    const dateCondR = hasRange ? ` AND r.reacted_at >= $${idxStart}::timestamptz AND r.reacted_at <= $${idxEnd}::timestamptz` : '';

    const q = `
WITH
reactions_to AS (
  SELECT m.from_id AS other_from_id, COUNT(*)::int AS cnt FROM reactions r
  JOIN messages m ON r.chat_id = m.chat_id AND r.message_id = m.message_id
  WHERE r.reactor_from_id = $1 AND m.from_id IS NOT NULL AND m.from_id != $1${chatCondR}${dateCondR}
  GROUP BY m.from_id
),
replies_to AS (
  SELECT parent.from_id AS other_from_id, COUNT(*)::int AS cnt
  FROM messages m
  JOIN messages parent ON parent.chat_id = m.chat_id AND parent.message_id = m.reply_to_message_id
  WHERE m.from_id = $1 AND parent.from_id IS NOT NULL AND parent.from_id != $1${chatCondParent}${dateCondMsg}
  GROUP BY parent.from_id
),
reactions_from AS (
  SELECT r.reactor_from_id AS other_from_id, COUNT(*)::int AS cnt
  FROM reactions r
  JOIN messages m ON r.chat_id = m.chat_id AND r.message_id = m.message_id
  WHERE m.from_id = $1 AND r.reactor_from_id != $1${chatCondR}${dateCondR}
  GROUP BY r.reactor_from_id
),
replies_from AS (
  SELECT m.from_id AS other_from_id, COUNT(*)::int AS cnt
  FROM messages m
  JOIN messages parent ON parent.chat_id = m.chat_id AND parent.message_id = m.reply_to_message_id
  WHERE parent.from_id = $1 AND m.from_id != $1${chatCondM}${dateCondMsg}
  GROUP BY m.from_id
),
combined AS (
  SELECT other_from_id, 'reactions_to' AS kind, cnt FROM reactions_to
  UNION ALL SELECT other_from_id, 'replies_to', cnt FROM replies_to
  UNION ALL SELECT other_from_id, 'reactions_from', cnt FROM reactions_from
  UNION ALL SELECT other_from_id, 'replies_from', cnt FROM replies_from
),
agg AS (
  SELECT other_from_id,
    COALESCE(SUM(CASE WHEN kind = 'reactions_to' THEN cnt ELSE 0 END), 0) AS reactions_to,
    COALESCE(SUM(CASE WHEN kind = 'replies_to' THEN cnt ELSE 0 END), 0) AS replies_to,
    COALESCE(SUM(CASE WHEN kind = 'reactions_from' THEN cnt ELSE 0 END), 0) AS reactions_from,
    COALESCE(SUM(CASE WHEN kind = 'replies_from' THEN cnt ELSE 0 END), 0) AS replies_from,
    SUM(cnt)::int AS total_score
  FROM combined
  GROUP BY other_from_id
)
SELECT a.other_from_id, u.display_name AS other_display_name,
  a.reactions_to, a.replies_to, a.reactions_from, a.replies_from, a.total_score
FROM agg a
LEFT JOIN users u ON u.from_id = a.other_from_id
ORDER BY a.total_score DESC
LIMIT 3
`;
    const res = await queryWithRetry<{
      other_from_id: string;
      other_display_name: string | null;
      reactions_to: number;
      replies_to: number;
      reactions_from: number;
      replies_from: number;
      total_score: number;
    }>(q, paramsArr);

    const list = res.rows.map((r) => ({
      otherFromId: r.other_from_id,
      otherDisplayName: r.other_display_name ?? r.other_from_id,
      reactionsToThem: r.reactions_to,
      repliesToThem: r.replies_to,
      reactionsFromThem: r.reactions_from,
      repliesFromThem: r.replies_from,
      totalScore: r.total_score,
    }));

    return NextResponse.json({ topRelationships: list });
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('top-relationships', 'GET top-relationships failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load top relationships' },
      { status: 500 }
    );
  }
}
