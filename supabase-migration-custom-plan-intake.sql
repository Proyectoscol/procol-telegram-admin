-- ============================================================
-- Migration: Custom Plan Intake Form import (NM Custom Plan Intake Form).
--
-- Run this in Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Every statement is idempotent (safe to run more than once, safe on a
-- database that already has data in it — nothing here drops or rewrites
-- existing columns).
--
-- This form's ~35 fields (income, revenue, niche, platforms, funnel status,
-- skill scores 1-10, etc.) don't match the existing `questionnaire_responses`
-- table's fixed columns (age_range/location/goals/business/why_joined), so
-- it gets its own table, following the same raw_answers-JSONB-catch-all +
-- promoted-columns pattern.
-- ============================================================

-- ── 1. New table: one row per member's Custom Plan Intake submission ───────

CREATE TABLE IF NOT EXISTS custom_plan_intake_responses (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  primary_income_source TEXT,
  monthly_profit_usd NUMERIC(12, 2),
  monthly_revenue_usd NUMERIC(12, 2),
  profit_goal_6mo_usd NUMERIC(12, 2),
  niche TEXT,
  biggest_problem TEXT,
  has_sales_funnel BOOLEAN,
  ran_paid_ads BOOLEAN,
  team_structure TEXT,          -- 'ALONE' | 'CONTRACTORS' | 'EMPLOYEES'
  seriousness_level SMALLINT,   -- 1-10
  current_stage TEXT,           -- 'NO_AUDIENCE' | 'AUDIENCE_NO_MONETIZATION' | 'LOW_SCALE' | 'SCALING_BOTTLENECK'
  skill_scores JSONB DEFAULT '{}'::jsonb,  -- {content_creation, copywriting, sales, offer_creation, audience_growth, branding, marketing, systems_automation} each 1-10
  raw_answers JSONB NOT NULL DEFAULT '{}'::jsonb,  -- every Q&A pair, verbatim question text as key
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_plan_intake_user ON custom_plan_intake_responses(user_id);

-- ── 2. import_batches / import_reviews: document the new kind/import_type ──
-- Both columns are already free-form TEXT (no enum/constraint to alter) —
-- 'CUSTOM_PLAN_INTAKE' is simply a new value the app now writes.
-- import_batches.kind: ... | QUESTIONNAIRE | TEACHABLE | CUSTOM_PLAN_INTAKE
-- import_reviews.import_type: ... | QUESTIONNAIRE | TEACHABLE | CUSTOM_PLAN_INTAKE
-- import_reviews.reason also gains a new possible value alongside the
-- existing DUPLICATE_NAME | UNMATCHED | MISSING_IDENTIFIER:
--   AMBIGUOUS_FUZZY_MATCH — more than one existing member's Telegram
--   username scored above the fuzzy-match confidence threshold.

-- ============================================================
-- Verify after running:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'custom_plan_intake_responses' ORDER BY ordinal_position;
-- ============================================================
