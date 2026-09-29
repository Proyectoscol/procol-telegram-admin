/**
 * Shared reaction-parsing logic for both the forward-only live sync (chatSync.ts) and the
 * historical backfill (reactionsBackfill.ts) — they both read the same Api.Message.reactions
 * shape and must stay in sync on how it's interpreted.
 *
 * Telegram's MessageReactions carries two different things that are easy to conflate:
 * - `recentReactions`: a small sample of named reactors, capped server-side by Telegram
 *   (never the full list once a message has more reactions than the cap).
 * - `results`: the true total count per emoji — always accurate, no extra API call needed,
 *   present on the same message object.
 * Any code that treats `recentReactions.length` as "the reaction count" is wrong once a
 * message exceeds Telegram's sample cap. Use `results` for counts, `recentReactions` only for
 * "who reacted" (best-effort, may be a subset of the true total).
 */
import { Api } from 'teleproto';

export function peerToFromId(peer: Api.TypePeer | undefined | null): string | undefined {
  if (!peer) return undefined;
  if (peer instanceof Api.PeerUser) return `user${peer.userId.toString()}`;
  if (peer instanceof Api.PeerChannel) return `channel${peer.channelId.toString()}`;
  if (peer instanceof Api.PeerChat) return `chat${peer.chatId.toString()}`;
  return undefined;
}

export function reactionEmoji(reaction: Api.TypeReaction | undefined): string | null {
  if (!reaction) return null;
  if (reaction instanceof Api.ReactionEmoji) return reaction.emoticon;
  if (reaction instanceof Api.ReactionCustomEmoji) return 'custom';
  return null;
}

export function toIsoSeconds(unixSeconds: number | undefined | null): string | undefined {
  if (unixSeconds == null) return undefined;
  return new Date(unixSeconds * 1000).toISOString();
}

export interface ExtractedReactions {
  /** Named reactor sample (capped by Telegram) — "who reacted", best-effort. */
  recent: { emoji: string; from_id: string; from?: string; date?: string }[];
  /** True per-emoji totals from Telegram — "how many", always accurate. */
  totals: { emoji: string; count: number }[];
}

/** Extracts both the capped named-reactor sample and the true per-emoji totals from a message's `reactions` field. */
export function extractReactions(reactions: Api.TypeMessageReactions | undefined, names: Map<string, string>): ExtractedReactions {
  const recent: ExtractedReactions['recent'] = [];
  for (const rr of reactions?.recentReactions ?? []) {
    if (!(rr instanceof Api.MessagePeerReaction)) continue;
    const emoji = reactionEmoji(rr.reaction);
    if (!emoji) continue;
    const reactorId = peerToFromId(rr.peerId);
    if (!reactorId) continue;
    recent.push({ emoji, from_id: reactorId, from: names.get(reactorId), date: toIsoSeconds(rr.date) });
  }

  const totals: ExtractedReactions['totals'] = [];
  for (const rc of reactions?.results ?? []) {
    const emoji = reactionEmoji(rc.reaction);
    if (!emoji) continue;
    totals.push({ emoji, count: rc.count });
  }

  return { recent, totals };
}
