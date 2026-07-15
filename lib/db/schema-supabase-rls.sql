-- Supabase RLS: enable Row Level Security and allow authenticated users full access.
-- API uses pooler connection (elevated) and bypasses RLS; these policies apply when
-- using Supabase client in the browser with user JWT.
-- Idempotent: DROP IF EXISTS before CREATE so re-runs do not fail.

ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_chats" ON chats;
CREATE POLICY "allow_authenticated_chats" ON chats FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_users" ON users;
CREATE POLICY "allow_authenticated_users" ON users FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_messages" ON messages;
CREATE POLICY "allow_authenticated_messages" ON messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_reactions" ON reactions;
CREATE POLICY "allow_authenticated_reactions" ON reactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_import_batches" ON import_batches;
CREATE POLICY "allow_authenticated_import_batches" ON import_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE contact_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_contact_calls" ON contact_calls;
CREATE POLICY "allow_authenticated_contact_calls" ON contact_calls FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_settings" ON settings;
CREATE POLICY "allow_authenticated_settings" ON settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE contact_personas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_contact_personas" ON contact_personas;
CREATE POLICY "allow_authenticated_contact_personas" ON contact_personas FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_ai_usage_logs" ON ai_usage_logs;
CREATE POLICY "allow_authenticated_ai_usage_logs" ON ai_usage_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE day_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_day_insights" ON day_insights;
CREATE POLICY "allow_authenticated_day_insights" ON day_insights FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE relationship_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_relationship_insights" ON relationship_insights;
CREATE POLICY "allow_authenticated_relationship_insights" ON relationship_insights FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- CRM v2 tables
ALTER TABLE import_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_import_reviews" ON import_reviews;
CREATE POLICY "allow_authenticated_import_reviews" ON import_reviews FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE wins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_wins" ON wins;
CREATE POLICY "allow_authenticated_wins" ON wins FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE coach_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_coach_notes" ON coach_notes;
CREATE POLICY "allow_authenticated_coach_notes" ON coach_notes FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_follow_ups" ON follow_ups;
CREATE POLICY "allow_authenticated_follow_ups" ON follow_ups FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE member_roadmap ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_member_roadmap" ON member_roadmap;
CREATE POLICY "allow_authenticated_member_roadmap" ON member_roadmap FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE opportunity_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_opportunity_scores" ON opportunity_scores;
CREATE POLICY "allow_authenticated_opportunity_scores" ON opportunity_scores FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE member_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_member_events" ON member_events;
CREATE POLICY "allow_authenticated_member_events" ON member_events FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE questionnaire_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_questionnaire_responses" ON questionnaire_responses;
CREATE POLICY "allow_authenticated_questionnaire_responses" ON questionnaire_responses FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE course_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_authenticated_course_progress" ON course_progress;
CREATE POLICY "allow_authenticated_course_progress" ON course_progress FOR ALL TO authenticated USING (true) WITH CHECK (true);
