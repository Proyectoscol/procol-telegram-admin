/**
 * Build context for AI buyer persona: user profile, recent messages with reply context, reactions given.
 * Uses persona settings from DB (days back, max messages/reactions, include bio). Server-only.
 */

import { pool } from '@/lib/db/client';
import { getPersonaSettings, getPersonaChatIds } from '@/lib/settings';

export interface PersonaContext {
  bio: string;
  messagesBlob: string;
  repliesBlob: string;
  reactionsBlob: string;
}

function truncate(s: string | null | undefined, max: number): string {
  if (s == null || s === '') return '';
  const t = String(s).trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + '…';
}

/**
 * Resolve user by id; returns from_id (may be null for list-only users).
 * Throws if user not found.
 */
export async function getUserForPersona(userId: number): Promise<{
  id: number;
  from_id: string | null;
  display_name: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  telegram_bio: string | null;
}> {
  const { rows } = await pool.query(
    `SELECT id, from_id, display_name, username, first_name, last_name, telegram_bio
     FROM users WHERE id = $1`,
    [userId]
  );
  if (rows.length === 0) throw new Error('User not found');
  return rows[0] as {
    id: number;
    from_id: string | null;
    display_name: string | null;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    telegram_bio: string | null;
  };
}

export interface BuildPersonaContextOptions {
  /** If set, only include messages/reactions from these chat IDs. Otherwise all chats. */
  chatIds?: number[] | null;
  /** If both set, filter messages/reactions to this date range (profile range). Overrides daysBack. */
  start?: string | null;
  end?: string | null;
}

/**
 * Build context for persona generation. Uses user_id (users.id).
 * Applies settings: days back (newest first until limit or date), max messages, max reactions, include bio.
 * If user has no from_id, messages and reactions will be empty (bio only).
 * Optionally restrict to specific chatIds.
 */
export async function buildPersonaContext(userId: number, options?: BuildPersonaContextOptions): Promise<PersonaContext> {
  const [user, opts, settingChatIds] = await Promise.all([getUserForPersona(userId), getPersonaSettings(), getPersonaChatIds()]);
  const fromId = user.from_id;
  const chatIds = options?.chatIds !== undefined
    ? (options.chatIds && options.chatIds.length > 0 ? options.chatIds : null)
    : (settingChatIds && settingChatIds.length > 0 ? settingChatIds : null);

  const bioParts: string[] = [];
  if (user.display_name) bioParts.push(`Display name: ${user.display_name}`);
  if (user.username) bioParts.push(`Username: @${user.username}`);
  if (user.first_name) bioParts.push(`First name: ${user.first_name}`);
  if (user.last_name) bioParts.push(`Last name: ${user.last_name}`);
  if (opts.includeBio && user.telegram_bio) bioParts.push(`Bio: ${user.telegram_bio}`);
  const bio = bioParts.length > 0 ? bioParts.join('\n') : 'No profile or bio.';

  let messagesBlob = '';
  let repliesBlob = '';
  let reactionsBlob = '';

  if (fromId) {
    const useRange = options?.start != null && options?.start !== '' && options?.end != null && options?.end !== '';
    let messagesQuery: string;
    let messagesParams: (string | number | number[])[];
    if (useRange) {
      const chatCond = chatIds ? ' AND m.chat_id = ANY($5::bigint[])' : '';
      messagesQuery = `SELECT m.id, m.date, m.text, m.reply_to_message_id,
              m2.text AS replied_to_text
           FROM messages m
           LEFT JOIN messages m2 ON m2.chat_id = m.chat_id AND m2.message_id = m.reply_to_message_id
           WHERE m.from_id = $1 AND m.type = 'message'
             AND m.date >= $2::timestamptz AND m.date <= $3::timestamptz${chatCond}
           ORDER BY m.date DESC
           LIMIT $4`;
      messagesParams = [fromId, options.start!, options.end!, opts.maxMessages];
      if (chatIds) messagesParams.push(chatIds);
    } else {
      const chatCond = chatIds ? ' AND m.chat_id = ANY($' + (opts.daysBack != null ? '4' : '3') + '::bigint[])' : '';
      messagesQuery =
        opts.daysBack != null
          ? `SELECT m.id, m.date, m.text, m.reply_to_message_id,
              m2.text AS replied_to_text
           FROM messages m
           LEFT JOIN messages m2 ON m2.chat_id = m.chat_id AND m2.message_id = m.reply_to_message_id
           WHERE m.from_id = $1 AND m.type = 'message'
             AND m.date >= NOW() - ($2::int * INTERVAL '1 day')${chatCond}
           ORDER BY m.date DESC
           LIMIT $3`
          : `SELECT m.id, m.date, m.text, m.reply_to_message_id,
              m2.text AS replied_to_text
           FROM messages m
           LEFT JOIN messages m2 ON m2.chat_id = m.chat_id AND m2.message_id = m.reply_to_message_id
           WHERE m.from_id = $1 AND m.type = 'message'${chatCond}
           ORDER BY m.date DESC
           LIMIT $2`;
      messagesParams = opts.daysBack != null ? [fromId, opts.daysBack, opts.maxMessages] : [fromId, opts.maxMessages];
      if (chatIds) messagesParams.push(chatIds);
    }
    const messagesRes = await pool.query(messagesQuery, messagesParams);
    const messages = (messagesRes.rows as { date: string; text: string | null; reply_to_message_id: number | null; replied_to_text: string | null }[]).reverse();
    const msgLines: string[] = [];
    const replyLines: string[] = [];
    for (const m of messages) {
      const dateStr = m.date ? new Date(m.date).toISOString().slice(0, 10) : '';
      const text = truncate(m.text, opts.maxTextLen);
      const replySuffix =
        m.reply_to_message_id != null && m.replied_to_text != null
          ? ` [REPLY TO: "${truncate(m.replied_to_text, opts.maxTextLen)}"]`
          : '';
      msgLines.push(`[${dateStr}] ${text || '(no text)'}${replySuffix}`);
      if (m.reply_to_message_id != null && m.replied_to_text != null) {
        const repliedTo = truncate(m.replied_to_text, opts.maxTextLen);
        replyLines.push(`User replied "${text || '(no text)'}" to: "${repliedTo}"`);
      }
    }
    messagesBlob = msgLines.length > 0 ? msgLines.join('\n') : 'No messages.';
    repliesBlob = replyLines.length > 0 ? replyLines.join('\n') : 'No reply context.';

    let reactionsQuery: string;
    let reactionsParams: (string | number | number[])[];
    if (useRange) {
      const rChatCond = chatIds ? ' AND r.chat_id = ANY($5::bigint[])' : '';
      reactionsQuery = `SELECT r.emoji, m.text AS target_text, r.reacted_at
           FROM reactions r
           JOIN messages m ON m.chat_id = r.chat_id AND m.message_id = r.message_id
           WHERE r.reactor_from_id = $1 AND r.reacted_at >= $2::timestamptz AND r.reacted_at <= $3::timestamptz${rChatCond}
           ORDER BY r.reacted_at DESC
           LIMIT $4`;
      reactionsParams = [fromId, options.start!, options.end!, opts.maxReactions];
      if (chatIds) reactionsParams.push(chatIds);
    } else {
      const rChatCond = chatIds ? ' AND r.chat_id = ANY($' + (opts.daysBack != null ? '4' : '3') + '::bigint[])' : '';
      reactionsQuery =
        opts.daysBack != null
          ? `SELECT r.emoji, m.text AS target_text, r.reacted_at
           FROM reactions r
           JOIN messages m ON m.chat_id = r.chat_id AND m.message_id = r.message_id
           WHERE r.reactor_from_id = $1 AND r.reacted_at >= NOW() - ($2::int * INTERVAL '1 day')${rChatCond}
           ORDER BY r.reacted_at DESC
           LIMIT $3`
          : `SELECT r.emoji, m.text AS target_text, r.reacted_at
           FROM reactions r
           JOIN messages m ON m.chat_id = r.chat_id AND m.message_id = r.message_id
           WHERE r.reactor_from_id = $1${rChatCond}
           ORDER BY r.reacted_at DESC
           LIMIT $2`;
      reactionsParams = opts.daysBack != null ? [fromId, opts.daysBack, opts.maxReactions] : [fromId, opts.maxReactions];
      if (chatIds) reactionsParams.push(chatIds);
    }
    const reactionsRes = await pool.query(reactionsQuery, reactionsParams);
    const reactionLines = (reactionsRes.rows as { emoji: string | null; target_text: string | null }[]).map(
      (r) => `Reacted with ${r.emoji ?? '?'} to: "${truncate(r.target_text, opts.maxTextLen) || '(no text)'}"`
    );
    reactionsBlob = reactionLines.length > 0 ? reactionLines.join('\n') : 'No reactions given.';
  } else {
    messagesBlob = 'No messages (user has no from_id).';
    repliesBlob = 'No reply context.';
    reactionsBlob = 'No reactions given.';
  }

  return { bio, messagesBlob, repliesBlob, reactionsBlob };
}
