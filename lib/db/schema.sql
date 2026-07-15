-- Telegram Dashboard Schema (Main Chat)
-- Run on first deploy / startup to create tables if not exist.

CREATE TABLE IF NOT EXISTS chats (
  id BIGINT PRIMARY KEY,
  name TEXT,
  type TEXT,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  from_id TEXT UNIQUE,
  display_name TEXT,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  is_premium BOOLEAN DEFAULT FALSE,
  telegram_premium BOOLEAN DEFAULT FALSE,
  telegram_verified BOOLEAN DEFAULT FALSE,
  telegram_fake BOOLEAN DEFAULT FALSE,
  telegram_bot BOOLEAN DEFAULT FALSE,
  telegram_status_type TEXT,
  telegram_bio TEXT,
  telegram_last_seen TIMESTAMPTZ,
  assigned_to TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migrations for existing DBs: add username, allow from_id NULL, unique on username
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'username') THEN
    ALTER TABLE users ADD COLUMN username TEXT;
  END IF;
END $$;
ALTER TABLE users ALTER COLUMN from_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;

-- Migrations: add Telegram/profile columns to users if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'first_name') THEN
    ALTER TABLE users ADD COLUMN first_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'last_name') THEN
    ALTER TABLE users ADD COLUMN last_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'phone') THEN
    ALTER TABLE users ADD COLUMN phone TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'telegram_premium') THEN
    ALTER TABLE users ADD COLUMN telegram_premium BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'telegram_verified') THEN
    ALTER TABLE users ADD COLUMN telegram_verified BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'telegram_fake') THEN
    ALTER TABLE users ADD COLUMN telegram_fake BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'telegram_bot') THEN
    ALTER TABLE users ADD COLUMN telegram_bot BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'telegram_status_type') THEN
    ALTER TABLE users ADD COLUMN telegram_status_type TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'telegram_bio') THEN
    ALTER TABLE users ADD COLUMN telegram_bio TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'telegram_last_seen') THEN
    ALTER TABLE users ADD COLUMN telegram_last_seen TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_current_member') THEN
    ALTER TABLE users ADD COLUMN is_current_member BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'member_since') THEN
    ALTER TABLE users ADD COLUMN member_since TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'profile_photo_urls') THEN
    ALTER TABLE users ADD COLUMN profile_photo_urls JSONB DEFAULT '[]';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'premium_since') THEN
    ALTER TABLE users ADD COLUMN premium_since TIMESTAMPTZ;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_users_current_member ON users(is_current_member) WHERE is_current_member = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_is_premium ON users(is_premium) WHERE is_premium = TRUE;

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL REFERENCES chats(id),
  message_id BIGINT NOT NULL,
  type TEXT,
  date TIMESTAMPTZ,
  from_id TEXT REFERENCES users(from_id),
  actor_id TEXT REFERENCES users(from_id),
  text TEXT,
  reply_to_message_id BIGINT,
  edited_at TIMESTAMPTZ,
  media_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS reactions (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL REFERENCES chats(id),
  message_id BIGINT NOT NULL,
  reactor_from_id TEXT NOT NULL REFERENCES users(from_id),
  emoji TEXT,
  reacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, message_id, reactor_from_id)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL REFERENCES chats(id),
  filename TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  messages_inserted INT DEFAULT 0,
  messages_skipped INT DEFAULT 0,
  reactions_inserted INT DEFAULT 0,
  reactions_skipped INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contact_calls (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  call_number SMALLINT NOT NULL CHECK (call_number >= 1 AND call_number <= 10),
  called_at TIMESTAMPTZ,
  notes TEXT,
  objections TEXT,
  plans_discussed TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, call_number)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_date ON messages(chat_id, date);
CREATE INDEX IF NOT EXISTS idx_messages_from_id ON messages(from_id);
CREATE INDEX IF NOT EXISTS idx_messages_from_id_date ON messages(from_id, date) WHERE from_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_actor_id_date ON messages(actor_id, date) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reactions_chat_message ON reactions(chat_id, message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_reactor ON reactions(reactor_from_id, reacted_at);
CREATE INDEX IF NOT EXISTS idx_contact_calls_user ON contact_calls(user_id);

-- Composite indexes for KPI queries in /full and stats routes.
-- (from_id, type) covers COUNT(*) queries filtering by both columns.
CREATE INDEX IF NOT EXISTS idx_messages_from_type ON messages(from_id, type) WHERE from_id IS NOT NULL;
-- (from_id, type, chat_id) covers chat-filtered KPI sub-queries.
CREATE INDEX IF NOT EXISTS idx_messages_from_type_chat ON messages(from_id, type, chat_id) WHERE from_id IS NOT NULL;
-- (from_id, media_type) covers photo/video/audio counts.
CREATE INDEX IF NOT EXISTS idx_messages_from_media ON messages(from_id, media_type) WHERE from_id IS NOT NULL AND media_type IS NOT NULL;
-- (chat_id, date) already exists; add (from_id, chat_id, date) for per-user time-series filtered by chat.
CREATE INDEX IF NOT EXISTS idx_messages_from_chat_date ON messages(from_id, chat_id, date) WHERE from_id IS NOT NULL;
-- Covering index on reactions for reactor+chat lookups (reactions-given list).
CREATE INDEX IF NOT EXISTS idx_reactions_reactor_chat ON reactions(reactor_from_id, chat_id);
-- (chat_id, message_id, reactor_from_id) speeds up JOIN on reactions used in received-count sub-queries.
CREATE INDEX IF NOT EXISTS idx_reactions_chat_msg_reactor ON reactions(chat_id, message_id, reactor_from_id);
-- overview: type + date (for total message count by period without from_id filter).
CREATE INDEX IF NOT EXISTS idx_messages_type_date ON messages(type, date);
-- overview: chat_id + type + date (for chat-filtered totals).
CREATE INDEX IF NOT EXISTS idx_messages_chat_type_date ON messages(chat_id, type, date);
-- actor_id composite for service message counts.
CREATE INDEX IF NOT EXISTS idx_messages_actor_chat ON messages(actor_id, chat_id) WHERE actor_id IS NOT NULL;

-- Settings (key-value); values stored encoded. Key: openai_api_key, etc.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI-generated buyer persona per contact (one row per user; overwritten on each run).
CREATE TABLE IF NOT EXISTS contact_personas (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary TEXT,
  topics JSONB,
  inferred_age_range TEXT,
  inferred_occupation TEXT,
  inferred_goals JSONB,
  social_links JSONB,
  content_preferences TEXT,
  pain_points JSONB,
  inference_evidence TEXT,
  model_used TEXT,
  prompt_tokens INT,
  completion_tokens INT,
  run_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_personas_user ON contact_personas(user_id);
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS inference_evidence TEXT;
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS generated_for_range TEXT;

-- AI usage audit and cost tracking.
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INT,
  model TEXT NOT NULL,
  prompt_tokens INT NOT NULL,
  completion_tokens INT NOT NULL,
  total_tokens INT NOT NULL,
  cost_estimate NUMERIC(12, 6),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_entity ON ai_usage_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created ON ai_usage_logs(created_at DESC);

-- Day insight: AI analysis for "why was there activity this day?" (all contacts) or "why did this contact have activity this day?" (single contact).
-- Key: period_start (date), chat_ids_canonical (sorted comma-separated), scope ('all'|'contact'), from_id ('' when scope='all').
CREATE TABLE IF NOT EXISTS day_insights (
  id SERIAL PRIMARY KEY,
  period_start DATE NOT NULL,
  chat_ids_canonical TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('all', 'contact')),
  from_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  model_used TEXT,
  prompt_tokens INT,
  completion_tokens INT,
  run_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(period_start, chat_ids_canonical, scope, from_id)
);
CREATE INDEX IF NOT EXISTS idx_day_insights_lookup ON day_insights(period_start, chat_ids_canonical, scope, from_id);

-- Relationship insight: AI summary of interactions between two members (reactions, replies). One row per (user, other_user); overwritten on each run.
CREATE TABLE IF NOT EXISTS relationship_insights (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  other_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary TEXT,
  tone TEXT,
  mutual_or_one_sided TEXT,
  evolution TEXT,
  inference_evidence TEXT,
  model_used TEXT,
  prompt_tokens INT,
  completion_tokens INT,
  run_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, other_user_id)
);
CREATE INDEX IF NOT EXISTS idx_relationship_insights_user ON relationship_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_relationship_insights_other ON relationship_insights(other_user_id);
ALTER TABLE relationship_insights ADD COLUMN IF NOT EXISTS generated_for_range TEXT;

-- Sales intelligence fields for contact_personas
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS buying_intent_score SMALLINT DEFAULT 0;
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS buying_signals JSONB DEFAULT '[]';
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS follow_up_priority TEXT;
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS engagement_level TEXT;
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS outreach_approach TEXT;
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS objection_patterns JSONB DEFAULT '[]';
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS spending_capacity TEXT;

-- ============================================================
-- CRM v2: Opportunity Engine, member timeline, roadmap, sales/coaching
-- layer, review queue, questionnaire + Teachable course sync.
-- See supabase-migration-crm-v2.sql for the standalone runnable version
-- (same statements) and the merge plan for why each table exists.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'COLD';
ALTER TABLE users ADD COLUMN IF NOT EXISTS offer_type TEXT DEFAULT 'UNKNOWN';
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'UNKNOWN';
ALTER TABLE users ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12, 2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_override TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_offer_type ON users(offer_type);
CREATE INDEX IF NOT EXISTS idx_users_left_at ON users(left_at) WHERE left_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'TELEGRAM';
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS members_created INT DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS members_updated INT DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS tagged INT DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS unmatched INT DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS skipped INT DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS error_count INT DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS total_rows INT DEFAULT 0;
ALTER TABLE import_batches ALTER COLUMN chat_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS import_reviews (
  id SERIAL PRIMARY KEY,
  batch_id INT REFERENCES import_batches(id) ON DELETE SET NULL,
  import_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  raw_row JSONB NOT NULL,
  suggested_name TEXT,
  suggested_username TEXT,
  suggested_telegram_id TEXT,
  suggested_email TEXT,
  candidate_ids JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING',
  resolved_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_import_reviews_status ON import_reviews(status);
CREATE INDEX IF NOT EXISTS idx_import_reviews_type ON import_reviews(import_type);

CREATE TABLE IF NOT EXISTS wins (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2),
  description TEXT,
  occurred_at TIMESTAMPTZ,
  source TEXT,
  confidence TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wins_user ON wins(user_id);

CREATE TABLE IF NOT EXISTS coach_notes (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_type TEXT,
  summary TEXT,
  next_action TEXT,
  follow_up_date DATE,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coach_notes_user ON coach_notes(user_id);

CREATE TABLE IF NOT EXISTS follow_ups (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'OPEN',
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  reason TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_follow_ups_user ON follow_ups(user_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups(due_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);

-- Sales calls: the old "10-call script" is retired — contact_calls becomes a
-- freeform, unlimited call log instead of a separate table.
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

CREATE TABLE IF NOT EXISTS member_roadmap (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT,
  main_goal TEXT,
  current_blocker TEXT,
  next_action TEXT,
  assigned_to TEXT,
  due_date DATE,
  progress_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opportunity_scores (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  score INT NOT NULL DEFAULT 0,
  category TEXT,
  reason TEXT,
  recommended_action TEXT,
  done_at TIMESTAMPTZ,
  last_calculated TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_opportunity_scores_category_score ON opportunity_scores(category, score);
CREATE INDEX IF NOT EXISTS idx_opportunity_scores_last_calculated ON opportunity_scores(last_calculated);

CREATE TABLE IF NOT EXISTS member_events (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_member_events_user_time ON member_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_events_type ON member_events(event_type);

CREATE TABLE IF NOT EXISTS questionnaire_responses (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  age_range TEXT,
  location TEXT,
  goals TEXT,
  business TEXT,
  why_joined TEXT,
  raw_answers JSONB DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
