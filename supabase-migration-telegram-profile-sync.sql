-- ============================================================
-- Migration: automated profile sync ("Sync profiles" button).
--
-- Adds the column behind pulling each current/premium member's bio,
-- verified/premium/fake/bot flags, online status, and ALL profile photos
-- directly via MTProto (users.GetFullUser + photos.getUserPhotos) —
-- replacing the manual workflow of uploading a "User info + profile
-- photos" ZIP export by hand. Writes into the same telegram_* /
-- profile_photo_urls columns that ZIP import already used.
--
-- telegram_profile_synced_at tracks per-user freshness so repeated clicks
-- of "Sync profiles" page through the membership incrementally (never-
-- synced and stalest users first) instead of re-fetching everyone every
-- time — profile+photo lookups are rate-limited by Telegram more
-- aggressively than message history, so this keeps request volume low.
--
-- Run this in Supabase SQL Editor. Idempotent — safe to run more than once.
-- (The app's ensureSchema() also applies this automatically from
-- lib/db/schema.sql on every boot — running this file by hand is optional,
-- just here so you can review/apply it yourself.)
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_profile_synced_at TIMESTAMPTZ;

-- ============================================================
-- Verify:
-- SELECT from_id, display_name, telegram_profile_synced_at, jsonb_array_length(COALESCE(profile_photo_urls, '[]'::jsonb)) AS photo_count
-- FROM users WHERE is_current_member = TRUE OR is_premium = TRUE
-- ORDER BY telegram_profile_synced_at ASC NULLS FIRST;
-- ============================================================
