import { Api } from 'teleproto';
import { pool, ensureSchema } from '@/lib/db/client';
import { withScraperClient } from '@/lib/telegram-scraper/scrapeClient';

export type GroupRole = 'main' | 'premium';

export interface ScraperGroup {
  id: number;
  telegramGroupId: string;
  title: string;
  role: GroupRole | null;
  memberCount: number | null;
  lastScrapedAt: string | null;
  lastScrapeAdded: number | null;
  lastScrapeUpdated: number | null;
  lastScrapeError: string | null;
  syncChat: boolean;
  lastChatSyncAt: string | null;
  lastChatSyncAdded: number | null;
  lastChatSyncHasMore: boolean;
  lastChatSyncError: string | null;
}

interface GroupRow {
  id: number;
  telegram_group_id: string;
  title: string;
  role: GroupRole | null;
  member_count: number | null;
  last_scraped_at: string | null;
  last_scrape_added: number | null;
  last_scrape_updated: number | null;
  last_scrape_error: string | null;
  sync_chat: boolean;
  last_chat_sync_at: string | null;
  last_chat_sync_added: number | null;
  last_chat_sync_has_more: boolean;
  last_chat_sync_error: string | null;
}

function mapRow(row: GroupRow): ScraperGroup {
  return {
    id: row.id,
    telegramGroupId: row.telegram_group_id,
    title: row.title,
    role: row.role,
    memberCount: row.member_count,
    lastScrapedAt: row.last_scraped_at,
    lastScrapeAdded: row.last_scrape_added,
    lastScrapeUpdated: row.last_scrape_updated,
    lastScrapeError: row.last_scrape_error,
    syncChat: row.sync_chat,
    lastChatSyncAt: row.last_chat_sync_at,
    lastChatSyncAdded: row.last_chat_sync_added,
    lastChatSyncHasMore: row.last_chat_sync_has_more,
    lastChatSyncError: row.last_chat_sync_error,
  };
}

export async function listGroups(): Promise<ScraperGroup[]> {
  await ensureSchema();
  const { rows } = await pool.query<GroupRow>(
    `SELECT * FROM telegram_scraper_groups ORDER BY (role IS NULL) ASC, role ASC NULLS LAST, title ASC`
  );
  return rows.map(mapRow);
}

/**
 * Connects with the stored session, lists every megagroup (supergroup) the
 * account is a member of — mirrors member_go.py's `chat.megagroup == True`
 * filter — and upserts titles/ids so they show up in Settings for role
 * assignment. Does not scrape members; that's refreshMembers().
 */
export async function discoverGroups(): Promise<ScraperGroup[]> {
  const megagroups = await withScraperClient(async (client) => {
    const dialogs = await client.getDialogs({});
    const out: { id: string; title: string }[] = [];
    for (const dialog of dialogs) {
      const entity = dialog.entity;
      if (entity instanceof Api.Channel && entity.megagroup) {
        out.push({ id: entity.id.toString(), title: dialog.title || entity.title || `Group ${entity.id.toString()}` });
      }
    }
    return out;
  });

  for (const g of megagroups) {
    await pool.query(
      `INSERT INTO telegram_scraper_groups (telegram_group_id, title, discovered_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (telegram_group_id) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()`,
      [g.id, g.title]
    );
  }

  return listGroups();
}

/** Assigns (or clears, with role=null) a group's role. At most one group can hold each role — assigning bumps any previous holder back to unassigned. */
export async function setGroupRole(id: number, role: GroupRole | null): Promise<void> {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (role) {
      await client.query(
        `UPDATE telegram_scraper_groups SET role = NULL, updated_at = NOW() WHERE role = $1 AND id != $2`,
        [role, id]
      );
    }
    await client.query(`UPDATE telegram_scraper_groups SET role = $1, updated_at = NOW() WHERE id = $2`, [role, id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Toggles whether "Sync chats" pulls this group's message/reaction history. Independent of role — any discovered group can opt in. */
export async function setGroupSyncChat(id: number, syncChat: boolean): Promise<void> {
  await ensureSchema();
  await pool.query(
    `UPDATE telegram_scraper_groups SET sync_chat = $1, updated_at = NOW() WHERE id = $2`,
    [syncChat, id]
  );
}
