/**
 * "Sync profiles" — pulls each current/premium member's bio, verified/
 * premium/fake/bot flags, online status, and every profile photo directly
 * via MTProto, replacing the manual workflow of uploading a "User info +
 * profile photos" ZIP export by hand. Writes into the exact same
 * telegram_* / profile_photo_urls columns that ZIP import already uses
 * (app/api/import/user-info-with-photos/route.ts) — this is just another
 * source feeding the same schema.
 *
 * Design notes (researched — via web search across gram-js/Telethon GitHub
 * issues, the telegram-export OSS archiver, and Telegram's TL schema —
 * before writing this; see chat history with the user for the write-up):
 * - Bot/verified/premium/fake flags and online status come free on the
 *   plain Api.User object (already returned by getParticipants — no extra
 *   call). Only the bio/about text needs a separate call: GetFullUser.
 * - GetUserPhotos returns EVERY photo the user has ever set as their
 *   avatar, not just the current one — same "profile photos" gallery
 *   Telegram's UI shows when you tap someone's avatar.
 * - Per-user profile/entity lookups (GetFullUser) are rate-limited by
 *   Telegram noticeably more aggressively than message history — treated
 *   as a contact-harvesting signal. telegram-export (a well-regarded OSS
 *   Telethon archiver) hardcodes 1.5s between GetFullUser calls based on
 *   real production use; we mirror that exactly (GET_FULL_USER_DELAY_MS).
 * - GetFullUser throws UserIdInvalidError/PeerIdInvalidError unless the
 *   account's session already has that user's access_hash cached — which
 *   only happens after resolving them via a live call like
 *   getParticipants(). So this can only ever process users already
 *   fetched via getParticipants() on a group in this same connection —
 *   which naturally scopes it to real, current Main/Premium members
 *   rather than arbitrary Telegram IDs (also the ethically-correct scope:
 *   bulk profile+photo harvesting is a meaningfully more sensitive
 *   category than analyzing your own group's message history).
 * - Incremental via telegram_profile_synced_at (NULL/oldest first, skips
 *   anyone synced in the last 24h) — same self-resuming, budget-capped-
 *   per-click shape as chatSync.ts, but paced far more conservatively
 *   given the stricter rate limit.
 */

import { Api, type TelegramClient } from 'teleproto';
import bigInt from 'big-integer';
import { pool, ensureSchema } from '@/lib/db/client';
import { withScraperClient } from '@/lib/telegram-scraper/scrapeClient';
import { uploadProfilePhoto } from '@/lib/supabase/upload-profile-photo';
import { log } from '@/lib/logger';

const PER_RUN_MAX_USERS = 60;
const TOTAL_MAX_DURATION_MS = 4.5 * 60 * 1000; // stay under the route's maxDuration
const GET_FULL_USER_DELAY_MS = 1500; // telegram-export's proven-safe pacing for per-user profile lookups
const PHOTO_REQUEST_DELAY_MS = 400; // photo list/download is a lighter-weight call than GetFullUser, but still paced
const MAX_PHOTOS_PER_USER = 20;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // don't re-sync a profile synced within the last 24h

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CandidateUser {
  fromId: string;
  telegramId: bigint;
  existingPhotoUrls: string[];
}

async function getCandidates(limit: number): Promise<CandidateUser[]> {
  const { rows } = await pool.query<{ from_id: string; profile_photo_urls: unknown }>(
    `SELECT from_id, profile_photo_urls FROM users
     WHERE (is_current_member = TRUE OR is_premium = TRUE)
       AND from_id LIKE 'user%'
       AND (telegram_profile_synced_at IS NULL OR telegram_profile_synced_at < NOW() - INTERVAL '24 hours')
     ORDER BY telegram_profile_synced_at ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  );
  const out: CandidateUser[] = [];
  for (const r of rows) {
    const idStr = r.from_id.slice(4);
    if (!/^\d+$/.test(idStr)) continue; // only real Telegram user ids (from_id convention: "user<id>")
    out.push({
      fromId: r.from_id,
      telegramId: BigInt(idStr),
      existingPhotoUrls: Array.isArray(r.profile_photo_urls) ? (r.profile_photo_urls as string[]) : [],
    });
  }
  return out;
}

async function countRemaining(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM users
     WHERE (is_current_member = TRUE OR is_premium = TRUE)
       AND from_id LIKE 'user%'
       AND (telegram_profile_synced_at IS NULL OR telegram_profile_synced_at < NOW() - INTERVAL '24 hours')`
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

/** Resolves every current Main/Premium member to an entity with a cached access_hash, by calling getParticipants on each role group once. */
async function resolveMemberEntities(client: TelegramClient): Promise<Map<string, Api.User>> {
  const { rows: roleRows } = await pool.query<{ telegram_group_id: string }>(
    `SELECT telegram_group_id FROM telegram_scraper_groups WHERE role IS NOT NULL`
  );
  const map = new Map<string, Api.User>();
  if (roleRows.length === 0) return map;

  const dialogs = await client.getDialogs({});
  const groupById = new Map<string, Api.Channel>();
  for (const dialog of dialogs) {
    if (dialog.entity instanceof Api.Channel && dialog.entity.megagroup) {
      groupById.set(dialog.entity.id.toString(), dialog.entity);
    }
  }

  for (const row of roleRows) {
    const entity = groupById.get(row.telegram_group_id);
    if (!entity) continue;
    const participants = await client.getParticipants(entity, {});
    for (const user of participants) {
      if (user.id) map.set(`user${user.id.toString()}`, user);
    }
  }
  return map;
}

function statusToFields(status: Api.TypeUserStatus | undefined): { statusType: string | null; lastSeen: Date | null } {
  if (!status || status instanceof Api.UserStatusEmpty) return { statusType: null, lastSeen: null };
  if (status instanceof Api.UserStatusOnline) return { statusType: 'online', lastSeen: new Date() };
  if (status instanceof Api.UserStatusOffline) return { statusType: 'offline', lastSeen: new Date(status.wasOnline * 1000) };
  if (status instanceof Api.UserStatusRecently) return { statusType: 'recently', lastSeen: null };
  if (status instanceof Api.UserStatusLastWeek) return { statusType: 'last_week', lastSeen: null };
  if (status instanceof Api.UserStatusLastMonth) return { statusType: 'last_month', lastSeen: null };
  return { statusType: null, lastSeen: null };
}

interface FloodWait {
  seconds: number;
}
function asFloodWait(err: unknown): FloodWait | null {
  const seconds = (err as { seconds?: unknown } | null)?.seconds;
  return typeof seconds === 'number' ? { seconds } : null;
}

async function syncOneUser(
  client: TelegramClient,
  candidate: CandidateUser,
  entity: Api.User
): Promise<{ photosDownloaded: number }> {
  await sleep(GET_FULL_USER_DELAY_MS);
  const fullResult = await client.invoke(new Api.users.GetFullUser({ id: entity }));
  const bio = fullResult.fullUser instanceof Api.UserFull ? fullResult.fullUser.about ?? null : null;

  const { statusType, lastSeen } = statusToFields(entity.status);

  await sleep(PHOTO_REQUEST_DELAY_MS);
  const photosResult = await client.invoke(
    new Api.photos.GetUserPhotos({ userId: entity, offset: 0, maxId: bigInt(0), limit: MAX_PHOTOS_PER_USER })
  );
  const photos = photosResult.photos.filter((p): p is Api.Photo => p instanceof Api.Photo);

  let photosDownloaded = 0;
  const finalUrls: string[] = [];
  for (const photo of photos) {
    const filename = `${photo.id.toString()}.jpg`;
    const cached = candidate.existingPhotoUrls.find((u) => u.endsWith(`/${filename}`));
    if (cached) {
      finalUrls.push(cached);
      continue;
    }
    await sleep(PHOTO_REQUEST_DELAY_MS);
    // downloadMedia's TS signature only lists Message | TypeMessageMedia, but its
    // implementation explicitly handles a bare Api.Photo too (downloads.js:
    // `media instanceof Api.Photo` -> _downloadPhoto) — verified against source,
    // the .d.ts is just incomplete here.
    const buffer = await client.downloadMedia(photo as unknown as Api.TypeMessageMedia);
    if (!buffer || typeof buffer === 'string') continue;
    const url = await uploadProfilePhoto(buffer, candidate.fromId, filename);
    finalUrls.push(url);
    photosDownloaded++;
  }

  await pool.query(
    `UPDATE users SET
       first_name = COALESCE(NULLIF($2, ''), first_name),
       last_name = COALESCE(NULLIF($3, ''), last_name),
       username = COALESCE(NULLIF($4, ''), username),
       phone = COALESCE(NULLIF($5, ''), phone),
       telegram_premium = $6,
       telegram_verified = $7,
       telegram_fake = $8,
       telegram_bot = $9,
       telegram_status_type = COALESCE($10, telegram_status_type),
       telegram_last_seen = COALESCE($11, telegram_last_seen),
       telegram_bio = COALESCE(NULLIF($12, ''), telegram_bio),
       profile_photo_urls = $13::jsonb,
       telegram_profile_synced_at = NOW(),
       updated_at = NOW()
     WHERE from_id = $1`,
    [
      candidate.fromId,
      entity.firstName ?? '',
      entity.lastName ?? '',
      entity.username ?? '',
      entity.phone ?? '',
      !!entity.premium,
      !!entity.verified,
      !!entity.fake,
      !!entity.bot,
      statusType,
      lastSeen,
      bio ?? '',
      JSON.stringify(finalUrls),
    ]
  );

  return { photosDownloaded };
}

export interface ProfileSyncResult {
  usersProcessed: number;
  usersFailed: number;
  photosDownloaded: number;
  hasMore: boolean;
  floodWaitSeconds?: number;
  durationMs: number;
  errors: string[];
}

export async function syncProfiles(): Promise<ProfileSyncResult> {
  const t0 = Date.now();
  await ensureSchema();

  const candidates = await getCandidates(PER_RUN_MAX_USERS);
  if (candidates.length === 0) {
    return { usersProcessed: 0, usersFailed: 0, photosDownloaded: 0, hasMore: false, durationMs: Date.now() - t0, errors: [] };
  }

  let usersProcessed = 0;
  let usersFailed = 0;
  let photosDownloaded = 0;
  let floodWaitSeconds: number | undefined;
  const errors: string[] = [];
  const maxErrors = 20;
  const deadline = Date.now() + TOTAL_MAX_DURATION_MS;

  await withScraperClient(async (client) => {
    const entities = await resolveMemberEntities(client);

    for (const candidate of candidates) {
      if (Date.now() >= deadline) break;

      const entity = entities.get(candidate.fromId);
      if (!entity) continue; // not currently in a role-assigned group's live participant list — skip, will retry once they are

      try {
        const { photosDownloaded: n } = await syncOneUser(client, candidate, entity);
        photosDownloaded += n;
        usersProcessed++;
      } catch (err) {
        const floodWait = asFloodWait(err);
        if (floodWait) {
          floodWaitSeconds = floodWait.seconds;
          log.startup(`[telegram-scraper] Profile sync hit a flood wait (${floodWait.seconds}s) — stopping this run early`);
          break;
        }
        usersFailed++;
        const msg = err instanceof Error ? err.message : String(err);
        if (errors.length < maxErrors) errors.push(`${candidate.fromId}: ${msg}`);
        log.error('telegram-scraper', `Profile sync failed for ${candidate.fromId}`, err);
      }
    }
  });

  const remaining = await countRemaining();

  return {
    usersProcessed,
    usersFailed,
    photosDownloaded,
    hasMore: remaining > 0,
    floodWaitSeconds,
    durationMs: Date.now() - t0,
    errors,
  };
}
