/**
 * "Backfill reaction totals" — re-fetches already-synced messages from Telegram to pick up
 * their current true reaction totals (msg.reactions.results). chatSync.ts's "Sync chats" is
 * strictly forward-only (iterMessages with minId) and never revisits a message once its
 * message_id is <= the chat's high-water mark — but reactions keep accumulating on old
 * messages long after they're first synced, and even a message's very first sync only ever
 * captured Telegram's server-side-capped `recentReactions` sample, never the true total. This
 * job re-fetches specific message ids by id (client.getMessages, not iterMessages) to pick up
 * both a fresher named-reactor sample and the authoritative per-emoji totals.
 *
 * Incremental via messages.reactions_synced_at (NULL/oldest first, skips anything synced in
 * the last 24h) — same self-resuming, budget-capped-per-click shape as profileSync.ts and
 * chatSync.ts. Reuses ingestExport() for every DB write (message/user/reaction/reaction-total
 * upserts), so this goes through the exact same conflict-safe logic as the live sync path —
 * see mapMessage()/collectPeers()/resolveNames() re-exported from chatSync.ts.
 */

import { Api, type TelegramClient } from 'teleproto';
import { pool, ensureSchema } from '@/lib/db/client';
import { withScraperClient } from '@/lib/telegram-scraper/scrapeClient';
import { ingestExport } from '@/lib/ingest/ingest';
import type { TelegramExport, TelegramExportMessage } from '@/lib/ingest/types';
import { collectPeers, resolveNames, mapMessage, chatTypeOf } from '@/lib/telegram-scraper/chatSync';
import { log } from '@/lib/logger';

const PER_RUN_MAX_MESSAGES = 800;
const FETCH_BATCH_SIZE = 100; // Telegram's practical cap for getMessages({ ids: [...] })
const BATCH_DELAY_MS = 1000; // conservative pacing between getMessages calls
const TOTAL_MAX_DURATION_MS = 4.5 * 60 * 1000; // stay under the route's maxDuration
const STALE_AFTER_HOURS = 24; // don't re-touch a message whose reactions were synced within this window

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Candidate {
  chatId: number;
  messageId: number;
}

async function getCandidates(limit: number): Promise<Candidate[]> {
  const { rows } = await pool.query<{ chat_id: string; message_id: string }>(
    `SELECT m.chat_id, m.message_id
     FROM messages m
     JOIN telegram_scraper_groups g ON g.telegram_group_id = m.chat_id AND g.sync_chat = TRUE
     WHERE m.type = 'message'
       AND (m.reactions_synced_at IS NULL OR m.reactions_synced_at < NOW() - INTERVAL '${STALE_AFTER_HOURS} hours')
     ORDER BY m.reactions_synced_at ASC NULLS FIRST, m.date ASC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({ chatId: Number(r.chat_id), messageId: Number(r.message_id) }));
}

async function countRemaining(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM messages m
     JOIN telegram_scraper_groups g ON g.telegram_group_id = m.chat_id AND g.sync_chat = TRUE
     WHERE m.type = 'message'
       AND (m.reactions_synced_at IS NULL OR m.reactions_synced_at < NOW() - INTERVAL '${STALE_AFTER_HOURS} hours')`
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

interface FloodWait {
  seconds: number;
}
function asFloodWait(err: unknown): FloodWait | null {
  const seconds = (err as { seconds?: unknown } | null)?.seconds;
  return typeof seconds === 'number' ? { seconds } : null;
}

export interface ReactionsBackfillResult {
  processed: number;
  updated: number;
  failed: number;
  hasMore: boolean;
  floodWaitSeconds?: number;
  durationMs: number;
  errors: string[];
}

export async function backfillReactionTotals(): Promise<ReactionsBackfillResult> {
  const t0 = Date.now();
  await ensureSchema();

  const candidates = await getCandidates(PER_RUN_MAX_MESSAGES);
  if (candidates.length === 0) {
    return { processed: 0, updated: 0, failed: 0, hasMore: false, durationMs: Date.now() - t0, errors: [] };
  }

  const byChat = new Map<number, number[]>();
  for (const c of candidates) {
    if (!byChat.has(c.chatId)) byChat.set(c.chatId, []);
    byChat.get(c.chatId)!.push(c.messageId);
  }

  let processed = 0;
  let updated = 0;
  let failed = 0;
  let floodWaitSeconds: number | undefined;
  const errors: string[] = [];
  const maxErrors = 20;
  const deadline = Date.now() + TOTAL_MAX_DURATION_MS;

  await withScraperClient(async (client: TelegramClient) => {
    const dialogs = await client.getDialogs({});
    const entityById = new Map<string, Api.Channel>();
    for (const dialog of dialogs) {
      if (dialog.entity instanceof Api.Channel && dialog.entity.megagroup) {
        entityById.set(dialog.entity.id.toString(), dialog.entity);
      }
    }

    chatLoop: for (const [chatId, messageIds] of Array.from(byChat.entries())) {
      const entity = entityById.get(String(chatId));
      if (!entity) continue; // left the group / not resolvable in this session — skip, retried next run

      const { rows: chatRows } = await pool.query<{ name: string | null; type: string | null }>(
        'SELECT name, type FROM chats WHERE id = $1',
        [chatId]
      );
      const chatName = chatRows[0]?.name ?? entity.title ?? 'Unknown';
      const chatType = chatRows[0]?.type ?? chatTypeOf(entity);

      const idBatches: number[][] = [];
      for (let i = 0; i < messageIds.length; i += FETCH_BATCH_SIZE) idBatches.push(messageIds.slice(i, i + FETCH_BATCH_SIZE));

      for (const idBatch of idBatches) {
        if (Date.now() >= deadline) break chatLoop;

        try {
          await sleep(BATCH_DELAY_MS);
          const fetched = await client.getMessages(entity, { ids: idBatch });
          const msgs = fetched.filter((m): m is Api.Message => m instanceof Api.Message);

          const nameCache = new Map<string, string>();
          const peers = collectPeers(msgs);
          await resolveNames(client, peers, nameCache);
          const mapped = msgs.map((m) => mapMessage(m, nameCache)).filter((m): m is TelegramExportMessage => m !== null);

          processed += idBatch.length;

          if (mapped.length > 0) {
            const payload: TelegramExport = { id: chatId, name: chatName, type: chatType, messages: mapped };
            await ingestExport(payload, `telegram-scraper:reactions-backfill:${chatName}`);
            updated += mapped.filter((m) => (m.reaction_totals?.length ?? 0) > 0).length;
          }

          // Telegram no longer returns deleted messages — still stamp them so the backfill
          // doesn't retry the same missing ids forever.
          const returnedIds = new Set(msgs.map((m) => m.id));
          const missingIds = idBatch.filter((id) => !returnedIds.has(id));
          if (missingIds.length > 0) {
            await pool.query(
              'UPDATE messages SET reactions_synced_at = NOW() WHERE chat_id = $1 AND message_id = ANY($2::bigint[])',
              [chatId, missingIds]
            );
          }
        } catch (err) {
          const floodWait = asFloodWait(err);
          if (floodWait) {
            floodWaitSeconds = floodWait.seconds;
            log.startup(`[telegram-scraper] Reactions backfill hit a flood wait (${floodWait.seconds}s) — stopping this run early`);
            break chatLoop;
          }
          failed += idBatch.length;
          const msg = err instanceof Error ? err.message : String(err);
          if (errors.length < maxErrors) errors.push(`chat ${chatId}: ${msg}`);
          log.error('telegram-scraper', `Reactions backfill failed for chat ${chatId}`, err);
        }
      }
    }
  });

  const remaining = await countRemaining();

  return {
    processed,
    updated,
    failed,
    hasMore: remaining > 0,
    floodWaitSeconds,
    durationMs: Date.now() - t0,
    errors,
  };
}
