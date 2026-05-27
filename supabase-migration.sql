-- ============================================================
-- Migration: Sales intelligence fields for contact_personas
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- These are all idempotent (safe to run multiple times)
-- ============================================================

-- 1. buying_intent_score: 0-10 integer (0 = no signal, 10 = actively asking to buy)
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS buying_intent_score SMALLINT DEFAULT 0;

-- 2. buying_signals: array of specific phrases/behaviors showing purchase intent
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS buying_signals JSONB DEFAULT '[]';

-- 3. follow_up_priority: 'hot' | 'warm' | 'cold' | 'nurture'
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS follow_up_priority TEXT;

-- 4. engagement_level: 'champion' | 'active' | 'passive' | 'lurker'
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS engagement_level TEXT;

-- 5. outreach_approach: personalized 1-2 sentence sales approach for this person
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS outreach_approach TEXT;

-- 6. objection_patterns: array of likely sales objections inferred from messages
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS objection_patterns JSONB DEFAULT '[]';

-- 7. spending_capacity: 'high' | 'medium' | 'low' | 'unknown'
ALTER TABLE contact_personas ADD COLUMN IF NOT EXISTS spending_capacity TEXT;

-- Verify: check which columns exist on contact_personas
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'contact_personas' ORDER BY ordinal_position;
