-- ============================================================
-- Migration: automated chat history sync ("Sync chats" button).
--
-- Adds the columns behind opting a discovered Telegram group into automated
-- message + reaction sync — replacing the manual workflow of exporting
-- result.json from Telegram Desktop (Export Chat History → JSON → upload on
-- the Import page) for that group. Independent of the Main/Premium role
-- used by "Update members" — any discovered group can be toggled on.
--
-- Sync is incremental (resumes from MAX(messages.message_id) already stored
-- for that chat) and capped per click for safety against Telegram rate
-- limits and request timeouts (lib/telegram-scraper/chatSync.ts), so a large
-- first-time backfill may take a few clicks — last_chat_sync_has_more
-- reflects whether there's more history left to pull.
--
-- Run this in Supabase SQL Editor. Idempotent — safe to run more than once.
-- (The app's ensureSchema() also applies this automatically from
-- lib/db/schema.sql on every boot — running this file by hand is optional,
-- just here so you can review/apply it yourself.)
-- ============================================================

ALTER TABLE telegram_scraper_groups ADD COLUMN IF NOT EXISTS sync_chat BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE telegram_scraper_groups ADD COLUMN IF NOT EXISTS last_chat_sync_at TIMESTAMPTZ;
ALTER TABLE telegram_scraper_groups ADD COLUMN IF NOT EXISTS last_chat_sync_added INT;
ALTER TABLE telegram_scraper_groups ADD COLUMN IF NOT EXISTS last_chat_sync_has_more BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE telegram_scraper_groups ADD COLUMN IF NOT EXISTS last_chat_sync_error TEXT;

-- ============================================================
-- Verify:
-- SELECT title, sync_chat, last_chat_sync_at, last_chat_sync_added, last_chat_sync_has_more, last_chat_sync_error
-- FROM telegram_scraper_groups ORDER BY sync_chat DESC, title;
-- ============================================================
