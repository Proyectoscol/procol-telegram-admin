/**
 * "Sync chats" — pulls message + reaction history for groups opted into
 * sync_chat directly via MTProto, replacing the manual Telegram Desktop
 * "Export Chat History" -> JSON -> upload workflow for those groups.
 *
 * Design notes (researched against gram-js/teleproto source, Telegram's
 * messages.getHistory semantics, and prior-art OSS scrapers before writing
 * this — see chat history with the user for the write-up):
 * - Incremental: resumes from MAX(messages.message_id) already stored for
 *   that chat_id, via `minId` on iterMessages — no separate progress table
 *   needed, the messages table itself is the source of truth.
 * - Reactions: Message.reactions.recentReactions comes back populated on
 *   the same message objects `getHistory`/`iterMessages` already returns —
 *   no extra per-message API call. This is the exact same "recent
 *   reactors" sample Telegram Desktop's JSON export shows (capped by
 *   Telegram server-side), so parity with the manual path is inherent, not
 *   something we approximate.
 * - Budget-capped per call: a first-time backfill on an old, busy group can
 *   be tens of thousands of messages. Rather than run one huge request
 *   (timeout risk) or build a background job queue, each call fetches up to
 *   a bounded number of messages/time and reports back whether more remain
 *   (`hasMore`) — the user clicks "Sync chats" again to continue. Progress
 *   is durable after every page (see PAGE_SIZE below), so an interrupted
 *   run never re-fetches what it already saved.
 * - Reuses lib/ingest/ingestExport() for every DB write, so live-synced
 *   messages/reactions/users go through the exact same logic (and
 *   conflict/skip counting) as a manually uploaded result.json.
 */

import { Api, type TelegramClient } from 'teleproto';
import { pool, ensureSchema } from '@/lib/db/client';
import { withScraperClient } from '@/lib/telegram-scraper/scrapeClient';
import { ingestExport } from '@/lib/ingest/ingest';
import type { TelegramExport, TelegramExportMessage } from '@/lib/ingest/types';
import { log } from '@/lib/logger';

const PAGE_SIZE = 100; // matches Telegram's effective per-request getHistory cap
const PER_GROUP_MAX_MESSAGES = 4000;
const PER_GROUP_MAX_DURATION_MS = 90 * 1000;
const TOTAL_MAX_DURATION_MS = 4.5 * 60 * 1000; // stay under the route's maxDuration

function peerToFromId(peer: Api.TypePeer | undefined | null): string | undefined {
  if (!peer) return undefined;
  if (peer instanceof Api.PeerUser) return `user${peer.userId.toString()}`;
  if (peer instanceof Api.PeerChannel) return `channel${peer.channelId.toString()}`;
  if (peer instanceof Api.PeerChat) return `chat${peer.chatId.toString()}`;
  return undefined;
}

function toIso(unixSeconds: number | undefined | null): string | undefined {
  if (unixSeconds == null) return undefined;
  return new Date(unixSeconds * 1000).toISOString();
}

function resolveMediaType(media: Api.TypeMessageMedia | undefined): string | undefined {
  if (!media) return undefined;
  if (media instanceof Api.MessageMediaPhoto) return media.photo ? 'photo' : undefined;
  if (media instanceof Api.MessageMediaDocument) {
    const doc = media.document;
    const attrs = doc instanceof Api.Document ? doc.attributes : [];
    if (attrs.some((a) => a instanceof Api.DocumentAttributeSticker)) return 'sticker';
    if (attrs.some((a) => a instanceof Api.DocumentAttributeAnimated)) return 'animation';
    if (media.round) return 'video_message';
    if (media.video) return 'video_file';
    if (media.voice) return 'voice_message';
    if (attrs.some((a) => a instanceof Api.DocumentAttributeAudio && !a.voice)) return 'audio_file';
    return 'file';
  }
  return undefined;
}

function reactionEmoji(reaction: Api.TypeReaction | undefined): string | null {
  if (!reaction) return null;
  if (reaction instanceof Api.ReactionEmoji) return reaction.emoticon;
  if (reaction instanceof Api.ReactionCustomEmoji) return 'custom';
  return null;
}

/** Collects every Peer referenced by a page of messages (senders + reactors), for a single batched name-resolution pass. */
function collectPeers(messages: Api.Message[]): Map<string, Api.TypePeer> {
  const peers = new Map<string, Api.TypePeer>();
  for (const msg of messages) {
    const fromId = peerToFromId(msg.fromId);
    if (fromId && msg.fromId) peers.set(fromId, msg.fromId);
    for (const rr of msg.reactions?.recentReactions ?? []) {
      if (!(rr instanceof Api.MessagePeerReaction)) continue;
      const reactorId = peerToFromId(rr.peerId);
      if (reactorId) peers.set(reactorId, rr.peerId);
    }
  }
  return peers;
}

async function resolveNames(client: TelegramClient, peers: Map<string, Api.TypePeer>, cache: Map<string, string>): Promise<void> {
  for (const [fromId, peer] of Array.from(peers.entries())) {
    if (cache.has(fromId)) continue;
    try {
      const entity = await client.getEntity(peer);
      let name: string | undefined;
      if (entity instanceof Api.User) {
        name = [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim() || undefined;
      } else if (entity instanceof Api.Channel || entity instanceof Api.Chat) {
        name = entity.title || undefined;
      }
      if (name) cache.set(fromId, name);
    } catch (err) {
      log.error('telegram-scraper', `Could not resolve entity for ${fromId}`, err);
    }
  }
}

function mapMessage(msg: Api.Message, names: Map<string, string>): TelegramExportMessage | null {
  if (msg instanceof Api.MessageEmpty) return null;

  const isService = msg instanceof Api.MessageService;
  const fromId = peerToFromId(msg.fromId);
  const fromName = fromId ? names.get(fromId) : undefined;

  const out: TelegramExportMessage = {
    id: msg.id,
    type: isService ? 'service' : 'message',
    date: toIso(msg.date),
  };

  if (isService) {
    out.actor_id = fromId;
    out.actor = fromName;
    out.text = '';
    return out;
  }

  out.from_id = fromId;
  out.from = fromName;
  out.text = msg.message || '';
  if (msg.replyTo instanceof Api.MessageReplyHeader && msg.replyTo.replyToMsgId) {
    out.reply_to_message_id = msg.replyTo.replyToMsgId;
  }
  if (msg.editDate) out.edited = toIso(msg.editDate);
  const mediaType = resolveMediaType(msg.media);
  if (mediaType) out.media_type = mediaType;

  const recent = msg.reactions?.recentReactions;
  if (recent && recent.length > 0) {
    const grouped = new Map<string, { from?: string; from_id?: string; date?: string }[]>();
    for (const rr of recent) {
      if (!(rr instanceof Api.MessagePeerReaction)) continue;
      const emoji = reactionEmoji(rr.reaction);
      if (!emoji) continue;
      const reactorId = peerToFromId(rr.peerId);
      if (!reactorId) continue;
      if (!grouped.has(emoji)) grouped.set(emoji, []);
      grouped.get(emoji)!.push({ from_id: reactorId, from: names.get(reactorId), date: toIso(rr.date) });
    }
    if (grouped.size > 0) {
      out.reactions = Array.from(grouped.entries()).map(([emoji, list]) => ({ emoji, count: list.length, recent: list }));
    }
  }

  return out;
}

async function getMaxMessageId(chatId: number): Promise<number> {
  const { rows } = await pool.query<{ max: string | null }>(
    'SELECT MAX(message_id) AS max FROM messages WHERE chat_id = $1',
    [chatId]
  );
  const max = rows[0]?.max;
  return max ? parseInt(max, 10) : 0;
}

function chatTypeOf(entity: Api.Channel): string {
  if (entity.broadcast) return 'channel';
  return entity.username ? 'public_supergroup' : 'private_supergroup';
}

export interface ChatSyncGroupResult {
  telegramGroupId: string;
  title: string;
  messagesFetched: number;
  messagesInserted: number;
  reactionsInserted: number;
  hasMore: boolean;
  error?: string;
}

/** Syncs one group's chat history, up to the given budget. Inserts progressively (page by page) so an interrupted run keeps whatever it already fetched. */
async function syncOneGroup(
  client: TelegramClient,
  entity: Api.Channel,
  telegramGroupId: string,
  title: string,
  deadline: number
): Promise<ChatSyncGroupResult> {
  const chatId = Number(telegramGroupId);
  const sinceId = await getMaxMessageId(chatId);
  const groupDeadline = Math.min(deadline, Date.now() + PER_GROUP_MAX_DURATION_MS);
  const nameCache = new Map<string, string>();

  let messagesFetched = 0;
  let messagesInserted = 0;
  let reactionsInserted = 0;
  let hasMore = false;
  let page: Api.Message[] = [];

  const flush = async () => {
    if (page.length === 0) return;
    const peers = collectPeers(page);
    await resolveNames(client, peers, nameCache);
    const mapped = page.map((m) => mapMessage(m, nameCache)).filter((m): m is TelegramExportMessage => m !== null);
    page = [];
    if (mapped.length === 0) return;

    const exportPayload: TelegramExport = {
      id: chatId,
      name: title,
      type: chatTypeOf(entity),
      messages: mapped,
    };
    const result = await ingestExport(exportPayload, `telegram-scraper:chat-sync:${title}`);
    messagesInserted += result.messagesInserted;
    reactionsInserted += result.reactionsInserted;
  };

  try {
    for await (const msg of client.iterMessages(entity, { minId: sinceId, reverse: true })) {
      if (!(msg instanceof Api.MessageEmpty)) {
        page.push(msg);
        messagesFetched++;
      }

      if (page.length >= PAGE_SIZE) {
        await flush();
      }

      if (messagesFetched >= PER_GROUP_MAX_MESSAGES || Date.now() >= groupDeadline) {
        hasMore = true;
        break;
      }
    }
    await flush();
  } catch (err) {
    await flush().catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    log.error('telegram-scraper', `Chat sync failed for "${title}"`, err);
    return { telegramGroupId, title, messagesFetched, messagesInserted, reactionsInserted, hasMore, error: message };
  }

  return { telegramGroupId, title, messagesFetched, messagesInserted, reactionsInserted, hasMore };
}

async function recordSyncResult(telegramGroupId: string, result: ChatSyncGroupResult) {
  await pool.query(
    `UPDATE telegram_scraper_groups
     SET last_chat_sync_at = NOW(), last_chat_sync_added = $2, last_chat_sync_has_more = $3, last_chat_sync_error = $4, updated_at = NOW()
     WHERE telegram_group_id = $1`,
    [telegramGroupId, result.messagesInserted, result.hasMore, result.error ?? null]
  );
}

export interface ChatSyncResult {
  groups: ChatSyncGroupResult[];
  durationMs: number;
}

/** Syncs every group with sync_chat = TRUE, one MTProto connection for all of them, budget-capped overall. */
export async function syncAllEnabledChats(): Promise<ChatSyncResult> {
  const t0 = Date.now();
  await ensureSchema();

  const { rows: enabledRows } = await pool.query<{ telegram_group_id: string; title: string }>(
    `SELECT telegram_group_id, title FROM telegram_scraper_groups WHERE sync_chat = TRUE ORDER BY title`
  );

  if (enabledRows.length === 0) {
    throw new Error('No group has "Sync chat" enabled yet. Turn it on for at least one group in Settings first.');
  }

  const deadline = Date.now() + TOTAL_MAX_DURATION_MS;
  const results: ChatSyncGroupResult[] = [];

  await withScraperClient(async (client) => {
    const dialogs = await client.getDialogs({});
    const byId = new Map<string, Api.Channel>();
    for (const dialog of dialogs) {
      if (dialog.entity instanceof Api.Channel && dialog.entity.megagroup) {
        byId.set(dialog.entity.id.toString(), dialog.entity);
      }
    }

    for (const row of enabledRows) {
      if (Date.now() >= deadline) {
        results.push({
          telegramGroupId: row.telegram_group_id,
          title: row.title,
          messagesFetched: 0,
          messagesInserted: 0,
          reactionsInserted: 0,
          hasMore: true,
        });
        continue;
      }

      const entity = byId.get(row.telegram_group_id);
      if (!entity) {
        const result: ChatSyncGroupResult = {
          telegramGroupId: row.telegram_group_id,
          title: row.title,
          messagesFetched: 0,
          messagesInserted: 0,
          reactionsInserted: 0,
          hasMore: false,
          error: `Group "${row.title}" was not found in the account's current chats (left the group?).`,
        };
        await recordSyncResult(row.telegram_group_id, result);
        results.push(result);
        continue;
      }

      log.startup(`[telegram-scraper] Syncing chat history for "${row.title}"`);
      const result = await syncOneGroup(client, entity, row.telegram_group_id, row.title, deadline);
      await recordSyncResult(row.telegram_group_id, result);
      results.push(result);
    }
  });

  return { groups: results, durationMs: Date.now() - t0 };
}
