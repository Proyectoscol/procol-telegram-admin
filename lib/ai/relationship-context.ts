/**
 * Build context for AI relationship summary: interactions between two members (replies, reactions both ways).
 * Server-only.
 */

import { pool } from '@/lib/db/client';

export interface RelationshipContext {
  memberAName: string;
  memberBName: string;
  messagesBetweenBlob: string;
  reactionsAtoBBlob: string;
  reactionsBtoABlob: string;
  repliesBlob: string;
}

const MAX_TEXT_LEN = 400;
const MAX_MESSAGES = 80;
const DAYS_BACK = 180;

function truncate(s: string | null | undefined, max: number): string {
  if (s == null || s === '') return '';
  const t = String(s).trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + '…';
}

/** Normalize DB date (string or Date) to YYYY-MM-DD. */
function dateToYMD(d: string | Date | null | undefined): string {
  if (d == null) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Build context for relationship summary between profile user (fromId = A) and other user (otherFromId = B).
 * Optional chatIds to restrict to specific chats.
 * Optional start/end (ISO strings) to filter to profile date range; when both set, overrides DAYS_BACK.
 */
export async function buildRelationshipContext(
  fromId: string,
  otherFromId: string,
  chatIds?: number[] | null,
  start?: string | null,
  end?: string | null
): Promise<RelationshipContext> {
  const useRange = start != null && start !== '' && end != null && end !== '';
  const chatCond = chatIds && chatIds.length > 0 ? (useRange ? ' AND m.chat_id = ANY($5::bigint[])' : ' AND m.chat_id = ANY($4::bigint[])') : '';
  const chatCondR = chatIds && chatIds.length > 0 ? (useRange ? ' AND r.chat_id = ANY($5::bigint[])' : ' AND r.chat_id = ANY($4::bigint[])') : '';
  const params = useRange
    ? (chatIds && chatIds.length > 0 ? [fromId, otherFromId, start, end, chatIds] : [fromId, otherFromId, start, end])
    : (chatIds && chatIds.length > 0 ? [fromId, otherFromId, DAYS_BACK, chatIds] : [fromId, otherFromId, DAYS_BACK]);

  const dateCond = useRange ? ' AND m.date >= $3::timestamptz AND m.date <= $4::timestamptz' : ' AND m.date >= NOW() - ($3::int * INTERVAL \'1 day\')';
  const dateCondR = useRange ? ' AND r.reacted_at >= $3::timestamptz AND r.reacted_at <= $4::timestamptz' : ' AND r.reacted_at >= NOW() - ($3::int * INTERVAL \'1 day\')';

  const [namesRes, messagesRes, reactionsARes, reactionsBRes, repliesRes] = await Promise.all([
    pool.query<{ display_name: string | null; from_id: string }>(
      'SELECT from_id, COALESCE(display_name, from_id) AS display_name FROM users WHERE from_id = $1 OR from_id = $2',
      [fromId, otherFromId]
    ),
    pool.query(
      `SELECT m.date, m.from_id, m.text, m.reply_to_message_id, m2.from_id AS replied_to_from_id, m2.text AS replied_to_text
       FROM messages m
       LEFT JOIN messages m2 ON m2.chat_id = m.chat_id AND m2.message_id = m.reply_to_message_id
       WHERE ((m.from_id = $1 AND (m.reply_to_message_id IS NULL OR m2.from_id = $2)) OR (m.from_id = $2 AND (m.reply_to_message_id IS NULL OR m2.from_id = $1)))
         AND m.type = 'message'${dateCond}${chatCond}
       ORDER BY m.date ASC
       LIMIT ${MAX_MESSAGES}`,
      params
    ),
    pool.query(
      `SELECT r.emoji, m.text AS target_text, m.date AS target_date, m.from_id AS target_from_id
       FROM reactions r
       JOIN messages m ON r.chat_id = m.chat_id AND r.message_id = m.message_id
       WHERE r.reactor_from_id = $1 AND m.from_id = $2${dateCondR}${chatCondR}
       ORDER BY r.reacted_at DESC
       LIMIT 50`,
      params
    ),
    pool.query(
      `SELECT r.emoji, m.text AS target_text, m.date AS target_date, m.from_id AS target_from_id
       FROM reactions r
       JOIN messages m ON r.chat_id = m.chat_id AND r.message_id = m.message_id
       WHERE r.reactor_from_id = $2 AND m.from_id = $1${dateCondR}${chatCondR}
       ORDER BY r.reacted_at DESC
       LIMIT 50`,
      params
    ),
    pool.query(
      `SELECT m.date, m.from_id, m.text, parent.from_id AS replied_to_from_id, parent.text AS replied_to_text
       FROM messages m
       JOIN messages parent ON parent.chat_id = m.chat_id AND parent.message_id = m.reply_to_message_id
       WHERE m.from_id IN ($1, $2) AND parent.from_id IN ($1, $2) AND m.from_id != parent.from_id
         ${dateCond}${chatCond}
       ORDER BY m.date ASC
       LIMIT 60`,
      params
    ),
  ]);

  const nameMap = new Map<string, string>();
  for (const r of namesRes.rows) {
    nameMap.set(r.from_id, r.display_name ?? r.from_id);
  }
  const memberAName = nameMap.get(fromId) ?? fromId;
  const memberBName = nameMap.get(otherFromId) ?? otherFromId;

  const msgRows = messagesRes.rows as { date: string; from_id: string; text: string | null; reply_to_message_id: number | null; replied_to_from_id: string | null; replied_to_text: string | null }[];
  const messagesBetweenBlob =
    msgRows.length === 0
      ? 'No direct message thread between these two in the period.'
      : msgRows
          .map((m) => {
            const dateStr = m.date ? new Date(m.date).toISOString().slice(0, 10) : '';
            const who = m.from_id === fromId ? 'A' : 'B';
            const text = truncate(m.text, MAX_TEXT_LEN);
            const reply = m.replied_to_from_id != null && m.replied_to_text != null ? ` [REPLY TO ${m.replied_to_from_id === fromId ? 'A' : 'B'}: "${truncate(m.replied_to_text, MAX_TEXT_LEN)}"]` : '';
            return `[${dateStr}] ${who}: ${text || '(no text)'}${reply}`;
          })
          .join('\n');

  const reactionsAtoB = (reactionsARes.rows as { emoji: string | null; target_text: string | null; target_date: string | Date; target_from_id: string }[]).map(
    (r) => `Reacted with ${r.emoji ?? '?'} to B's message (${dateToYMD(r.target_date)}): "${truncate(r.target_text, MAX_TEXT_LEN) || '(no text)'}"`
  );
  const reactionsAtoBBlob = reactionsAtoB.length > 0 ? reactionsAtoB.join('\n') : 'None in period.';

  const reactionsBtoA = (reactionsBRes.rows as { emoji: string | null; target_text: string | null; target_date: string | Date }[]).map(
    (r) => `B reacted with ${r.emoji ?? '?'} to A's message (${dateToYMD(r.target_date)}): "${truncate(r.target_text, MAX_TEXT_LEN) || '(no text)'}"`
  );
  const reactionsBtoABlob = reactionsBtoA.length > 0 ? reactionsBtoA.join('\n') : 'None in period.';

  const replyRows = repliesRes.rows as { date: string | Date; from_id: string; text: string | null; replied_to_from_id: string; replied_to_text: string | null }[];
  const repliesBlob =
    replyRows.length === 0
      ? 'No reply pairs in period.'
      : replyRows
          .map((r) => {
            const who = r.from_id === fromId ? 'A' : 'B';
            const toWho = r.replied_to_from_id === fromId ? 'A' : 'B';
            return `[${dateToYMD(r.date)}] ${who} replied to ${toWho}: "${truncate(r.text, MAX_TEXT_LEN) || '(no text)'}" → "${truncate(r.replied_to_text, MAX_TEXT_LEN) || '(no text)'}"`;
          })
          .join('\n');

  return {
    memberAName,
    memberBName,
    messagesBetweenBlob,
    reactionsAtoBBlob,
    reactionsBtoABlob,
    repliesBlob,
  };
}
