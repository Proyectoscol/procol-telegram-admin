/**
 * The "Actualizar miembros" action: one MTProto session, scrape the
 * Main-role and Premium-role groups (if assigned), and apply the same DB
 * writes the manual CSV import used to do (lib/import/membersSnapshot.ts).
 *
 * Note: Telegram's participants.getParticipants caps out around ~10k results
 * for non-admins on very large groups. member_go.py worked around this with
 * Telethon's `aggressive=True` (splitting the query by search letter). None
 * of the groups seen so far are anywhere near that size, so this isn't
 * implemented here — if a group ever needs it, add a search-letter fan-out
 * in scrapeGroupMembers below.
 */

import { Api, type TelegramClient } from 'teleproto';
import { pool, ensureSchema } from '@/lib/db/client';
import { withScraperClient } from '@/lib/telegram-scraper/scrapeClient';
import { applyMembersSnapshot, applyMembersPremiumSnapshot } from '@/lib/import/membersSnapshot';
import type { MemberRow } from '@/lib/import/parseMembersCSV';
import { log } from '@/lib/logger';

interface RoleGroupRow {
  telegram_group_id: string;
  title: string;
  role: 'main' | 'premium';
}

function participantsToRows(users: Api.User[]): MemberRow[] {
  const rows: MemberRow[] = [];
  for (const u of users) {
    if (!u.id) continue;
    const fromId = `user${u.id.toString()}`;
    const username = u.username ?? null;
    const displayName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || null;
    rows.push({ fromId, username, displayName, groupId: null });
  }
  return rows;
}

async function recordScrapeSuccess(telegramGroupId: string, memberCount: number, added: number, updated: number) {
  await pool.query(
    `UPDATE telegram_scraper_groups
     SET member_count = $2, last_scraped_at = NOW(), last_scrape_added = $3, last_scrape_updated = $4, last_scrape_error = NULL, updated_at = NOW()
     WHERE telegram_group_id = $1`,
    [telegramGroupId, memberCount, added, updated]
  );
}

async function recordScrapeError(telegramGroupId: string, error: string) {
  await pool.query(
    `UPDATE telegram_scraper_groups SET last_scrape_error = $2, updated_at = NOW() WHERE telegram_group_id = $1`,
    [telegramGroupId, error]
  );
}

export interface RefreshSideResult {
  groupTitle: string;
  telegramGroupId: string;
  memberCount: number;
  added?: number;
  updated?: number;
  error?: string;
}

export interface RefreshResult {
  main: RefreshSideResult | null;
  premium: RefreshSideResult | null;
  durationMs: number;
}

export async function refreshMembers(): Promise<RefreshResult> {
  const t0 = Date.now();
  await ensureSchema();

  const { rows: roleRows } = await pool.query<RoleGroupRow>(
    `SELECT telegram_group_id, title, role FROM telegram_scraper_groups WHERE role IS NOT NULL`
  );
  const mainRow = roleRows.find((r) => r.role === 'main') ?? null;
  const premiumRow = roleRows.find((r) => r.role === 'premium') ?? null;

  if (!mainRow && !premiumRow) {
    throw new Error('No group is assigned as Main or Premium yet. Discover groups and assign roles in Settings first.');
  }

  const result: RefreshResult = { main: null, premium: null, durationMs: 0 };

  await withScraperClient(async (client: TelegramClient) => {
    const dialogs = await client.getDialogs({});
    const byId = new Map<string, Api.Channel>();
    for (const dialog of dialogs) {
      if (dialog.entity instanceof Api.Channel && dialog.entity.megagroup) {
        byId.set(dialog.entity.id.toString(), dialog.entity);
      }
    }

    if (mainRow) {
      const entity = byId.get(mainRow.telegram_group_id);
      if (!entity) {
        const msg = `Group "${mainRow.title}" was not found in the account's current chats (left the group?).`;
        await recordScrapeError(mainRow.telegram_group_id, msg);
        result.main = { groupTitle: mainRow.title, telegramGroupId: mainRow.telegram_group_id, memberCount: 0, error: msg };
      } else {
        log.startup(`[telegram-scraper] Scraping main group "${mainRow.title}"`);
        const participants = await client.getParticipants(entity, {});
        const rows = participantsToRows(participants);
        const snap = await applyMembersSnapshot(rows, BigInt(mainRow.telegram_group_id), `telegram-scraper:${mainRow.title}`);
        await recordScrapeSuccess(mainRow.telegram_group_id, rows.length, snap.added, snap.updated);
        result.main = {
          groupTitle: mainRow.title,
          telegramGroupId: mainRow.telegram_group_id,
          memberCount: rows.length,
          added: snap.added,
          updated: snap.updated,
        };
      }
    }

    if (premiumRow) {
      const entity = byId.get(premiumRow.telegram_group_id);
      if (!entity) {
        const msg = `Group "${premiumRow.title}" was not found in the account's current chats (left the group?).`;
        await recordScrapeError(premiumRow.telegram_group_id, msg);
        result.premium = { groupTitle: premiumRow.title, telegramGroupId: premiumRow.telegram_group_id, memberCount: 0, error: msg };
      } else {
        log.startup(`[telegram-scraper] Scraping premium group "${premiumRow.title}"`);
        const participants = await client.getParticipants(entity, {});
        const rows = participantsToRows(participants);
        const snap = await applyMembersPremiumSnapshot(rows, `telegram-scraper:${premiumRow.title}`);
        await recordScrapeSuccess(premiumRow.telegram_group_id, rows.length, 0, snap.updated);
        result.premium = {
          groupTitle: premiumRow.title,
          telegramGroupId: premiumRow.telegram_group_id,
          memberCount: rows.length,
          updated: snap.updated,
        };
      }
    }
  });

  result.durationMs = Date.now() - t0;
  return result;
}
