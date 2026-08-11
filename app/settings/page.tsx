'use client';

import { useEffect, useState } from 'react';
import { ChatSelector } from '@/components/ChatSelector';
import { LoadingCard } from '@/components/Loading';
import { LogoutButton } from '@/components/LogoutButton';

export default function SettingsPage() {
  const [openaiConfigured, setOpenaiConfigured] = useState<boolean | null>(null);
  const [openaiKey, setOpenaiKey] = useState('');
  const [showReplaceInput, setShowReplaceInput] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [personaDaysBack, setPersonaDaysBack] = useState<string>('unlimited');
  const [personaMaxMessages, setPersonaMaxMessages] = useState<string>('80');
  const [personaMaxReactions, setPersonaMaxReactions] = useState<string>('50');
  const [personaIncludeBio, setPersonaIncludeBio] = useState(true);
  const [personaOpenAIModel, setPersonaOpenAIModel] = useState<string>('gpt-4o-mini-2024-07-18');
  const [personaModelOptions, setPersonaModelOptions] = useState<{ id: string; label: string; inputPerM: number; outputPerM: number }[]>([]);
  const [personaSystemPrompt, setPersonaSystemPrompt] = useState<string>('');
  const [personaUserPromptTemplate, setPersonaUserPromptTemplate] = useState<string>('');
  const [personaMaxTextLen, setPersonaMaxTextLen] = useState<number>(500);
  const [personaChatIds, setPersonaChatIds] = useState<number[]>([]);
  const [personaSchemaDescriptions, setPersonaSchemaDescriptions] = useState<string>('');
  const [uiListLimitAiUsage, setUiListLimitAiUsage] = useState<number>(50);
  const [uiListLimitMessagesPage, setUiListLimitMessagesPage] = useState<number>(20);
  const [uiListLimitPeriodDetail, setUiListLimitPeriodDetail] = useState<number>(20);
  const [uiPersonaLabels, setUiPersonaLabels] = useState<string>('');
  const [cacheTtlStatsMinutes, setCacheTtlStatsMinutes] = useState<number>(2);
  const [chats, setChats] = useState<{ id: number; name: string; slug: string }[]>([]);
  const [personaSaving, setPersonaSaving] = useState(false);
  const [personaMessage, setPersonaMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [promptsSaving, setPromptsSaving] = useState(false);
  const [promptsMessage, setPromptsMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [dayInsightSystemPrompt, setDayInsightSystemPrompt] = useState<string>('');
  const [dayInsightUserPromptTemplate, setDayInsightUserPromptTemplate] = useState<string>('');
  const [dayInsightPromptsSaving, setDayInsightPromptsSaving] = useState(false);
  const [dayInsightPromptsMessage, setDayInsightPromptsMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [miscSaving, setMiscSaving] = useState(false);
  const [schemaLabelsMessage, setSchemaLabelsMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [listLimitsMessage, setListLimitsMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [aiUsageLogs, setAiUsageLogs] = useState<{ id: number; entity_type: string; entity_id: number | null; model: string; prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_estimate: number | null; created_at: string; model_pricing_tooltip?: string }[]>([]);
  const [aiUsageTotal, setAiUsageTotal] = useState<number>(0);
  const [aiUsageSummary, setAiUsageSummary] = useState<{ total_runs: number; total_prompt_tokens: number; total_completion_tokens: number; total_tokens: number; total_cost_usd: number } | null>(null);

  // Telegram scraper (GramJS login + Main/Premium group role assignment)
  type ScraperGroup = {
    id: number;
    telegramGroupId: string;
    title: string;
    role: 'main' | 'premium' | null;
    memberCount: number | null;
    lastScrapedAt: string | null;
    lastScrapeAdded: number | null;
    lastScrapeUpdated: number | null;
    lastScrapeError: string | null;
  };
  const [scraperLoading, setScraperLoading] = useState(true);
  const [scraperAccount, setScraperAccount] = useState<{
    configured: boolean;
    status: 'disconnected' | 'pending_code' | 'pending_password' | 'connected' | 'error';
    phoneNumberDisplay: string | null;
    lastConnectedAt: string | null;
    lastError: string | null;
  } | null>(null);
  const [scraperGroups, setScraperGroups] = useState<ScraperGroup[]>([]);
  const [scraperApiId, setScraperApiId] = useState('');
  const [scraperApiHash, setScraperApiHash] = useState('');
  const [scraperPhone, setScraperPhone] = useState('');
  const [scraperCode, setScraperCode] = useState('');
  const [scraperPassword, setScraperPassword] = useState('');
  const [scraperBusy, setScraperBusy] = useState(false);
  const [scraperDiscovering, setScraperDiscovering] = useState(false);
  const [scraperMessage, setScraperMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const fetchScraperStatus = async () => {
    try {
      const res = await fetch('/api/telegram-scraper/status');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load status');
      setScraperAccount(data.account);
      setScraperGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch (err) {
      setScraperMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load status' });
    } finally {
      setScraperLoading(false);
    }
  };

  useEffect(() => {
    fetchScraperStatus();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/bootstrap/settings', { signal: ctrl.signal })
      .then((r) => r.json())
      .then((payload) => {
        if (payload.error) {
          setOpenaiConfigured(false);
          return;
        }
        const data = payload.settings ?? payload;
        setOpenaiConfigured(!!data.openai_api_key_configured);
        setPersonaDaysBack(data.persona_days_back ?? 'unlimited');
        setPersonaMaxMessages(String(data.persona_max_messages ?? '80'));
        setPersonaMaxReactions(String(data.persona_max_reactions ?? '50'));
        setPersonaIncludeBio(data.persona_include_bio !== false);
        setPersonaOpenAIModel(data.persona_openai_model ?? 'gpt-4o-mini-2024-07-18');
        setPersonaModelOptions(Array.isArray(data.persona_model_options) ? data.persona_model_options : []);
        setPersonaSystemPrompt(typeof data.persona_system_prompt === 'string' ? data.persona_system_prompt : '');
        setPersonaUserPromptTemplate(typeof data.persona_user_prompt_template === 'string' ? data.persona_user_prompt_template : '');
        setPersonaMaxTextLen(typeof data.persona_max_text_len === 'number' ? data.persona_max_text_len : parseInt(String(data.persona_max_text_len), 10) || 500);
        setPersonaChatIds(Array.isArray(data.persona_chat_ids) ? data.persona_chat_ids.map((c: unknown) => Number(c)).filter((n: number) => !Number.isNaN(n) && n > 0) : []);
        setPersonaSchemaDescriptions(typeof data.persona_schema_descriptions === 'string' ? data.persona_schema_descriptions : '');
        setUiListLimitAiUsage(typeof data.ui_list_limit_ai_usage === 'number' ? data.ui_list_limit_ai_usage : parseInt(String(data.ui_list_limit_ai_usage), 10) || 50);
        setUiListLimitMessagesPage(typeof data.ui_list_limit_messages_page === 'number' ? data.ui_list_limit_messages_page : parseInt(String(data.ui_list_limit_messages_page), 10) || 20);
        setUiListLimitPeriodDetail(typeof data.ui_list_limit_period_detail === 'number' ? data.ui_list_limit_period_detail : parseInt(String(data.ui_list_limit_period_detail), 10) || 20);
        setUiPersonaLabels(typeof data.ui_persona_labels === 'string' ? data.ui_persona_labels : '');
        setCacheTtlStatsMinutes(typeof data.cache_ttl_stats_minutes === 'number' ? data.cache_ttl_stats_minutes : parseInt(String(data.cache_ttl_stats_minutes), 10) || 2);
        setDayInsightSystemPrompt(typeof data.day_insight_system_prompt === 'string' ? data.day_insight_system_prompt : '');
        setDayInsightUserPromptTemplate(typeof data.day_insight_user_prompt_template === 'string' ? data.day_insight_user_prompt_template : '');
        if (Array.isArray(payload.chats)) setChats(payload.chats);
        if (payload.aiUsage != null) {
          setAiUsageLogs(payload.aiUsage.logs ?? []);
          setAiUsageTotal(payload.aiUsage.total ?? 0);
          setAiUsageSummary(payload.aiUsage.summary ?? null);
        }
      })
      .catch(() => setOpenaiConfigured(false))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  const handleSaveOpenAi = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const key = openaiKey.trim();
    if (!key) {
      setMessage({ type: 'error', text: 'Enter an API key to save.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openai_api_key: key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setOpenaiConfigured(true);
      setOpenaiKey('');
      setShowReplaceInput(false);
      setMessage({ type: 'ok', text: 'OpenAI API key saved. It is stored encoded in the database.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveOpenAi = async () => {
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openai_api_key: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove');
      setOpenaiConfigured(false);
      setOpenaiKey('');
      setShowReplaceInput(false);
      setMessage({ type: 'ok', text: 'OpenAI API key removed.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove' });
    } finally {
      setSaving(false);
    }
  };

  const handleSavePersonaSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setPersonaMessage(null);
    setPersonaSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona_days_back: personaDaysBack,
          persona_max_messages: personaMaxMessages,
          persona_max_reactions: personaMaxReactions,
          persona_include_bio: personaIncludeBio,
          persona_openai_model: personaOpenAIModel,
          persona_max_text_len: personaMaxTextLen,
          persona_chat_ids: personaChatIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setPersonaDaysBack(data.persona_days_back ?? 'unlimited');
      setPersonaMaxMessages(String(data.persona_max_messages ?? '80'));
      setPersonaMaxReactions(String(data.persona_max_reactions ?? '50'));
      setPersonaIncludeBio(data.persona_include_bio !== false);
      setPersonaOpenAIModel(data.persona_openai_model ?? 'gpt-4o-mini-2024-07-18');
      setPersonaMaxTextLen(typeof data.persona_max_text_len === 'number' ? data.persona_max_text_len : parseInt(String(data.persona_max_text_len), 10) || 500);
      setPersonaChatIds(Array.isArray(data.persona_chat_ids) ? data.persona_chat_ids : []);
      setPersonaMessage({ type: 'ok', text: 'Persona context settings saved. They apply to the next persona generation.' });
    } catch (err) {
      setPersonaMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setPersonaSaving(false);
    }
  };

  const handleSavePersonaPrompts = async (e: React.FormEvent) => {
    e.preventDefault();
    setPromptsMessage(null);
    setPromptsSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona_system_prompt: personaSystemPrompt,
          persona_user_prompt_template: personaUserPromptTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setPersonaSystemPrompt(typeof data.persona_system_prompt === 'string' ? data.persona_system_prompt : personaSystemPrompt);
      setPersonaUserPromptTemplate(typeof data.persona_user_prompt_template === 'string' ? data.persona_user_prompt_template : personaUserPromptTemplate);
      setPromptsMessage({ type: 'ok', text: 'Prompts saved. They will be used for the next persona generation.' });
    } catch (err) {
      setPromptsMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setPromptsSaving(false);
    }
  };

  const handleSaveDayInsightPrompts = async (e: React.FormEvent) => {
    e.preventDefault();
    setDayInsightPromptsMessage(null);
    setDayInsightPromptsSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day_insight_system_prompt: dayInsightSystemPrompt,
          day_insight_user_prompt_template: dayInsightUserPromptTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setDayInsightSystemPrompt(typeof data.day_insight_system_prompt === 'string' ? data.day_insight_system_prompt : dayInsightSystemPrompt);
      setDayInsightUserPromptTemplate(typeof data.day_insight_user_prompt_template === 'string' ? data.day_insight_user_prompt_template : dayInsightUserPromptTemplate);
      setDayInsightPromptsMessage({ type: 'ok', text: 'Day insight prompts saved. Used when generating "why this day?" analysis.' });
    } catch (err) {
      setDayInsightPromptsMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setDayInsightPromptsSaving(false);
    }
  };

  const handleSaveSchemaAndLabels = async (e: React.FormEvent) => {
    e.preventDefault();
    setSchemaLabelsMessage(null);
    setMiscSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona_schema_descriptions: personaSchemaDescriptions,
          ui_persona_labels: uiPersonaLabels,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setPersonaSchemaDescriptions(typeof data.persona_schema_descriptions === 'string' ? data.persona_schema_descriptions : personaSchemaDescriptions);
      setUiPersonaLabels(typeof data.ui_persona_labels === 'string' ? data.ui_persona_labels : uiPersonaLabels);
      setSchemaLabelsMessage({ type: 'ok', text: 'Schema descriptions and persona labels saved.' });
    } catch (err) {
      setSchemaLabelsMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setMiscSaving(false);
    }
  };

  const handleSaveListLimitsAndMisc = async (e: React.FormEvent) => {
    e.preventDefault();
    setListLimitsMessage(null);
    setMiscSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ui_list_limit_ai_usage: uiListLimitAiUsage,
          ui_list_limit_messages_page: uiListLimitMessagesPage,
          ui_list_limit_period_detail: uiListLimitPeriodDetail,
          cache_ttl_stats_minutes: cacheTtlStatsMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setUiListLimitAiUsage(typeof data.ui_list_limit_ai_usage === 'number' ? data.ui_list_limit_ai_usage : parseInt(String(data.ui_list_limit_ai_usage), 10) || 50);
      setUiListLimitMessagesPage(typeof data.ui_list_limit_messages_page === 'number' ? data.ui_list_limit_messages_page : parseInt(String(data.ui_list_limit_messages_page), 10) || 20);
      setUiListLimitPeriodDetail(typeof data.ui_list_limit_period_detail === 'number' ? data.ui_list_limit_period_detail : parseInt(String(data.ui_list_limit_period_detail), 10) || 20);
      setCacheTtlStatsMinutes(typeof data.cache_ttl_stats_minutes === 'number' ? data.cache_ttl_stats_minutes : parseInt(String(data.cache_ttl_stats_minutes), 10) || 2);
      setListLimitsMessage({ type: 'ok', text: 'List limits and cache saved.' });
    } catch (err) {
      setListLimitsMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setMiscSaving(false);
    }
  };

  const handleScraperConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setScraperMessage(null);
    setScraperBusy(true);
    try {
      const res = await fetch('/api/telegram-scraper/login/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId: scraperApiId.trim(), apiHash: scraperApiHash.trim(), phoneNumber: scraperPhone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start login');
      if (data.status === 'error') {
        setScraperMessage({ type: 'error', text: data.error || 'Login failed' });
      } else if (data.status === 'connected') {
        setScraperMessage({ type: 'ok', text: 'Connected to Telegram.' });
        setScraperApiId('');
        setScraperApiHash('');
        setScraperPhone('');
      }
      await fetchScraperStatus();
    } catch (err) {
      setScraperMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to start login' });
    } finally {
      setScraperBusy(false);
    }
  };

  const handleScraperSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setScraperMessage(null);
    setScraperBusy(true);
    try {
      const res = await fetch('/api/telegram-scraper/login/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: scraperCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit code');
      if (data.status === 'error') {
        setScraperMessage({ type: 'error', text: data.error || 'Invalid code, try again.' });
      } else if (data.status === 'connected') {
        setScraperMessage({ type: 'ok', text: 'Connected to Telegram.' });
        setScraperCode('');
      } else if (data.status === 'pending_password') {
        setScraperCode('');
      }
      await fetchScraperStatus();
    } catch (err) {
      setScraperMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to submit code' });
    } finally {
      setScraperBusy(false);
    }
  };

  const handleScraperSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setScraperMessage(null);
    setScraperBusy(true);
    try {
      const res = await fetch('/api/telegram-scraper/login/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: scraperPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit password');
      if (data.status === 'error') {
        setScraperMessage({ type: 'error', text: data.error || 'Wrong password, try again.' });
      } else if (data.status === 'connected') {
        setScraperMessage({ type: 'ok', text: 'Connected to Telegram.' });
        setScraperPassword('');
      }
      await fetchScraperStatus();
    } catch (err) {
      setScraperMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to submit password' });
    } finally {
      setScraperBusy(false);
    }
  };

  const handleScraperCancel = async () => {
    setScraperMessage(null);
    setScraperBusy(true);
    try {
      await fetch('/api/telegram-scraper/login/cancel', { method: 'POST' });
      setScraperCode('');
      setScraperPassword('');
      await fetchScraperStatus();
    } finally {
      setScraperBusy(false);
    }
  };

  const handleScraperDisconnect = async () => {
    setScraperMessage(null);
    setScraperBusy(true);
    try {
      const res = await fetch('/api/telegram-scraper/account', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to disconnect');
      setScraperMessage({ type: 'ok', text: 'Disconnected. Your credentials and session were deleted.' });
      await fetchScraperStatus();
    } catch (err) {
      setScraperMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to disconnect' });
    } finally {
      setScraperBusy(false);
    }
  };

  const handleScraperDiscover = async () => {
    setScraperMessage(null);
    setScraperDiscovering(true);
    try {
      const res = await fetch('/api/telegram-scraper/groups/discover', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to discover groups');
      setScraperGroups(Array.isArray(data.groups) ? data.groups : []);
      setScraperMessage({ type: 'ok', text: `Found ${data.groups?.length ?? 0} group(s). Assign Main and Premium below.` });
    } catch (err) {
      setScraperMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to discover groups' });
    } finally {
      setScraperDiscovering(false);
    }
  };

  const handleScraperSetRole = async (groupId: number, role: 'main' | 'premium' | null) => {
    setScraperMessage(null);
    try {
      const res = await fetch(`/api/telegram-scraper/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update role');
      setScraperGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch (err) {
      setScraperMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update role' });
    }
  };

  if (loading) {
    return (
      <LoadingCard message="Loading settings…" />
    );
  }

  return (
    <div>
      <h1>Settings</h1>
      <p style={{ color: '#8b98a5', marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
        Configure API keys and other options. Keys are stored encoded in the database.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>OpenAI API key</h2>
        {openaiConfigured ? (
          <div>
            <p style={{ color: '#8b98a5', marginBottom: '1rem' }}>
              An API key is currently configured. You can replace it or remove it.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setShowReplaceInput(true); setOpenaiKey(''); }}
                disabled={saving}
              >
                Replace key
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleRemoveOpenAi}
                disabled={saving}
              >
                Remove key
              </button>
            </div>
            {showReplaceInput && (
              <form onSubmit={handleSaveOpenAi} style={{ marginTop: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                  New API key
                  <input
                    type="password"
                    autoComplete="off"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-..."
                    style={{ display: 'block', marginTop: '0.25rem', width: '100%', maxWidth: 400, padding: '0.5rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea' }}
                  />
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button type="submit" className="btn btn-primary" disabled={saving || !openaiKey.trim()}>
                    {saving ? 'Saving…' : 'Save new key'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => { setShowReplaceInput(false); setOpenaiKey(''); }}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleSaveOpenAi}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              API key (stored encoded in the database)
              <input
                type="password"
                autoComplete="off"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
                style={{ display: 'block', marginTop: '0.25rem', width: '100%', maxWidth: 400, padding: '0.5rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea' }}
              />
            </label>
            <button type="submit" className="btn btn-primary" style={{ marginTop: '0.5rem' }} disabled={saving}>
              {saving ? 'Saving…' : 'Save API key'}
            </button>
          </form>
        )}
        {message && (
          <p
            style={{
              marginTop: '1rem',
              padding: '0.5rem 0.75rem',
              borderRadius: 6,
              background: message.type === 'ok' ? 'rgba(0,186,124,0.15)' : 'rgba(249,24,84,0.15)',
              color: message.type === 'ok' ? '#00ba7c' : '#f91854',
            }}
          >
            {message.text}
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Telegram scraper</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Logs in with a Telegram user account (not the bot) so the <a href="/import">Import page&apos;s &quot;Actualizar miembros&quot;</a> button
          can sync group members automatically instead of running the scraper script by hand and uploading CSVs. Get an{' '}
          <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>api_id</code> /{' '}
          <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>api_hash</code> from{' '}
          my.telegram.org. Credentials and the login session are encrypted in the database.
        </p>

        {scraperLoading ? (
          <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>Loading…</p>
        ) : (
          <>
            {(!scraperAccount || scraperAccount.status === 'disconnected' || scraperAccount.status === 'error') && (
              <form onSubmit={handleScraperConnect}>
                {scraperAccount?.status === 'error' && scraperAccount.lastError && (
                  <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{scraperAccount.lastError}</div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
                  <label style={{ display: 'block' }}>
                    <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>API ID</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={scraperApiId}
                      onChange={(e) => setScraperApiId(e.target.value)}
                      placeholder="12345678"
                      style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', width: 160 }}
                    />
                  </label>
                  <label style={{ display: 'block' }}>
                    <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>API hash</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={scraperApiHash}
                      onChange={(e) => setScraperApiHash(e.target.value)}
                      placeholder="d0895e7cb323ad815ce84c9d574e4ba5"
                      style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', width: 260 }}
                    />
                  </label>
                  <label style={{ display: 'block' }}>
                    <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>Phone number</span>
                    <input
                      type="text"
                      value={scraperPhone}
                      onChange={(e) => setScraperPhone(e.target.value)}
                      placeholder="+573001234567"
                      style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', width: 180 }}
                    />
                  </label>
                </div>
                <button type="submit" className="btn btn-primary" disabled={scraperBusy || !scraperApiId.trim() || !scraperApiHash.trim() || !scraperPhone.trim()}>
                  {scraperBusy ? 'Sending code…' : 'Connect'}
                </button>
              </form>
            )}

            {scraperAccount?.status === 'pending_code' && (
              <form onSubmit={handleScraperSubmitCode}>
                <p style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                  Enter the login code Telegram just sent to <strong>{scraperAccount.phoneNumberDisplay}</strong>.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <label style={{ display: 'block' }}>
                    <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>Code</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoFocus
                      value={scraperCode}
                      onChange={(e) => setScraperCode(e.target.value)}
                      placeholder="12345"
                      style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', width: 140 }}
                    />
                  </label>
                  <button type="submit" className="btn btn-primary" disabled={scraperBusy || !scraperCode.trim()}>
                    {scraperBusy ? 'Verifying…' : 'Verify code'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleScraperCancel} disabled={scraperBusy}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {scraperAccount?.status === 'pending_password' && (
              <form onSubmit={handleScraperSubmitPassword}>
                <p style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                  This account has two-step verification (2FA) enabled. Enter the password.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <label style={{ display: 'block' }}>
                    <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>2FA password</span>
                    <input
                      type="password"
                      autoFocus
                      value={scraperPassword}
                      onChange={(e) => setScraperPassword(e.target.value)}
                      style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', width: 220 }}
                    />
                  </label>
                  <button type="submit" className="btn btn-primary" disabled={scraperBusy || !scraperPassword}>
                    {scraperBusy ? 'Verifying…' : 'Verify password'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleScraperCancel} disabled={scraperBusy}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {scraperAccount?.status === 'connected' && (
              <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
                  <span style={{ color: '#00ba7c', fontSize: '0.875rem' }}>
                    ✓ Connected as {scraperAccount.phoneNumberDisplay}
                  </span>
                  <button type="button" className="btn btn-secondary" onClick={handleScraperDiscover} disabled={scraperDiscovering}>
                    {scraperDiscovering ? 'Discovering…' : 'Discover groups'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleScraperDisconnect} disabled={scraperBusy}>
                    Disconnect
                  </button>
                </div>

                {scraperGroups.length === 0 ? (
                  <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>
                    No groups discovered yet. Click &quot;Discover groups&quot; to list the megagroups this account belongs to, then assign which one is Main and which is Premium.
                  </p>
                ) : (
                  <div className="table-wrap" style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Group</th>
                          <th>Role</th>
                          <th>Last synced</th>
                          <th>Members</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scraperGroups.map((g) => (
                          <tr key={g.id}>
                            <td>{g.title}</td>
                            <td>
                              <select
                                value={g.role ?? ''}
                                onChange={(e) => handleScraperSetRole(g.id, (e.target.value || null) as 'main' | 'premium' | null)}
                                style={{ padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea' }}
                              >
                                <option value="">— unassigned —</option>
                                <option value="main">Main</option>
                                <option value="premium">Premium</option>
                              </select>
                            </td>
                            <td style={{ fontSize: '0.8125rem' }}>
                              {g.lastScrapedAt ? new Date(g.lastScrapedAt).toLocaleString() : '—'}
                              {g.lastScrapeError && (
                                <div style={{ color: '#f91854', marginTop: '0.15rem' }}>{g.lastScrapeError}</div>
                              )}
                            </td>
                            <td>{g.memberCount ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {scraperMessage && (
          <p
            style={{
              marginTop: '1rem',
              padding: '0.5rem 0.75rem',
              borderRadius: 6,
              background: scraperMessage.type === 'ok' ? 'rgba(0,186,124,0.15)' : 'rgba(249,24,84,0.15)',
              color: scraperMessage.type === 'ok' ? '#00ba7c' : '#f91854',
              fontSize: '0.875rem',
            }}
          >
            {scraperMessage.text}
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Buyer Persona context</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Control how far back and how many messages/reactions are used when generating a buyer persona. Newest data is used first until the limit or the time window is reached.
        </p>
        <form onSubmit={handleSavePersonaSettings}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1rem' }}>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>Look back period</span>
              <select
                value={personaDaysBack}
                onChange={(e) => setPersonaDaysBack(e.target.value)}
                style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', minWidth: 140 }}
              >
                <option value="7">Last 7 days</option>
                <option value="15">Last 15 days</option>
                <option value="30">Last 30 days (1 month)</option>
                <option value="90">Last 90 days (3 months)</option>
                <option value="180">Last 180 days (6 months)</option>
                <option value="270">Last 270 days (9 months)</option>
                <option value="365">Last 365 days (1 year)</option>
                <option value="unlimited">Unlimited</option>
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>Max messages</span>
              <select
                value={personaMaxMessages}
                onChange={(e) => setPersonaMaxMessages(e.target.value)}
                style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', minWidth: 100 }}
              >
                <option value="50">50</option>
                <option value="80">80</option>
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="500">500</option>
                <option value="1000">1000</option>
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>Max reactions</span>
              <select
                value={personaMaxReactions}
                onChange={(e) => setPersonaMaxReactions(e.target.value)}
                style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', minWidth: 100 }}
              >
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="500">500</option>
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>
                OpenAI model for persona
                {personaModelOptions.length > 0 && (
                  <span
                    title={personaModelOptions.find((o) => o.id === personaOpenAIModel) ? `Input: $${(personaModelOptions.find((o) => o.id === personaOpenAIModel)!.inputPerM).toFixed(2)}/1M · Output: $${(personaModelOptions.find((o) => o.id === personaOpenAIModel)!.outputPerM).toFixed(2)}/1M` : ''}
                    style={{ marginLeft: '0.35rem', cursor: 'help', opacity: 0.8, fontSize: '0.75rem' }}
                  >
                    ⓘ
                  </span>
                )}
              </span>
              <select
                value={personaOpenAIModel}
                onChange={(e) => setPersonaOpenAIModel(e.target.value)}
                style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', minWidth: 220 }}
                title={personaModelOptions.find((o) => o.id === personaOpenAIModel) ? `Input: $${(personaModelOptions.find((o) => o.id === personaOpenAIModel)!.inputPerM).toFixed(2)}/1M tokens · Output: $${(personaModelOptions.find((o) => o.id === personaOpenAIModel)!.outputPerM).toFixed(2)}/1M tokens` : undefined}
              >
                {personaModelOptions.length > 0 ? personaModelOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                )) : (
                  <>
                    <option value="gpt-4o-mini-2024-07-18">GPT-4o mini (2024-07-18)</option>
                    <option value="gpt-4o-mini">GPT-4o mini (latest)</option>
                    <option value="gpt-4o">GPT-4o</option>
                  </>
                )}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>Max characters per message/reaction</span>
              <input
                type="number"
                min={100}
                max={2000}
                value={personaMaxTextLen}
                onChange={(e) => setPersonaMaxTextLen(Math.max(100, Math.min(2000, parseInt(e.target.value, 10) || 500)))}
                style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', width: 100 }}
              />
              <span style={{ marginLeft: '0.5rem', fontSize: '0.8125rem', color: '#8b98a5' }}>(100–2000)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.75rem' }}>
              <input
                type="checkbox"
                checked={personaIncludeBio}
                onChange={(e) => setPersonaIncludeBio(e.target.checked)}
              />
              <span style={{ fontSize: '0.875rem' }}>Include biography in persona context</span>
            </label>
          </div>
          <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
            <ChatSelector
              chats={chats}
              selectedIds={personaChatIds}
              onChange={setPersonaChatIds}
              label="Chats for persona context"
              allChatsLabel="Use all chats"
              onlyTheseLabel="Use only these chats:"
              hint="Applied when you generate a persona from any contact."
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={personaSaving}>
            {personaSaving ? 'Saving…' : 'Save persona settings'}
          </button>
          {personaMessage && (
            <p
              style={{
                marginTop: '1rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                background: personaMessage.type === 'ok' ? 'rgba(0,186,124,0.15)' : 'rgba(249,24,84,0.15)',
                color: personaMessage.type === 'ok' ? '#00ba7c' : '#f91854',
                fontSize: '0.875rem',
              }}
            >
              {personaMessage.text}
            </p>
          )}
        </form>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Persona prompts</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          System and user prompts sent to the AI for buyer persona generation. Stored in the database; on first deploy the current defaults are seeded. In the user prompt template use: <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>{'{{bio}}'}</code>, <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>{'{{messagesBlob}}'}</code>, <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>{'{{repliesBlob}}'}</code>, <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>{'{{reactionsBlob}}'}</code>.
        </p>
        <form onSubmit={handleSavePersonaPrompts}>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>System prompt</span>
            <textarea
              value={personaSystemPrompt}
              onChange={(e) => setPersonaSystemPrompt(e.target.value)}
              rows={8}
              style={{ width: '100%', maxWidth: 720, padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', fontFamily: 'inherit', fontSize: '0.875rem' }}
              placeholder="Instructions for the AI role and behavior…"
            />
          </label>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>User prompt template (use placeholders above)</span>
            <textarea
              value={personaUserPromptTemplate}
              onChange={(e) => setPersonaUserPromptTemplate(e.target.value)}
              rows={12}
              style={{ width: '100%', maxWidth: 720, padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', fontFamily: 'inherit', fontSize: '0.875rem' }}
              placeholder="## Profile / Bio\n{{bio}}\n\n## Recent messages\n{{messagesBlob}}\n…"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={promptsSaving}>
            {promptsSaving ? 'Saving…' : 'Save prompts'}
          </button>
          {promptsMessage && (
            <p
              style={{
                marginTop: '1rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                background: promptsMessage.type === 'ok' ? 'rgba(0,186,124,0.15)' : 'rgba(249,24,84,0.15)',
                color: promptsMessage.type === 'ok' ? '#00ba7c' : '#f91854',
                fontSize: '0.875rem',
              }}
            >
              {promptsMessage.text}
            </p>
          )}
        </form>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Day insight prompt</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          System and user prompts for the &quot;why was there activity this day?&quot; AI analysis (when you click a point on Messages over time). Stored in the database. In the user template use: <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>{'{{periodLabel}}'}</code>, <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>{'{{messageCount}}'}</code>, <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>{'{{userCount}}'}</code>, <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>{'{{scope}}'}</code>, <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>{'{{scopeDetail}}'}</code>, <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>{'{{messagesBlob}}'}</code>.
        </p>
        <form onSubmit={handleSaveDayInsightPrompts}>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>System prompt</span>
            <textarea
              value={dayInsightSystemPrompt}
              onChange={(e) => setDayInsightSystemPrompt(e.target.value)}
              rows={6}
              style={{ width: '100%', maxWidth: 720, padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', fontFamily: 'inherit', fontSize: '0.875rem' }}
              placeholder="Instructions for the day analysis AI…"
            />
          </label>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>User prompt template (use placeholders above)</span>
            <textarea
              value={dayInsightUserPromptTemplate}
              onChange={(e) => setDayInsightUserPromptTemplate(e.target.value)}
              rows={10}
              style={{ width: '100%', maxWidth: 720, padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', fontFamily: 'inherit', fontSize: '0.875rem' }}
              placeholder="## Period\n{{periodLabel}}\n\n## Messages\n{{messagesBlob}}\n…"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={dayInsightPromptsSaving}>
            {dayInsightPromptsSaving ? 'Saving…' : 'Save day insight prompts'}
          </button>
          {dayInsightPromptsMessage && (
            <p
              style={{
                marginTop: '1rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                background: dayInsightPromptsMessage.type === 'ok' ? 'rgba(0,186,124,0.15)' : 'rgba(249,24,84,0.15)',
                color: dayInsightPromptsMessage.type === 'ok' ? '#00ba7c' : '#f91854',
                fontSize: '0.875rem',
              }}
            >
              {dayInsightPromptsMessage.text}
            </p>
          )}
        </form>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Persona schema & card labels</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          JSON for AI schema field descriptions and for labels shown on the persona card. Invalid JSON will be rejected on save.
        </p>
        <form onSubmit={handleSaveSchemaAndLabels}>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>Persona schema descriptions (JSON)</span>
            <textarea
              value={personaSchemaDescriptions}
              onChange={(e) => setPersonaSchemaDescriptions(e.target.value)}
              rows={10}
              style={{ width: '100%', maxWidth: 720, padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', fontFamily: 'monospace', fontSize: '0.8125rem' }}
              placeholder='{"summary":"...","topics":"...",...}'
            />
          </label>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>Persona card labels (JSON)</span>
            <textarea
              value={uiPersonaLabels}
              onChange={(e) => setUiPersonaLabels(e.target.value)}
              rows={8}
              style={{ width: '100%', maxWidth: 720, padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', fontFamily: 'monospace', fontSize: '0.8125rem' }}
              placeholder='{"title":"...","generateBtn":"...",...}'
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={miscSaving}>
            {miscSaving ? 'Saving…' : 'Save schema & labels'}
          </button>
          {schemaLabelsMessage && (
            <p
              style={{
                marginTop: '1rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                background: schemaLabelsMessage.type === 'ok' ? 'rgba(0,186,124,0.15)' : 'rgba(249,24,84,0.15)',
                color: schemaLabelsMessage.type === 'ok' ? '#00ba7c' : '#f91854',
                fontSize: '0.875rem',
              }}
            >
              {schemaLabelsMessage.text}
            </p>
          )}
        </form>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>List limits & cache</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Limits for list APIs and stats cache TTL.
        </p>
        <form onSubmit={handleSaveListLimitsAndMisc}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem 1.5rem', marginBottom: '1rem' }}>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>AI usage list limit</span>
              <input
                type="number"
                min={10}
                max={500}
                value={uiListLimitAiUsage}
                onChange={(e) => setUiListLimitAiUsage(Math.max(10, Math.min(500, parseInt(e.target.value, 10) || 50)))}
                style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', width: 80 }}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>Messages per page</span>
              <input
                type="number"
                min={5}
                max={200}
                value={uiListLimitMessagesPage}
                onChange={(e) => setUiListLimitMessagesPage(Math.max(5, Math.min(200, parseInt(e.target.value, 10) || 20)))}
                style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', width: 80 }}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>Period detail limit</span>
              <input
                type="number"
                min={5}
                max={200}
                value={uiListLimitPeriodDetail}
                onChange={(e) => setUiListLimitPeriodDetail(Math.max(5, Math.min(200, parseInt(e.target.value, 10) || 20)))}
                style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', width: 80 }}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.875rem' }}>Stats cache TTL (minutes)</span>
              <input
                type="number"
                min={0}
                max={60}
                value={cacheTtlStatsMinutes}
                onChange={(e) => setCacheTtlStatsMinutes(Math.max(0, Math.min(60, parseInt(e.target.value, 10) || 0)))}
                style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea', width: 80 }}
              />
            </label>
          </div>
          <button type="submit" className="btn btn-primary" disabled={miscSaving}>
            {miscSaving ? 'Saving…' : 'Save limits & cache'}
          </button>
          {listLimitsMessage && (
            <p
              style={{
                marginTop: '1rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                background: listLimitsMessage.type === 'ok' ? 'rgba(0,186,124,0.15)' : 'rgba(249,24,84,0.15)',
                color: listLimitsMessage.type === 'ok' ? '#00ba7c' : '#f91854',
                fontSize: '0.875rem',
              }}
            >
              {listLimitsMessage.text}
            </p>
          )}
        </form>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>AI usage</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
          Recent AI API calls (e.g. persona generation). Total rows: {aiUsageTotal}.
        </p>
        {aiUsageSummary && (
          <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
            <span>Runs: <strong style={{ color: '#e7e9ea' }}>{aiUsageSummary.total_runs}</strong></span>
            <span>Prompt tokens: <strong style={{ color: '#e7e9ea' }}>{aiUsageSummary.total_prompt_tokens.toLocaleString()}</strong></span>
            <span>Completion tokens: <strong style={{ color: '#e7e9ea' }}>{aiUsageSummary.total_completion_tokens.toLocaleString()}</strong></span>
            <span>Total tokens: <strong style={{ color: '#e7e9ea' }}>{aiUsageSummary.total_tokens.toLocaleString()}</strong></span>
            <span>Total cost: <strong style={{ color: '#e7e9ea' }}>${aiUsageSummary.total_cost_usd.toFixed(4)}</strong></span>
          </p>
        )}
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Entity ID</th>
                <th>Model</th>
                <th>Prompt tokens</th>
                <th>Completion tokens</th>
                <th>Total</th>
                <th>Cost ($)</th>
              </tr>
            </thead>
            <tbody>
              {aiUsageLogs.length === 0 && (
                <tr><td colSpan={8} style={{ color: '#8b98a5' }}>No AI usage logged yet.</td></tr>
              )}
              {aiUsageLogs.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontSize: '0.8125rem' }}>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                  <td>{row.entity_type}</td>
                  <td>{row.entity_id != null ? row.entity_id : '—'}</td>
                  <td title={row.model_pricing_tooltip ?? ''} style={{ cursor: row.model_pricing_tooltip ? 'help' : undefined }}>
                    {row.model}
                    {row.model_pricing_tooltip && <span style={{ marginLeft: '0.25rem', opacity: 0.7 }} title={row.model_pricing_tooltip}>ⓘ</span>}
                  </td>
                  <td>{row.prompt_tokens}</td>
                  <td>{row.completion_tokens}</td>
                  <td>{row.total_tokens}</td>
                  <td>{row.cost_estimate != null ? `$${Number(row.cost_estimate).toFixed(4)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Sign out</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '1rem' }}>
          End your session on this device.
        </p>
        <LogoutButton className="btn-logout-danger" />
      </div>
    </div>
  );
}
