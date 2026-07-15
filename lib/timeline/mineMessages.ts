/**
 * Mines a member's full message history for timeline-worthy moments:
 * their first message (when they showed up), goals they've stated,
 * wins/accomplishments, problems/blockers, and specific dollar amounts
 * mentioned. Deterministic keyword matching (no AI) — every event links
 * back to the exact message so an admin can verify it.
 *
 * Idempotent: re-running never creates duplicate events for the same
 * message (checked via metadata.messageKey before inserting).
 */
import { pool } from '@/lib/db/client';

const GOAL_PATTERNS = [
  'my goal is', 'my goal this', 'my goal for', 'i want to', 'i wanna',
  'trying to achieve', 'aim to', 'hoping to', 'working towards', 'my target is',
  'plan to hit', 'looking to make', 'goal for this', "i'm trying to", 'im trying to',
];

const WIN_PATTERNS = [
  'first client', 'first sale', 'closed my first', 'signed my first', 'made my first',
  'my first win', 'first payment', 'changed my life', 'life changing', 'life-changing',
  'best decision', 'quit my job', 'financial freedom', 'hit my goal', 'goal reached',
  'first 10k', '10k month', 'closed a deal', 'closed a client', 'just closed', 'landed a client',
  'signed a client', "got my first", 'hit \\$', 'made \\$',
];

const PROBLEM_PATTERNS = [
  'struggling with', 'having trouble', 'stuck on', 'not sure how', 'having a hard time',
  "can't figure out", 'cant figure out', 'need help with', 'the problem is', 'having issues with',
  'stuck with', "don't know how to", 'dont know how to',
];

// $5,000 / $5k / 5000 usd / 5,000 dollars
const AMOUNT_RE = /\$\s?([\d][\d,]*(?:\.\d+)?)\s?(k\b)?|([\d][\d,]*(?:\.\d+)?)\s?(k\s)?(usd|dollars)\b/i;

function matchesAny(textLower: string, patterns: string[]): string | null {
  for (const p of patterns) {
    const re = new RegExp(p, 'i');
    if (re.test(textLower)) return p;
  }
  return null;
}

function extractAmount(text: string): string | null {
  const m = text.match(AMOUNT_RE);
  if (!m) return null;
  const raw = m[1] ?? m[3];
  const isK = !!(m[2] ?? m[4]);
  const num = parseFloat(raw.replace(/,/g, ''));
  if (Number.isNaN(num)) return null;
  const value = isK ? num * 1000 : num;
  return `$${value.toLocaleString()}`;
}

function snippet(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

interface MessageRow {
  from_id: string;
  chat_id: string;
  message_id: string;
  text: string;
  date: string;
}

interface MinedEvent {
  userId: number;
  eventType: string;
  title: string;
  description: string;
  occurredAt: string;
  messageKey: string;
}

const MAX_EVENTS_PER_MEMBER = 40;

/**
 * Scans every member's messages in one pass (bulk query, not per-member) and
 * returns the events to insert. Skips members/messages that already have a
 * mined event logged (checked against existing member_events.metadata).
 */
async function buildMinedEvents(fromIdFilter?: string[]): Promise<MinedEvent[]> {
  const userRes = await pool.query<{ id: number; from_id: string }>(
    `SELECT id, from_id FROM users WHERE from_id IS NOT NULL${fromIdFilter ? ' AND from_id = ANY($1::text[])' : ''}`,
    fromIdFilter ? [fromIdFilter] : undefined
  );
  const userIdByFromId = new Map(userRes.rows.map((r) => [r.from_id, r.id]));
  if (userIdByFromId.size === 0) return [];

  const existingRes = await pool.query<{ user_id: number; message_key: string }>(
    `SELECT user_id, metadata->>'messageKey' AS message_key FROM member_events
     WHERE source = 'message_mining' AND user_id = ANY($1::int[])`,
    [Array.from(userIdByFromId.values())]
  );
  const alreadyMined = new Set(existingRes.rows.map((r) => `${r.user_id}:${r.message_key}`));

  const fromIds = Array.from(userIdByFromId.keys());
  const msgRes = await pool.query<MessageRow>(
    `SELECT from_id, chat_id, message_id, text, date FROM messages
     WHERE type = 'message' AND from_id = ANY($1::text[]) AND text IS NOT NULL AND text != ''
     ORDER BY from_id, date ASC`,
    [fromIds]
  );

  const events: MinedEvent[] = [];
  const countByUser = new Map<number, number>();
  const firstMessageLogged = new Set<number>();

  for (const row of msgRes.rows) {
    const userId = userIdByFromId.get(row.from_id);
    if (userId == null) continue;
    const count = countByUser.get(userId) ?? 0;
    if (count >= MAX_EVENTS_PER_MEMBER) continue;

    const messageKey = `${row.chat_id}:${row.message_id}`;
    const dedupeKey = `${userId}:${messageKey}`;
    const textLower = row.text.toLowerCase();

    // Messages are ordered by date ASC per from_id, so the first row we see
    // for a user is their true first message — mark it regardless of mined
    // status so later messages are never mistaken for "first message" just
    // because the real first one was already logged in a prior run.
    const isFirstForUser = !firstMessageLogged.has(userId);
    if (isFirstForUser) firstMessageLogged.add(userId);

    if (alreadyMined.has(dedupeKey)) continue;

    if (isFirstForUser) {
      events.push({
        userId,
        eventType: 'JOINED',
        title: 'First message',
        description: snippet(row.text),
        occurredAt: row.date,
        messageKey,
      });
      countByUser.set(userId, count + 1);
      continue;
    }

    const winMatch = matchesAny(textLower, WIN_PATTERNS);
    const goalMatch = !winMatch && matchesAny(textLower, GOAL_PATTERNS);
    const problemMatch = !winMatch && !goalMatch && matchesAny(textLower, PROBLEM_PATTERNS);
    const amount = extractAmount(row.text);

    if (!winMatch && !goalMatch && !problemMatch && !amount) continue;

    let eventType: string;
    let title: string;
    if (winMatch) {
      eventType = 'WIN';
      title = amount ? `Shared a win (${amount})` : 'Shared a win';
    } else if (goalMatch) {
      eventType = 'OTHER';
      title = 'Shared a goal';
    } else if (problemMatch) {
      eventType = 'OTHER';
      title = 'Shared a problem / blocker';
    } else {
      eventType = 'OTHER';
      title = `Mentioned ${amount}`;
    }

    events.push({
      userId,
      eventType,
      title,
      description: snippet(row.text),
      occurredAt: row.date,
      messageKey,
    });
    countByUser.set(userId, count + 1);
  }

  return events;
}

async function writeEvents(events: MinedEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const BATCH_SIZE = 500;
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    await pool.query(
      `INSERT INTO member_events (user_id, event_type, title, description, occurred_at, source, metadata)
       SELECT b.user_id, b.event_type, b.title, b.description, b.occurred_at, 'message_mining',
              jsonb_build_object('messageKey', b.message_key)
       FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::text[])
         AS b(user_id, event_type, title, description, occurred_at, message_key)`,
      [
        batch.map((e) => e.userId),
        batch.map((e) => e.eventType),
        batch.map((e) => e.title),
        batch.map((e) => e.description),
        batch.map((e) => e.occurredAt),
        batch.map((e) => e.messageKey),
      ]
    );
  }
  return events.length;
}

/** Mine timeline events from message history for every member with messages. */
export async function mineAllMemberTimelines(): Promise<{ membersScanned: number; eventsCreated: number }> {
  const events = await buildMinedEvents();
  const created = await writeEvents(events);
  const membersScanned = new Set(events.map((e) => e.userId)).size;
  return { membersScanned, eventsCreated: created };
}

/** Mine timeline events from message history for one member. */
export async function mineMemberTimeline(fromId: string): Promise<number> {
  const events = await buildMinedEvents([fromId]);
  return writeEvents(events);
}
