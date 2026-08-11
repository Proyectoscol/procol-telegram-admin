-- ============================================================
-- Migration: Telegram member scraper (Settings → Telegram scraper).
--
-- Adds the tables backing the in-app "Actualizar miembros" button, which
-- replaces the manual workflow of running member_go.py and uploading its
-- CSVs by hand. The app logs in as a real Telegram user account (via
-- GramJS/MTProto — the same protocol Telethon uses, not the limited bot
-- API), so it can list group participants directly.
--
-- telegram_scraper_account: singleton row (id is pinned to 1) holding the
--   Telegram API credentials, phone number, and login session. api_id,
--   api_hash, phone_number, and session_string are AES-256-GCM encrypted by
--   the app (lib/crypto/secretBox.ts, key = SCRAPER_ENCRYPTION_KEY env var)
--   before being written here — this migration only creates the column,
--   the app never stores them in plaintext.
--
-- telegram_scraper_groups: every megagroup discovered on the logged-in
--   account. "role" says what "Actualizar miembros" does with that group:
--     'main'    -> full membership sync (mirrors the old "Group members"
--                  CSV import: resets is_current_member, marks who's in)
--     'premium' -> marks matched users as premium (mirrors the old "Group
--                  Members Premium" CSV import; does not reset anyone)
--   Groups with no role are just visible in Settings, not touched by the
--   refresh button. At most one group can hold each role — enforced by the
--   partial unique index below.
--
-- Run this in Supabase SQL Editor. Idempotent — safe to run more than once.
-- (The app's ensureSchema() also applies this automatically from
-- lib/db/schema.sql on every boot — running this file by hand is optional,
-- just here so you can review/apply it yourself.)
-- ============================================================

CREATE TABLE IF NOT EXISTS telegram_scraper_account (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  api_id TEXT NOT NULL,
  api_hash TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  phone_number_display TEXT,
  session_string TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'pending_code', 'pending_password', 'connected', 'error')),
  last_error TEXT,
  last_connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_scraper_groups (
  id SERIAL PRIMARY KEY,
  telegram_group_id BIGINT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  role TEXT CHECK (role IN ('main', 'premium')),
  member_count INT,
  last_scraped_at TIMESTAMPTZ,
  last_scrape_added INT,
  last_scrape_updated INT,
  last_scrape_error TEXT,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_scraper_groups_role ON telegram_scraper_groups(role) WHERE role IS NOT NULL;

-- ============================================================
-- Verify:
-- SELECT status, phone_number_display, last_connected_at FROM telegram_scraper_account;
-- SELECT title, role, member_count, last_scraped_at FROM telegram_scraper_groups ORDER BY role NULLS LAST, title;
-- ============================================================
