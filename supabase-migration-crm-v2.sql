-- ============================================================
-- Migration: CRM v2 — Opportunity Engine, member timeline, roadmap,
-- sales/coaching layer, review queue, questionnaire + course sync.
--
-- Run this in Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Every statement is idempotent (safe to run more than once, safe on a
-- database that already has data in it — nothing here drops or rewrites
-- existing columns).
-- ============================================================

-- ── 1. CRM fields on the existing `users` table ─────────────────────────────
-- (is_premium / is_current_member / member_since / notes already exist and
-- are reused as-is — see the plan doc for why.)

ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'COLD'; -- HOT | WARM | COLD | INACTIVE | REMOVED
ALTER TABLE users ADD COLUMN IF NOT EXISTS offer_type TEXT DEFAULT 'UNKNOWN'; -- DEPOSIT | PAYMENT_PLAN | COACHING_ACCESS | LIFETIME | PREMIUM | EVENT_TICKET | MASTERMIND | OTHER | UNKNOWN
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'UNKNOWN'; -- PAID | PAYMENT_PLAN | OVERDUE | REFUNDED | UNKNOWN
ALTER TABLE users ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12, 2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_override TEXT; -- manual override: ACTIVE | INACTIVE | REMOVED (null = automatic)
ALTER TABLE users ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ; -- when they left the community (drives the "win-back" risk rule)
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday DATE; -- powers the birthday/community-touch rule
ALTER TABLE users ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb; -- e.g. ["Lifetime","Event Ticket"] — see plan doc, taste call vs. a tags table

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_offer_type ON users(offer_type);
CREATE INDEX IF NOT EXISTS idx_users_left_at ON users(left_at) WHERE left_at IS NOT NULL;

-- ── 2. Import batches: extend so list-imports (not just Telegram JSON) log here ──

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'TELEGRAM'; -- TELEGRAM | GROUP_MEMBERS | EMAIL | PAYMENT_PLAN | LIFETIME | PREMIUM | EVENT_TICKET | MEMBER_UPDATE | QUESTIONNAIRE
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS members_created INT DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS members_updated INT DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS tagged INT DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS unmatched INT DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS skipped INT DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS error_count INT DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS total_rows INT DEFAULT 0;
-- List imports (payment/lifetime/premium/event/member-update lists) aren't
-- tied to a Telegram chat, unlike the original chat-export imports.
ALTER TABLE import_batches ALTER COLUMN chat_id DROP NOT NULL;

-- ── 3. Review queue: rows from a list import that couldn't be confidently matched ──

CREATE TABLE IF NOT EXISTS import_reviews (
  id SERIAL PRIMARY KEY,
  batch_id INT REFERENCES import_batches(id) ON DELETE SET NULL,
  import_type TEXT NOT NULL, -- PAYMENT_PLAN | LIFETIME | PREMIUM | EVENT_TICKET | EMAIL | MEMBER_UPDATE | QUESTIONNAIRE
  reason TEXT NOT NULL, -- DUPLICATE_NAME | UNMATCHED | MISSING_IDENTIFIER
  raw_row JSONB NOT NULL,
  suggested_name TEXT,
  suggested_username TEXT,
  suggested_telegram_id TEXT,
  suggested_email TEXT,
  candidate_ids JSONB, -- array of candidate users.id
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | RESOLVED | SKIPPED
  resolved_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_import_reviews_status ON import_reviews(status);
CREATE INDEX IF NOT EXISTS idx_import_reviews_type ON import_reviews(import_type);

-- ── 4. Sales / coaching layer ────────────────────────────────────────────────
-- These feed both the AI member profile and the Opportunity Engine.
-- Sales calls reuse `contact_calls` (loosened below); wins/notes/follow-ups
-- are new tables.

CREATE TABLE IF NOT EXISTS wins (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2),
  description TEXT,
  occurred_at TIMESTAMPTZ,
  source TEXT, -- where it came from: event, DM, call, ...
  confidence TEXT, -- CONFIRMED | LIKELY | UNCONFIRMED
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wins_user ON wins(user_id);

CREATE TABLE IF NOT EXISTS coach_notes (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_type TEXT, -- CALL | DM | OBSERVATION | GENERAL | TELEGRAM_BOT_INPUT
  summary TEXT,
  next_action TEXT,
  follow_up_date DATE,
  created_by TEXT, -- who logged it (admin name, or the input bot)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coach_notes_user ON coach_notes(user_id);

CREATE TABLE IF NOT EXISTS follow_ups (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | DONE | CANCELLED
  priority TEXT NOT NULL DEFAULT 'MEDIUM', -- LOW | MEDIUM | HIGH
  reason TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_follow_ups_user ON follow_ups(user_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups(due_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);

-- Sales calls: the old "10-call script" is retired, so `contact_calls` becomes
-- a freeform, unlimited call log instead of a new separate table (DRY — reuse
-- what's there). Existing rows (call_number 1-10) are untouched; new rows can
-- leave call_number null.
ALTER TABLE contact_calls DROP CONSTRAINT IF EXISTS contact_calls_call_number_check;
ALTER TABLE contact_calls DROP CONSTRAINT IF EXISTS contact_calls_user_id_call_number_key;
ALTER TABLE contact_calls ALTER COLUMN call_number DROP NOT NULL;
ALTER TABLE contact_calls ADD COLUMN IF NOT EXISTS current_situation TEXT;
ALTER TABLE contact_calls ADD COLUMN IF NOT EXISTS next_step TEXT;
ALTER TABLE contact_calls ADD COLUMN IF NOT EXISTS offer_discussed TEXT;
ALTER TABLE contact_calls ADD COLUMN IF NOT EXISTS likelihood SMALLINT;
ALTER TABLE contact_calls ADD COLUMN IF NOT EXISTS follow_up_date DATE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_calls_likelihood_check') THEN
    ALTER TABLE contact_calls ADD CONSTRAINT contact_calls_likelihood_check CHECK (likelihood IS NULL OR (likelihood BETWEEN 1 AND 10));
  END IF;
END $$;
-- Column meanings for the freeform flow: notes = call summary, plans_discussed = the plan,
-- objections unchanged. called_at is the call date/time (was already there).

-- ── 5. Member roadmap — one row per member: where they are, what's next ─────

CREATE TABLE IF NOT EXISTS member_roadmap (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT, -- LEAD | ONBOARDING | ACTIVE | AT_RISK | UPSELL | WON | CHURNED
  main_goal TEXT,
  current_blocker TEXT,
  next_action TEXT,
  assigned_to TEXT,
  due_date DATE,
  progress_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. Opportunity Engine output — one row per member, the rules engine writes here ──

CREATE TABLE IF NOT EXISTS opportunity_scores (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  score INT NOT NULL DEFAULT 0,
  category TEXT, -- SALES | SUCCESS | COMMUNITY | TESTIMONIAL | RISK
  reason TEXT,
  recommended_action TEXT,
  done_at TIMESTAMPTZ, -- set when an admin ticks the card off; cleared when the opportunity changes
  last_calculated TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_opportunity_scores_category_score ON opportunity_scores(category, score);
CREATE INDEX IF NOT EXISTS idx_opportunity_scores_last_calculated ON opportunity_scores(last_calculated);

-- ── 7. Member timeline — append-only event log (new; neither codebase had this) ──
-- Populated by app code whenever something timeline-worthy happens: joined,
-- a win, a coach call, a purchase/import, a follow-up, a roadmap change,
-- course progress, a bot-captured note, etc.

CREATE TABLE IF NOT EXISTS member_events (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- JOINED | WIN | COACH_CALL | SALES_CALL | FOLLOW_UP | ROADMAP_CHANGE | PURCHASE | COURSE_PROGRESS | IMPORT | BOT_NOTE | OTHER
  title TEXT NOT NULL,
  description TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT, -- e.g. "import", "telegram_bot", "admin:camilo"
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_member_events_user_time ON member_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_events_type ON member_events(event_type);

-- ── 8. Welcome questionnaire answers, structured ────────────────────────────

CREATE TABLE IF NOT EXISTS questionnaire_responses (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  age_range TEXT,
  location TEXT,
  goals TEXT,
  business TEXT,
  why_joined TEXT,
  raw_answers JSONB DEFAULT '{}'::jsonb, -- full Q&A payload, in case the form has more fields than the columns above
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 9. Teachable course-progress sync (matched to a member by email) ────────

CREATE TABLE IF NOT EXISTS course_progress (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  teachable_user_id TEXT,
  percent_complete NUMERIC(5, 2),
  lessons_completed INT,
  lessons_total INT,
  last_synced_at TIMESTAMPTZ,
  raw JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Note: `users` has no `email` column today. Teachable sync and the email-list
-- import both match members by email, so add it (nullable, not unique — a
-- member may share an email with a household account, and telegram-only
-- members have none):
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

-- ============================================================
-- Verify after running:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'users' ORDER BY ordinal_position;
-- ============================================================
