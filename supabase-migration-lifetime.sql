-- ============================================================
-- Migration: Lifetime as its own product, distinct from Premium.
--
-- Premium always implies Lifetime (Premium members automatically get
-- Lifetime access too — cascaded at every write path in the app code).
-- Lifetime does NOT imply Premium — a member can hold the Lifetime product
-- without being in the Premium group.
--
-- Run this in Supabase SQL Editor. Idempotent — safe to run more than once.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_lifetime BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime_since TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_is_lifetime ON users(is_lifetime) WHERE is_lifetime = TRUE;

-- One-time backfill: everyone currently Premium becomes Lifetime too.
-- Safe to re-run — only touches rows that still need it.
UPDATE users SET is_lifetime = TRUE, lifetime_since = COALESCE(lifetime_since, premium_since, NOW())
WHERE is_premium = TRUE AND COALESCE(is_lifetime, FALSE) = FALSE;

-- ============================================================
-- Verify:
-- SELECT count(*) FILTER (WHERE is_premium), count(*) FILTER (WHERE is_lifetime),
--        count(*) FILTER (WHERE is_premium AND NOT is_lifetime) AS should_be_zero
-- FROM users;
-- ============================================================
