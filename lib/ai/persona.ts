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
  /** CRM status, roadmap, wins, coach notes, open follow-ups, and calls. */
  crmBlob: string;
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

function fmtDate(d: string | null): string {
  return d ? new Date(d).toISOString().slice(0, 10) : 'unknown date';
}

interface CrmUserRow {
  status: string | null;
  offer_type: string | null;
  payment_status: string | null;
  amount_paid: string | number | null;
  tags: string[] | null;
  is_premium: boolean | null;
}
interface RoadmapRow {
  stage: string | null;
  main_goal: string | null;
  current_blocker: string | null;
  next_action: string | null;
  due_date: string | null;
  progress_notes: string | null;
}
interface WinRow {
  amount: string | number | null;
  description: string | null;
  occurred_at: string | null;
  confidence: string | null;
}
interface CoachNoteRow {
  note_type: string | null;
  summary: string | null;
  next_action: string | null;
  created_at: string;
}
interface FollowUpRow {
  due_date: string | null;
  priority: string;
  reason: string | null;
}
interface SalesCallRow {
  called_at: string | null;
  notes: string | null;
  objections: string | null;
  plans_discussed: string | null;
  current_situation: string | null;
  next_step: string | null;
  offer_discussed: string | null;
  likelihood: number | null;
}

/**
 * Build the CRM section of the persona context: status/offer/payment fields,
 * roadmap, wins, coach notes, open follow-ups, and sales/coaching calls.
 * Every section is present even when empty so the model can say "no signal"
 * rather than guessing.
 */
async function buildCrmBlob(userId: number): Promise<string> {
  const [userResult, roadmapResult, winsResult, coachResult, followResult, callsResult] = await Promise.all([
    pool.query<CrmUserRow>(
      `SELECT status, offer_type, payment_status, amount_paid, tags, is_premium FROM users WHERE id = $1`,
      [userId]
    ),
    pool.query<RoadmapRow>(
      `SELECT stage, main_goal, current_blocker, next_action, due_date, progress_notes FROM member_roadmap WHERE user_id = $1`,
      [userId]
    ),
    pool.query<WinRow>(
      `SELECT amount, description, occurred_at, confidence FROM wins WHERE user_id = $1 ORDER BY occurred_at DESC NULLS LAST LIMIT 20`,
      [userId]
    ),
    pool.query<CoachNoteRow>(
      `SELECT note_type, summary, next_action, created_at FROM coach_notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId]
    ),
    pool.query<FollowUpRow>(
      `SELECT due_date, priority, reason FROM follow_ups WHERE user_id = $1 AND status = 'OPEN' ORDER BY due_date ASC NULLS LAST LIMIT 20`,
      [userId]
    ),
    pool.query<SalesCallRow>(
      `SELECT called_at, notes, objections, plans_discussed, current_situation, next_step, offer_discussed, likelihood
       FROM contact_calls WHERE user_id = $1 ORDER BY called_at DESC NULLS LAST LIMIT 20`,
      [userId]
    ),
  ]);

  const lines: string[] = [];

  lines.push('### Status');
  const u = userResult.rows[0];
  const statusFields: string[] = [];
  if (u) {
    if (u.status) statusFields.push(`Status: ${u.status}`);
    if (u.offer_type && u.offer_type !== 'UNKNOWN') statusFields.push(`Offer: ${u.offer_type}`);
    if (u.payment_status && u.payment_status !== 'UNKNOWN') statusFields.push(`Payment status: ${u.payment_status}`);
    if (u.amount_paid != null) statusFields.push(`Amount paid: ${Number(u.amount_paid).toLocaleString()}`);
    if (u.is_premium) statusFields.push('Premium member');
    if (Array.isArray(u.tags) && u.tags.length) statusFields.push(`Tags: ${u.tags.join(', ')}`);
  }
  lines.push(statusFields.length ? statusFields.join(' | ') : 'No CRM status fields set.');

  lines.push('');
  lines.push('### Roadmap');
  const r = roadmapResult.rows[0];
  if (r) {
    const parts: string[] = [];
    if (r.stage) parts.push(`Stage: ${r.stage}`);
    if (r.main_goal) parts.push(`Goal: ${r.main_goal}`);
    if (r.current_blocker) parts.push(`Blocker: ${r.current_blocker}`);
    if (r.next_action) parts.push(`Next action: ${r.next_action}`);
    if (r.due_date) parts.push(`Due: ${fmtDate(r.due_date)}`);
    if (r.progress_notes) parts.push(`Notes: ${r.progress_notes}`);
    lines.push(parts.length ? parts.join('\n') : 'Roadmap exists but has no details set.');
  } else {
    lines.push('No roadmap set.');
  }

  lines.push('');
  lines.push('### Wins');
  if (winsResult.rows.length) {
    for (const w of winsResult.rows) {
      const amt = w.amount != null ? ` ($${Number(w.amount).toLocaleString()})` : '';
      lines.push(`- [${fmtDate(w.occurred_at)}]${amt} ${w.description ?? '(no description)'}${w.confidence ? ` [${w.confidence}]` : ''}`);
    }
  } else {
    lines.push('No wins logged.');
  }

  lines.push('');
  lines.push('### Coach notes');
  if (coachResult.rows.length) {
    for (const c of coachResult.rows) {
      lines.push(
        `- [${fmtDate(c.created_at)}]${c.note_type ? ` (${c.note_type})` : ''} ${c.summary ?? '(no summary)'}${c.next_action ? ` — Next: ${c.next_action}` : ''}`
      );
    }
  } else {
    lines.push('No coach notes logged.');
  }

  lines.push('');
  lines.push('### Open follow-ups');
  if (followResult.rows.length) {
    for (const f of followResult.rows) {
      lines.push(`- Due ${fmtDate(f.due_date)} (${f.priority}): ${f.reason ?? '(no reason given)'}`);
    }
  } else {
    lines.push('No open follow-ups.');
  }

  lines.push('');
  lines.push('### Sales / coaching calls');
  if (callsResult.rows.length) {
    for (const c of callsResult.rows) {
      const bits: string[] = [];
      if (c.notes) bits.push(c.notes);
      if (c.current_situation) bits.push(`Situation: ${c.current_situation}`);
      if (c.objections) bits.push(`Objections: ${c.objections}`);
      if (c.plans_discussed) bits.push(`Plan: ${c.plans_discussed}`);
      if (c.next_step) bits.push(`Next step: ${c.next_step}`);
      if (c.offer_discussed) bits.push(`Offer discussed: ${c.offer_discussed}`);
      if (c.likelihood != null) bits.push(`Likelihood: ${c.likelihood}/10`);
      lines.push(`- [${fmtDate(c.called_at)}] ${bits.join(' · ') || '(no details)'}`);
    }
  } else {
    lines.push('No sales/coaching calls logged.');
  }

  return lines.join('\n');
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
  const [user, opts, settingChatIds, crmBlob] = await Promise.all([
    getUserForPersona(userId),
    getPersonaSettings(),
    getPersonaChatIds(),
    buildCrmBlob(userId),
  ]);
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

  return { bio, messagesBlob, repliesBlob, reactionsBlob, crmBlob };
}
