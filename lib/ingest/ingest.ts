import { pool } from '@/lib/db/client';
import { log } from '@/lib/logger';
import type { TelegramExport, TelegramExportMessage } from './types';
import { getMessageText, getMediaType, parseEditedAt } from './types';

/** Safe message_id range (Telegram and JS safe integer). */
const MIN_MESSAGE_ID = 1;
const MAX_MESSAGE_ID = Number.MAX_SAFE_INTEGER;

function isValidMessageId(id: unknown): id is number {
  if (typeof id !== 'number') return false;
  if (Number.isNaN(id) || !Number.isInteger(id)) return false;
  return id >= MIN_MESSAGE_ID && id <= MAX_MESSAGE_ID;
}

/** Chunk an array into sub-arrays of size n */
function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface IngestResult {
  chatId: number;
  chatName: string;
  messagesInserted: number;
  messagesSkipped: number;
  reactionsInserted: number;
  reactionsSkipped: number;
  usersUpserted: number;
  durationMs: number;
  errors?: string[];
  messageErrors?: number;
  reactionErrors?: number;
}

const BATCH_SIZE = 500;

export async function ingestExport(data: TelegramExport, filename: string): Promise<IngestResult> {
  const t0 = Date.now();
  const chatId = data.id;
  const messages = data.messages ?? [];
  const chatName = data.name ?? 'Unknown';
  const chatType = data.type ?? '';
  const slug = `chat_${chatId}`;

  log.startup(`[ingest] ▶ Starting — chat "${chatName}" (id=${chatId}) | ${messages.length} messages | file: ${filename}`);

  // ── 1. Ensure chat exists ────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO chats (id, name, type, slug, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET name = $2, type = $3, updated_at = NOW()`,
    [chatId, chatName, chatType, slug]
  );
  log.startup(`[ingest] ✅ Chat upserted in ${Date.now() - t0}ms`);

  // ── 2. Collect all users, batch upsert ──────────────────────────────────
  const t1 = Date.now();
  const userMap = new Map<string, string>();
  const addUser = (from_id: string | undefined, display_name: string | undefined) => {
    if (!from_id || !from_id.trim()) return;
    const id = from_id.trim();
    const name = (display_name && display_name.trim()) || id;
    if (!userMap.has(id) || (name !== id && userMap.get(id) === id)) userMap.set(id, name);
  };
  for (const msg of messages) {
    addUser(msg.from_id, msg.from);
    addUser(msg.actor_id, msg.actor);
    for (const reaction of msg.reactions ?? []) {
      for (const r of reaction.recent ?? []) addUser(r.from_id, r.from);
    }
  }

  const userEntries = Array.from(userMap.entries());
  log.startup(`[ingest] 👤 Upserting ${userEntries.length} users in batches of ${BATCH_SIZE}…`);

  for (const batch of chunks(userEntries, BATCH_SIZE)) {
    const fromIds = batch.map(([id]) => id);
    const displayNames = batch.map(([, name]) => name);
    await pool.query(
      `INSERT INTO users (from_id, display_name, updated_at)
       SELECT unnest($1::text[]), unnest($2::text[]), NOW()
       ON CONFLICT (from_id) DO UPDATE SET
         display_name = CASE
           -- EXCLUDED.display_name falls back to the bare from_id when the source
           -- (e.g. a live Telegram-scraper sync that couldn't resolve a sender)
           -- had no real name to offer — don't let that clobber a good name
           -- already on file (Desktop's JSON export always has a real name, so
           -- this only ever matters for the live-sync path).
           WHEN EXCLUDED.display_name IS DISTINCT FROM EXCLUDED.from_id THEN EXCLUDED.display_name
           ELSE COALESCE(users.display_name, EXCLUDED.display_name)
         END,
         updated_at = NOW()`,
      [fromIds, displayNames]
    );
  }
  const usersUpserted = userEntries.length;
  log.startup(`[ingest] ✅ Users done — ${usersUpserted} upserted in ${Date.now() - t1}ms`);

  // ── 3. Collect and batch-insert messages ─────────────────────────────────
  const t2 = Date.now();
  type MsgRow = {
    messageId: number;
    type: string;
    date: Date | null;
    fromId: string | null;
    actorId: string | null;
    text: string | null;
    replyTo: number | null;
    editedAt: string | null;
    mediaType: string | null;
  };

  const msgRows: MsgRow[] = [];
  const errors: string[] = [];
  let messageErrors = 0;
  const maxErrors = 20;

  for (const msg of messages) {
    if (!isValidMessageId(msg.id)) {
      messageErrors++;
      if (errors.length < maxErrors) errors.push(`Invalid message id: ${String(msg.id)}`);
      continue;
    }
    let date: Date | null = null;
    if (msg.date) {
      try { date = new Date(msg.date.replace('Z', '+00:00')); } catch { /* keep null */ }
    }
    msgRows.push({
      messageId: msg.id,
      type: msg.type ?? 'message',
      date,
      fromId: msg.from_id ?? null,
      actorId: msg.type === 'service' ? (msg.actor_id ?? null) : null,
      text: getMessageText(msg) || null,
      replyTo: (msg.reply_to_message_id != null && isValidMessageId(msg.reply_to_message_id)) ? msg.reply_to_message_id : null,
      editedAt: parseEditedAt(msg),
      mediaType: getMediaType(msg),
    });
  }

  log.startup(`[ingest] 💬 Inserting ${msgRows.length} messages in batches of ${BATCH_SIZE}…`);

  let messagesInserted = 0;
  let messagesSkipped = 0;
  let reactionErrors = 0;

  const msgBatches = chunks(msgRows, BATCH_SIZE);
  for (let batchIdx = 0; batchIdx < msgBatches.length; batchIdx++) {
    const batch = msgBatches[batchIdx];
    try {
      const result = await pool.query<{ inserted: string }>(
        `WITH ins AS (
           INSERT INTO messages (chat_id, message_id, type, date, from_id, actor_id, text, reply_to_message_id, edited_at, media_type)
           SELECT $1, unnest($2::bigint[]), unnest($3::text[]), unnest($4::timestamptz[]),
                  unnest($5::text[]), unnest($6::text[]), unnest($7::text[]),
                  unnest($8::bigint[]), unnest($9::timestamptz[]), unnest($10::text[])
           ON CONFLICT (chat_id, message_id) DO NOTHING
           RETURNING 1
         )
         SELECT count(*) AS inserted FROM ins`,
        [
          chatId,
          batch.map(r => r.messageId),
          batch.map(r => r.type),
          batch.map(r => r.date),
          batch.map(r => r.fromId),
          batch.map(r => r.actorId),
          batch.map(r => r.text),
          batch.map(r => r.replyTo),
          batch.map(r => r.editedAt),
          batch.map(r => r.mediaType),
        ]
      );
      const inserted = parseInt(result.rows[0]?.inserted ?? '0', 10);
      messagesInserted += inserted;
      messagesSkipped += batch.length - inserted;
    } catch (err) {
      messageErrors += batch.length;
      const msg = err instanceof Error ? err.message : String(err);
      if (errors.length < maxErrors) errors.push(`Message batch ${batchIdx}: ${msg}`);
      log.error('ingest', `Message batch ${batchIdx} failed: ${msg}`);
    }
  }
  log.startup(`[ingest] ✅ Messages done — ${messagesInserted} inserted, ${messagesSkipped} skipped in ${Date.now() - t2}ms`);

  // ── 4. Collect and batch-insert reactions ────────────────────────────────
  const t3 = Date.now();
  type ReactionRow = { messageId: number; reactorFromId: string; emoji: string; reactedAt: Date | null };
  const reactionRows: ReactionRow[] = [];

  for (const msg of messages) {
    if (!isValidMessageId(msg.id)) continue;
    for (const reaction of msg.reactions ?? []) {
      const emoji = reaction.emoji ?? '';
      for (const recent of reaction.recent ?? []) {
        if (!recent.from_id) continue;
        let reactedAt: Date | null = null;
        if (recent.date) {
          try { reactedAt = new Date(recent.date.replace('Z', '+00:00')); } catch { /* keep null */ }
        }
        reactionRows.push({ messageId: msg.id, reactorFromId: recent.from_id, emoji, reactedAt });
      }
    }
  }

  log.startup(`[ingest] ⚡ Inserting ${reactionRows.length} reactions in batches of ${BATCH_SIZE}…`);

  let reactionsInserted = 0;
  let reactionsSkipped = 0;

  const reactionBatches = chunks(reactionRows, BATCH_SIZE);
  for (let batchIdx = 0; batchIdx < reactionBatches.length; batchIdx++) {
    const batch = reactionBatches[batchIdx];
    try {
      const result = await pool.query<{ inserted: string }>(
        `WITH ins AS (
           INSERT INTO reactions (chat_id, message_id, reactor_from_id, emoji, reacted_at)
           SELECT $1, unnest($2::bigint[]), unnest($3::text[]), unnest($4::text[]), unnest($5::timestamptz[])
           ON CONFLICT (chat_id, message_id, reactor_from_id) DO NOTHING
           RETURNING 1
         )
         SELECT count(*) AS inserted FROM ins`,
        [
          chatId,
          batch.map(r => r.messageId),
          batch.map(r => r.reactorFromId),
          batch.map(r => r.emoji),
          batch.map(r => r.reactedAt),
        ]
      );
      const inserted = parseInt(result.rows[0]?.inserted ?? '0', 10);
      reactionsInserted += inserted;
      reactionsSkipped += batch.length - inserted;
    } catch (err) {
      reactionErrors += batch.length;
      const msg = err instanceof Error ? err.message : String(err);
      if (errors.length < maxErrors) errors.push(`Reaction batch ${batchIdx}: ${msg}`);
      log.error('ingest', `Reaction batch ${batchIdx} failed: ${msg}`);
    }
  }
  log.startup(`[ingest] ✅ Reactions done — ${reactionsInserted} inserted, ${reactionsSkipped} skipped in ${Date.now() - t3}ms`);

  // ── 5. Record import batch ───────────────────────────────────────────────
  await pool.query(
    `INSERT INTO import_batches (chat_id, filename, messages_inserted, messages_skipped, reactions_inserted, reactions_skipped)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [chatId, filename, messagesInserted, messagesSkipped, reactionsInserted, reactionsSkipped]
  );

  const durationMs = Date.now() - t0;
  log.startup(`[ingest] 🏁 Done — total time: ${durationMs}ms (${(durationMs / 1000).toFixed(1)}s) | msgs: ${messagesInserted}↑ ${messagesSkipped}⊘ | reactions: ${reactionsInserted}↑ ${reactionsSkipped}⊘ | users: ${usersUpserted}`);

  const result: IngestResult = {
    chatId,
    chatName,
    messagesInserted,
    messagesSkipped,
    reactionsInserted,
    reactionsSkipped,
    usersUpserted,
    durationMs,
  };
  if (messageErrors > 0 || reactionErrors > 0) {
    result.messageErrors = messageErrors;
    result.reactionErrors = reactionErrors;
    result.errors = errors;
  }
  return result;
}
