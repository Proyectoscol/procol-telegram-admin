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
