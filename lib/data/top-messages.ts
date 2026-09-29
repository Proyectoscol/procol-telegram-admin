import { queryWithRetry } from '@/lib/db/client';
import { getTopMessagesDefaultAuthorFromId } from '@/lib/settings';

// Safety cap on rows fetched per request — the UI paginates client-side (10 per page)
// through everything up to this cap, ordered by reaction count.
const MAX_MESSAGES_FETCHED = 500;

export interface DefaultAuthor {
  from_id: string;
  display_name: string | null;
  username: string | null;
}

/** Resolves the configured default author (Settings) to display info, or null if unset/unknown. */
export async function getTopMessagesDefaultAuthor(): Promise<DefaultAuthor | null> {
  const fromId = await getTopMessagesDefaultAuthorFromId();
  if (!fromId) return null;
  const { rows } = await queryWithRetry<{ from_id: string; display_name: string | null; username: string | null }>(
    'SELECT from_id, display_name, username FROM users WHERE from_id = $1',
    [fromId]
  );
  return rows[0] ?? null;
}

export interface TopMessage {
  chat_id: number;
  message_id: number;
  chat_name: string | null;
  author_from_id: string | null;
  author_display_name: string | null;
  author_username: string | null;
  date: string | null;
  text: string | null;
  reaction_count: number;
  quote_count: number;
  reactions_by_emoji: { emoji: string | null; count: number }[];
}

interface TopMessageParams {
  chatIds: number[] | null;
  start: string;
  end: string;
  authorFromId?: string | null;
}

/**
 * All messages with at least one reaction within [start, end) by message date, ranked by
 * total reaction count (highest first). Reaction totals and quote_count are all-time (a
 * message posted in range keeps accumulating reactions/quotes after the fact) — only the
 * message's own date is range-bound. Capped at MAX_MESSAGES_FETCHED; the client paginates.
 */
export async function getTopLikedMessages({ chatIds, start, end, authorFromId }: TopMessageParams): Promise<TopMessage[]> {
  const params: (string | number | number[])[] = [start, end];
  let chatCond = '';
  let authorCond = '';
  if (chatIds && chatIds.length > 0) {
    params.push(chatIds);
    chatCond = `AND m.chat_id = ANY($${params.length}::bigint[])`;
  }
  if (authorFromId) {
    params.push(authorFromId);
    authorCond = `AND m.from_id = $${params.length}`;
  }

  // reaction_count prefers the true per-emoji total from message_reaction_totals (backfilled via
  // "Backfill reaction totals" / captured live going forward); falls back to counting the
  // capped named-reactor sample in `reactions` for messages not yet backfilled.
  const { rows } = await queryWithRetry<{
    chat_id: string;
    message_id: string;
    chat_name: string | null;
    author_from_id: string | null;
    author_display_name: string | null;
    author_username: string | null;
    date: string | null;
    text: string | null;
    reaction_count: number;
    has_true_total: boolean;
    quote_count: number;
  }>(
    `SELECT m.chat_id, m.message_id, c.name AS chat_name,
            m.from_id AS author_from_id, au.display_name AS author_display_name, au.username AS author_username,
            m.date, m.text,
            COALESCE(rt.real_total, rc.sample_total, 0)::int AS reaction_count,
            (rt.real_total IS NOT NULL) AS has_true_total,
            (SELECT COUNT(*)::int FROM messages rep
               WHERE rep.chat_id = m.chat_id AND rep.reply_to_message_id = m.message_id) AS quote_count
     FROM messages m
     JOIN chats c ON c.id = m.chat_id
     LEFT JOIN users au ON au.from_id = m.from_id
     LEFT JOIN LATERAL (
       SELECT SUM(mrt.total_count)::int AS real_total FROM message_reaction_totals mrt
       WHERE mrt.chat_id = m.chat_id AND mrt.message_id = m.message_id
     ) rt ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS sample_total FROM reactions r2
       WHERE r2.chat_id = m.chat_id AND r2.message_id = m.message_id
     ) rc ON true
     WHERE m.type = 'message' AND m.date >= $1::timestamptz AND m.date < $2::timestamptz ${chatCond} ${authorCond}
       AND COALESCE(rt.real_total, rc.sample_total, 0) > 0
     ORDER BY reaction_count DESC, m.date DESC
     LIMIT ${MAX_MESSAGES_FETCHED}`,
    params
  );

  if (rows.length === 0) return [];

  const pairs = rows.map((r) => `(${Number(r.chat_id)},${Number(r.message_id)})`).join(',');
  const [{ rows: trueEmojiRows }, { rows: sampleEmojiRows }] = await Promise.all([
    queryWithRetry<{ chat_id: string; message_id: string; emoji: string; count: number }>(
      `SELECT chat_id, message_id, emoji, total_count AS count
       FROM message_reaction_totals
       WHERE (chat_id, message_id) IN (${pairs})
       ORDER BY total_count DESC`
    ),
    queryWithRetry<{ chat_id: string; message_id: string; emoji: string | null; count: number }>(
      `SELECT chat_id, message_id, emoji, COUNT(*)::int AS count
       FROM reactions
       WHERE (chat_id, message_id) IN (${pairs})
       GROUP BY chat_id, message_id, emoji
       ORDER BY count DESC`
    ),
  ]);

  const groupByMessage = (list: { chat_id: string; message_id: string; emoji: string | null; count: number }[]) => {
    const map = new Map<string, { emoji: string | null; count: number }[]>();
    for (const r of list) {
      const key = `${r.chat_id}:${r.message_id}`;
      const arr = map.get(key) ?? [];
      arr.push({ emoji: r.emoji, count: r.count });
      map.set(key, arr);
    }
    return map;
  };
  const trueEmojiMap = groupByMessage(trueEmojiRows);
  const sampleEmojiMap = groupByMessage(sampleEmojiRows);

  return rows.map((r) => {
    const key = `${r.chat_id}:${r.message_id}`;
    return {
      chat_id: Number(r.chat_id),
      message_id: Number(r.message_id),
      chat_name: r.chat_name,
      author_from_id: r.author_from_id,
      author_display_name: r.author_display_name,
      author_username: r.author_username,
      date: r.date,
      text: r.text,
      reaction_count: r.reaction_count,
      quote_count: r.quote_count,
      reactions_by_emoji: (r.has_true_total ? trueEmojiMap.get(key) : sampleEmojiMap.get(key)) ?? [],
    };
  });
}

export interface MessageDetail {
  chat_id: number;
  message_id: number;
  chat_name: string | null;
  author_from_id: string | null;
  author_display_name: string | null;
  author_username: string | null;
  date: string | null;
  text: string | null;
  media_type: string | null;
  /** True total reaction count from Telegram (message_reaction_totals), when backfilled — may exceed reactions.length since Telegram only ever samples a capped set of named reactors. */
  reaction_total: number;
  reactions: { reactor_from_id: string; reactor_display_name: string | null; reactor_username: string | null; emoji: string | null; reacted_at: string | null }[];
  quotes: { message_id: number; author_from_id: string | null; author_display_name: string | null; author_username: string | null; text: string | null; date: string | null }[];
}

/** Full detail for one message: reactions (who + emoji) and quotes (replies) — both all-time, not range-bound. */
export async function getMessageDetail({ chatId, messageId }: { chatId: number; messageId: number }): Promise<MessageDetail | null> {
  const { rows: msgRows } = await queryWithRetry<{
    chat_id: string;
    message_id: string;
    chat_name: string | null;
    author_from_id: string | null;
    author_display_name: string | null;
    author_username: string | null;
    date: string | null;
    text: string | null;
    media_type: string | null;
  }>(
    `SELECT m.chat_id, m.message_id, c.name AS chat_name,
            m.from_id AS author_from_id, au.display_name AS author_display_name, au.username AS author_username,
            m.date, m.text, m.media_type
     FROM messages m
     JOIN chats c ON c.id = m.chat_id
     LEFT JOIN users au ON au.from_id = m.from_id
     WHERE m.chat_id = $1 AND m.message_id = $2`,
    [chatId, messageId]
  );
  if (msgRows.length === 0) return null;
  const msg = msgRows[0];

  const { rows: totalRows } = await queryWithRetry<{ total: number | null }>(
    'SELECT SUM(total_count)::int AS total FROM message_reaction_totals WHERE chat_id = $1 AND message_id = $2',
    [chatId, messageId]
  );
  const trueTotal = totalRows[0]?.total ?? null;

  const { rows: reactionRows } = await queryWithRetry<{
    reactor_from_id: string;
    reactor_display_name: string | null;
    reactor_username: string | null;
    emoji: string | null;
    reacted_at: string | null;
  }>(
    `SELECT r.reactor_from_id, u.display_name AS reactor_display_name, u.username AS reactor_username, r.emoji, r.reacted_at
     FROM reactions r
     LEFT JOIN users u ON u.from_id = r.reactor_from_id
     WHERE r.chat_id = $1 AND r.message_id = $2
     ORDER BY r.reacted_at ASC`,
    [chatId, messageId]
  );

  const { rows: quoteRows } = await queryWithRetry<{
    message_id: string;
    author_from_id: string | null;
    author_display_name: string | null;
    author_username: string | null;
    text: string | null;
    date: string | null;
  }>(
    `SELECT rep.message_id, rep.from_id AS author_from_id, u.display_name AS author_display_name, u.username AS author_username, rep.text, rep.date
     FROM messages rep
     LEFT JOIN users u ON u.from_id = rep.from_id
     WHERE rep.chat_id = $1 AND rep.reply_to_message_id = $2
     ORDER BY rep.date ASC`,
    [chatId, messageId]
  );

  return {
    chat_id: Number(msg.chat_id),
    message_id: Number(msg.message_id),
    chat_name: msg.chat_name,
    author_from_id: msg.author_from_id,
    author_display_name: msg.author_display_name,
    author_username: msg.author_username,
    date: msg.date,
    text: msg.text,
    media_type: msg.media_type,
    reaction_total: trueTotal ?? reactionRows.length,
    reactions: reactionRows,
    quotes: quoteRows.map((q) => ({ ...q, message_id: Number(q.message_id) })),
  };
}
