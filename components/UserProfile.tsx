'use client';

import { useEffect, useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ChatSelector } from '@/components/ChatSelector';
import { LoadingCard, LoadingSpinner } from '@/components/Loading';

interface UserProfileProps {
  fromId?: string;
  /** When set, load user by internal id (for list-only users with from_id null). */
  byId?: number;
  /** Optional chat IDs to preselect "Filter by chat" (e.g. from Contacts link with ?chatIds=1,2). */
  initialChatIds?: number[];
}

interface UserDetail {
  id: number;
  from_id: string | null;
  display_name: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  is_premium: boolean;
  telegram_premium?: boolean;
  telegram_verified?: boolean;
  telegram_fake?: boolean;
  telegram_bot?: boolean;
  telegram_status_type?: string | null;
  telegram_bio?: string | null;
  telegram_last_seen?: string | null;
  assigned_to: string | null;
  notes: string | null;
  is_current_member?: boolean;
  profile_photo_urls?: string[] | null;
  stats: {
    messagesSent: number;
    serviceMessages?: number;
    totalActivity?: number;
    reactionsGiven: number;
    reactionsReceived: number;
    reactionsRatio?: number;
    totalWords?: number;
    totalChars?: number;
    activeDays?: number;
    photos?: number;
    videos?: number;
    messagesEdited?: number;
    replies?: number;
    topReactedToId?: string | null;
    topReactedToName?: string | null;
  };
  calls: {
    id: number;
    call_number: number;
    called_at: string | null;
    notes: string | null;
    objections: string | null;
    plans_discussed: string | null;
    created_by: string | null;
    created_at: string;
  }[];
}

interface TimeSeries {
  period: string;
  count: number;
}

type QuickRange = '1w' | '1m' | '3m' | '6m' | '1y' | '2y' | 'all';
const QUICK_RANGE_OPTIONS: { value: QuickRange; label: string }[] = [
  { value: '1w', label: 'Week' },
  { value: '1m', label: 'Month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: '1y', label: '1 year' },
  { value: '2y', label: '2 years' },
  { value: 'all', label: 'Indefinitely' },
];

function quickRangeBounds(range: QuickRange): { start: string | null; end: string | null } {
  if (range === 'all') return { start: null, end: null };
  const now = new Date();
  const start = new Date(now);
  if (range === '1w') start.setUTCDate(start.getUTCDate() - 7);
  else if (range === '1m') start.setUTCMonth(start.getUTCMonth() - 1);
  else if (range === '3m') start.setUTCMonth(start.getUTCMonth() - 3);
  else if (range === '6m') start.setUTCMonth(start.getUTCMonth() - 6);
  else if (range === '1y') start.setUTCFullYear(start.getUTCFullYear() - 1);
  else if (range === '2y') start.setUTCFullYear(start.getUTCFullYear() - 2);
  return { start: start.toISOString(), end: now.toISOString() };
}

interface ChatSeries {
  chatId: number;
  chatName: string;
  slug: string;
  data: { period: string; count: number }[];
}

interface PeriodDetail {
  periodStart: string;
  periodEnd: string;
  count: number;
  byUser: { from_id: string; display_name: string | null; count: number }[];
  recentMessages: { date: string; from_id: string | null; display_name: string | null; text: string | null }[];
}

interface PeriodReactionsDetail {
  periodStart: string;
  periodEnd: string;
  count: number;
  recentReactions: {
    reacted_at: string | null;
    reactor_from_id: string;
    reactor_name: string | null;
    emoji: string | null;
    message_date: string | null;
    message_author_id: string | null;
    message_author_name: string | null;
    message_text: string | null;
  }[];
}

interface Persona {
  id: number;
  user_id: number;
  summary: string | null;
  topics: string[] | null;
  inferred_age_range: string | null;
  inferred_occupation: string | null;
  inferred_goals: string[] | null;
  social_links: { instagram?: string | null; twitter?: string | null; linkedin?: string | null; other?: string[] } | null;
  content_preferences: string | null;
  pain_points: string[] | null;
  inference_evidence: string | null;
  model_used: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  run_at: string | null;
  generated_for_range?: string | null;
  buying_intent_score: number | null;
  buying_signals: string[] | null;
  follow_up_priority: string | null;
  engagement_level: string | null;
  outreach_approach: string | null;
  objection_patterns: string[] | null;
  spending_capacity: string | null;
}

interface TopRelationship {
  otherFromId: string;
  otherDisplayName: string;
  reactionsToThem: number;
  repliesToThem: number;
  reactionsFromThem: number;
  repliesFromThem: number;
  totalScore: number;
}

interface RelationshipInsight {
  summary: string | null;
  tone: string | null;
  mutual_or_one_sided: string | null;
  evolution: string | null;
  inference_evidence: string | null;
  model_used?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  run_at?: string | null;
  generated_for_range?: string | null;
}

export function UserProfile({ fromId: fromIdProp, byId, initialChatIds }: UserProfileProps) {
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [timeSeries, setTimeSeries] = useState<{ messagesOverTime: TimeSeries[]; reactionsOverTime: TimeSeries[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCallForm, setShowCallForm] = useState(false);
  const [callForm, setCallForm] = useState({
    call_number: 1,
    notes: '',
    objections: '',
    plans_discussed: '',
    created_by: '',
  });
  const [persona, setPersona] = useState<Persona | null>(null);
  const [personaLoading, setPersonaLoading] = useState(false);
  const [personaGenerating, setPersonaGenerating] = useState(false);
  const [personaError, setPersonaError] = useState<string | null>(null);
  const [personaLabels, setPersonaLabels] = useState<Record<string, string>>({
    title: 'AI Buyer Persona',
    generateBtn: 'Generate persona',
    regenerating: 'Regenerating…',
    summary: 'Summary',
    topics: 'Topics / interests',
    inferredProfile: 'Inferred profile',
    contentPreferences: 'Content preferences',
    painPoints: 'Pain points',
    evidence: 'Evidence / reasoning',
    noPersonaYet: 'No persona generated yet. Use AI to build a buyer persona from profile, messages, and reactions.',
  });
  const [chats, setChats] = useState<{ id: number; name: string; slug: string }[]>([]);
  const [profileChatIds, setProfileChatIds] = useState<number[]>(() => initialChatIds ?? []);
  const [quickRange, setQuickRange] = useState<QuickRange>('3m');
  const [overview, setOverview] = useState<{
    messagesOverTimeByChat?: ChatSeries[];
    reactionsOverTimeByChat?: ChatSeries[];
    messagesOverTime?: { period: string; count: number }[];
    reactionsOverTime?: { period: string; count: number }[];
  } | null>(null);
  const [modalPoint, setModalPoint] = useState<{ period: string; periodLabel: string; count: number; type: 'messages' | 'reactions'; chatId?: number; chatName?: string } | null>(null);
  const [periodDetail, setPeriodDetail] = useState<PeriodDetail | null>(null);
  const [periodReactionsDetail, setPeriodReactionsDetail] = useState<PeriodReactionsDetail | null>(null);
  const [periodDetailLoading, setPeriodDetailLoading] = useState(false);
  const [periodReactionsLoading, setPeriodReactionsLoading] = useState(false);
  const [dayInsight, setDayInsight] = useState<{ summary: string; prompt_tokens?: number; completion_tokens?: number; run_at?: string; scope?: string } | null>(null);
  const [dayInsightLoading, setDayInsightLoading] = useState(false);
  const [dayInsightGenerating, setDayInsightGenerating] = useState(false);
  const [dayInsightError, setDayInsightError] = useState<string | null>(null);
  // Seeded from /full response so ReactionsGivenList and UserMessagesList don't fetch separately
  const [_recentMsgs, _setRecentMsgs] = useState<{ chat_id?: number; chat_name?: string | null; chat_slug?: string | null; date: string; text: string | null; [k: string]: unknown }[] | null>(null);
  const [_reactionsGiven, _setReactionsGiven] = useState<{ chatId: number; chatName: string | null; chatSlug: string | null; receiverFromId: string; receiverName: string | null; count: number }[] | null>(null);
  const [topRelationships, setTopRelationships] = useState<TopRelationship[]>([]);
  const [topRelationshipsLoading, setTopRelationshipsLoading] = useState(false);
  const [relationshipInsightByKey, setRelationshipInsightByKey] = useState<Record<string, RelationshipInsight | null>>({});
  const [relationshipLoadingByKey, setRelationshipLoadingByKey] = useState<Record<string, boolean>>({});
  const [relationshipGeneratingByKey, setRelationshipGeneratingByKey] = useState<Record<string, boolean>>({});
  const [relationshipErrorByKey, setRelationshipErrorByKey] = useState<Record<string, string | null>>({});

  const fromId = fromIdProp ?? (user?.from_id ?? null);
  const range = useMemo(() => quickRangeBounds(quickRange), [quickRange]);
  const start = range.start;
  const end = range.end;

  const CHAT_COLORS = ['#00ba7c', '#1d9bf0', '#ff9500', '#7856ff', '#00d4aa', '#e6007a', '#ffd400', '#0891b2', '#22c55e', '#a855f7'];
  const chatIdToColor = useMemo(() => {
    const sorted = [...chats].sort((a, b) => Number(a.id) - Number(b.id));
    const map = new Map<number, string>();
    sorted.forEach((c, i) => map.set(Number(c.id), CHAT_COLORS[i % CHAT_COLORS.length]));
    return (chatId: number) => {
      const id = Number(chatId);
      const fromMap = map.get(id);
      if (fromMap) return fromMap;
      const hash = Math.abs((id * 2654435761) >>> 0);
      return CHAT_COLORS[hash % CHAT_COLORS.length];
    };
  }, [chats]);

  const periodBounds = (period: string, g: 'day' | 'week' | 'month') => {
    const start = new Date(period);
    const end = new Date(start);
    if (g === 'day') end.setUTCDate(end.getUTCDate() + 1);
    else if (g === 'week') end.setUTCDate(end.getUTCDate() + 7);
    else end.setUTCMonth(end.getUTCMonth() + 1);
    return { start: start.toISOString(), end: end.toISOString() };
  };

  // Single aggregated fetch: user + KPI stats + time series + chats + labels
  // + recentMessages + reactionsGiven in one request.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const base = byId != null
      ? `/api/users/by-id/${byId}/full`
      : `/api/users/${encodeURIComponent(fromIdProp!)}/full`;
    const params = new URLSearchParams({ groupBy });
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    profileChatIds.forEach((id) => params.append('chatId', String(id)));
    fetch(`${base}?${params}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error('User not found');
        return r.json();
      })
      .then((data) => {
        setUser(data.user ?? null);
        setTimeSeries(data.timeSeries ?? null);
        if (Array.isArray(data.chats)) {
          setChats(data.chats);
          setProfileChatIds((prev) => (prev.length === 0 && data.chats.length > 0 && !initialChatIds?.length ? data.chats.map((c: { id: number }) => c.id) : prev));
        }
        if (data.labels && typeof data.labels === 'object') {
          setPersonaLabels((prev) => ({ ...prev, ...data.labels }));
        }
        if (Array.isArray(data.recentMessages)) _setRecentMsgs(data.recentMessages);
        if (Array.isArray(data.reactionsGiven)) _setReactionsGiven(data.reactionsGiven);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : 'Failed to load user');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [byId, fromIdProp, profileChatIds, groupBy, start, end]);

  // Overview for by-chat charts (messages/reactions over time per chat)
  useEffect(() => {
    if (!fromId) {
      setOverview(null);
      return;
    }
    const ctrl = new AbortController();
    const params = new URLSearchParams({ groupBy, byChat: '1' });
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    params.set('fromId', fromId);
    profileChatIds.forEach((id) => params.append('chatId', String(id)));
    fetch(`/api/stats/overview?${params}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) return;
        setOverview({
          messagesOverTimeByChat: data.messagesOverTimeByChat ?? [],
          reactionsOverTimeByChat: data.reactionsOverTimeByChat ?? [],
          messagesOverTime: data.messagesOverTime ?? [],
          reactionsOverTime: data.reactionsOverTime ?? [],
        });
      })
      .catch(() => setOverview(null));
    return () => ctrl.abort();
  }, [fromId, groupBy, start, end, profileChatIds]);

  useEffect(() => {
    if (!modalPoint || modalPoint.type !== 'messages') {
      setPeriodDetail(null);
      return;
    }
    const ctrl = new AbortController();
    const { start: ps, end: pe } = periodBounds(modalPoint.period, groupBy);
    setPeriodDetailLoading(true);
    const params = new URLSearchParams({ start: ps, end: pe });
    const chatIdsToUse = modalPoint.chatId != null ? [modalPoint.chatId] : profileChatIds;
    chatIdsToUse.forEach((id) => params.append('chatId', String(id)));
    const fid = user?.from_id ?? null;
    if (fid) params.set('fromId', fid);
    fetch(`/api/stats/period-detail?${params}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then(setPeriodDetail)
      .catch(() => {})
      .finally(() => setPeriodDetailLoading(false));
    return () => ctrl.abort();
  }, [modalPoint, groupBy, profileChatIds, user?.from_id]);

  useEffect(() => {
    if (!modalPoint || modalPoint.type !== 'reactions') {
      setPeriodReactionsDetail(null);
      return;
    }
    const ctrl = new AbortController();
    const { start: ps, end: pe } = periodBounds(modalPoint.period, groupBy);
    setPeriodReactionsLoading(true);
    const params = new URLSearchParams({ start: ps, end: pe });
    const chatIdsToUse = modalPoint.chatId != null ? [modalPoint.chatId] : profileChatIds;
    chatIdsToUse.forEach((id) => params.append('chatId', String(id)));
    const fid = user?.from_id ?? null;
    if (fid) params.set('fromId', fid);
    fetch(`/api/stats/period-reactions?${params}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then(setPeriodReactionsDetail)
      .catch(() => {})
      .finally(() => setPeriodReactionsLoading(false));
    return () => ctrl.abort();
  }, [modalPoint, groupBy, profileChatIds, user?.from_id]);

  useEffect(() => {
    if (!modalPoint) {
      setDayInsight(null);
      setDayInsightError(null);
      return;
    }
    const ctrl = new AbortController();
    setDayInsightError(null);
    const { start: ps, end: pe } = periodBounds(modalPoint.period, groupBy);
    setDayInsightLoading(true);
    const params = new URLSearchParams({ start: ps, end: pe });
    const chatIdsToUse = modalPoint.chatId != null ? [modalPoint.chatId] : profileChatIds;
    chatIdsToUse.forEach((id) => params.append('chatId', String(id)));
    const fid = user?.from_id ?? null;
    if (fid) params.set('fromId', fid);
    fetch(`/api/stats/day-insight?${params}`, { signal: ctrl.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setDayInsightError(data?.error || `Error ${r.status}`);
          setDayInsight(null);
        } else {
          setDayInsightError(null);
          setDayInsight(data.insight ?? null);
        }
      })
      .catch((e) => { if (e?.name !== 'AbortError') { setDayInsightError(null); setDayInsight(null); } })
      .finally(() => setDayInsightLoading(false));
    return () => ctrl.abort();
  }, [modalPoint, groupBy, profileChatIds, user?.from_id]);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setPersonaLoading(true);
    setPersonaError(null);
    const url = byId != null ? `/api/users/by-id/${byId}/persona` : `/api/users/${encodeURIComponent(fromId!)}/persona`;
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('Failed to load persona');
        return r.json();
      })
      .then(setPersona)
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setPersonaError(e instanceof Error ? e.message : 'Failed to load persona');
      })
      .finally(() => setPersonaLoading(false));
    return () => controller.abort();
  }, [user?.id, byId, fromId]);

  // Top 3 relationships (same chat + date range as profile KPIs)
  useEffect(() => {
    if (!fromId) {
      setTopRelationships([]);
      return;
    }
    const controller = new AbortController();
    setTopRelationshipsLoading(true);
    const params = new URLSearchParams();
    profileChatIds.forEach((id) => params.append('chatId', String(id)));
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    fetch(`/api/users/${encodeURIComponent(fromId)}/top-relationships?${params}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { topRelationships: [] }))
      .then((data) => setTopRelationships(Array.isArray(data.topRelationships) ? data.topRelationships : []))
      .catch(() => setTopRelationships([]))
      .finally(() => setTopRelationshipsLoading(false));
    return () => controller.abort();
  }, [fromId, profileChatIds, start, end]);

  // Preload stored relationship insights for top 3
  useEffect(() => {
    if (!fromId || topRelationships.length === 0) return;
    topRelationships.forEach((rel) => {
      const key = rel.otherFromId;
      setRelationshipLoadingByKey((prev) => ({ ...prev, [key]: true }));
      setRelationshipErrorByKey((prev) => ({ ...prev, [key]: null }));
      fetch(`/api/users/${encodeURIComponent(fromId)}/relationship-summary?otherFromId=${encodeURIComponent(key)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setRelationshipInsightByKey((prev) => ({ ...prev, [key]: data ?? null }));
        })
        .catch(() => setRelationshipInsightByKey((prev) => ({ ...prev, [key]: null })))
        .finally(() => setRelationshipLoadingByKey((prev) => ({ ...prev, [key]: false })));
    });
  }, [fromId, topRelationships]);

  const handleGenerateRelationshipSummary = async (otherFromId: string) => {
    if (!fromId) return;
    setRelationshipGeneratingByKey((prev) => ({ ...prev, [otherFromId]: true }));
    setRelationshipErrorByKey((prev) => ({ ...prev, [otherFromId]: null }));
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(fromId)}/relationship-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        otherFromId,
        chatIds: profileChatIds.length > 0 ? profileChatIds : undefined,
        start: start ?? undefined,
        end: end ?? undefined,
        rangeLabel: QUICK_RANGE_OPTIONS.find((o) => o.value === quickRange)?.label ?? quickRange,
      }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate');
      setRelationshipInsightByKey((prev) => ({ ...prev, [otherFromId]: data.insight ?? null }));
    } catch (e) {
      setRelationshipErrorByKey((prev) => ({ ...prev, [otherFromId]: e instanceof Error ? e.message : 'Failed' }));
    } finally {
      setRelationshipGeneratingByKey((prev) => ({ ...prev, [otherFromId]: false }));
    }
  };

  const handlePatch = async (updates: { is_premium?: boolean; assigned_to?: string; notes?: string }) => {
    if (!user) return;
    setSaving(true);
    try {
      const url = byId != null ? `/api/users/by-id/${byId}` : `/api/users/${encodeURIComponent(fromId!)}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Update failed');
      const updated = await res.json();
      setUser((u) => (u ? { ...u, ...updated } : null));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      const url = byId != null ? `/api/users/by-id/${byId}/calls` : `/api/users/${encodeURIComponent(fromId!)}/calls`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...callForm,
          called_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error('Failed to log call');
      const newCall = await res.json();
      setUser((u) => (u ? { ...u, calls: [...u.calls, newCall].sort((a, b) => a.call_number - b.call_number) } : null));
      setShowCallForm(false);
      setCallForm({ call_number: 1, notes: '', objections: '', plans_discussed: '', created_by: '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log call');
    } finally {
      setSaving(false);
    }
  };

  const formatPeriod = (p: string | null) =>
    p ? new Date(p).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '';
  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const rangeLabel = QUICK_RANGE_OPTIONS.find((o) => o.value === quickRange)?.label ?? quickRange;
  const handleGeneratePersona = async () => {
    if (!user) return;
    setPersonaGenerating(true);
    setPersonaError(null);
    try {
      const url = byId != null ? `/api/users/by-id/${byId}/persona` : `/api/users/${encodeURIComponent(fromId!)}/persona`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: start ?? undefined,
          end: end ?? undefined,
          chatIds: profileChatIds.length > 0 ? profileChatIds : undefined,
          rangeLabel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate persona');
      setPersona(data.persona ?? data);
    } catch (e) {
      setPersonaError(e instanceof Error ? e.message : 'Failed to generate persona');
    } finally {
      setPersonaGenerating(false);
    }
  };

  if (loading) return <LoadingCard message="Loading profile…" />;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!user) return <div className="card">User not found.</div>;

  const byChatMessages = overview?.messagesOverTimeByChat ?? [];
  const byChatReactions = overview?.reactionsOverTimeByChat ?? [];
  const messagesData = (overview?.messagesOverTime ?? timeSeries?.messagesOverTime ?? []).map((p) => ({
    ...p,
    periodLabel: formatPeriod(p.period),
  }));
  const reactionsData = (overview?.reactionsOverTime ?? timeSeries?.reactionsOverTime ?? []).map((p) => ({
    ...p,
    periodLabel: formatPeriod(p.period),
  }));
  const messagesChartData =
    byChatMessages.length > 0
      ? (() => {
          const periods = new Set<string>(messagesData.map((d) => d.period));
          return Array.from(periods)
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
            .map((period) => {
              const row: Record<string, string | number> = { period, periodLabel: formatPeriod(period) };
              let total = 0;
              byChatMessages.forEach((c) => {
                const pt = c.data.find((d) => d.period === period);
                const count = pt?.count ?? 0;
                row[c.slug] = count;
                total += count;
              });
              row.count = total;
              return row;
            });
        })()
      : messagesData;
  const reactionsChartData =
    byChatReactions.length > 0
      ? (() => {
          const periods = new Set<string>(reactionsData.map((d) => d.period));
          return Array.from(periods)
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
            .map((period) => {
              const row: Record<string, string | number> = { period, periodLabel: formatPeriod(period) };
              byChatReactions.forEach((c) => {
                const pt = c.data.find((d) => d.period === period);
                row[c.slug] = pt?.count ?? 0;
              });
              return row;
            });
        })()
      : reactionsData;

  const usedCallNumbers = user.calls.map((c) => c.call_number);

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.display_name || user.from_id;

  return (
    <div>
      <div className="user-detail-header" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
        <h1 style={{ margin: 0 }}>{fullName}</h1>
        <span className={user.is_current_member ? 'badge badge-success' : 'badge badge-muted'}>
          {user.is_current_member ? 'Member' : 'Former'}
        </span>
        <span
          className="badge"
          style={
            user.is_premium
              ? { background: 'rgba(255, 193, 7, 0.2)', color: '#e6a800', border: '1px solid rgba(230, 168, 0, 0.5)' }
              : { background: '#2f3336', color: '#8b98a5' }
          }
        >
          {user.is_premium ? 'Premium' : 'Not premium'}
        </span>
        <a href="/contacts" className="btn btn-secondary" style={{ marginLeft: 'auto' }}>Back to contacts</a>
      </div>

      {Array.isArray(user.profile_photo_urls) && user.profile_photo_urls.length > 0 && (
        <div className="profile-photos-gallery" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.75rem' }}>
            {user.profile_photo_urls.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block',
                  flexShrink: 0,
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid #2f3336',
                  lineHeight: 0,
                }}
                title="View full size"
              >
                <img
                  src={url}
                  alt=""
                  width={i === 0 ? 120 : 72}
                  height={i === 0 ? 120 : 72}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: i === 0 ? 120 : 72,
                    height: i === 0 ? 120 : 72,
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {chats.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="filters" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '1rem', marginBottom: '0.5rem' }}>
            <label>
              Group by
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'day' | 'week' | 'month')}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.8125rem', color: '#8b98a5' }}>Range</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {QUICK_RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setQuickRange(opt.value)}
                    className={`btn ${quickRange === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <ChatSelector
              chats={chats}
              selectedIds={profileChatIds}
              onChange={setProfileChatIds}
              label="Chats"
              variant="toggles"
              compact
            />
            {(quickRange !== '3m' || profileChatIds.length !== chats.length) && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setQuickRange('3m'); setProfileChatIds(chats.map((c) => c.id)); }}
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.875rem' }}
                title="Reset to 3 months, all chats"
              >
                Reset filters
              </button>
            )}
          </div>
          <p style={{ color: '#8b98a5', fontSize: '0.8125rem', margin: 0 }}>Applies to stats, charts, messages and reactions on this page.</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1rem' }}>Profile</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem 2rem' }}>
          {user.username && (
            <div>
              <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Username</span>
              <div style={{ fontWeight: 600 }}>@{user.username}</div>
            </div>
          )}
          {user.first_name != null && user.first_name !== '' && (
            <div>
              <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>First name</span>
              <div>{user.first_name}</div>
            </div>
          )}
          {user.last_name != null && user.last_name !== '' && (
            <div>
              <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Last name</span>
              <div>{user.last_name}</div>
            </div>
          )}
          {user.phone && (
            <div>
              <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Phone</span>
              <div>{user.phone}</div>
            </div>
          )}
          <div>
            <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>User ID</span>
            <div><code style={{ fontSize: '0.875rem' }}>{user.from_id ?? '—'}</code></div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem', marginBottom: user.telegram_bio ? '1rem' : 0 }}>
          {user.telegram_premium && (
            <span className="badge" style={{ background: 'linear-gradient(135deg, #0088cc 0%, #00a2e8 100%)', color: '#fff' }}>Telegram Premium</span>
          )}
          {user.telegram_verified && <span className="badge" style={{ background: '#00ba7c', color: '#fff' }}>Verified</span>}
          {user.telegram_fake && <span className="badge" style={{ background: '#f90', color: '#000' }}>Fake</span>}
          {user.telegram_bot && <span className="badge" style={{ background: '#2f3336', color: '#8b98a5' }}>Bot</span>}
          {user.telegram_status_type && (
            <span className="badge badge-default">Status: {user.telegram_status_type}</span>
          )}
          {user.telegram_last_seen && (
            <span style={{ color: '#8b98a5', fontSize: '0.8125rem' }}>
              Last seen: {formatDate(user.telegram_last_seen)}
            </span>
          )}
        </div>
        {user.telegram_bio && (
          <div style={{ marginTop: '0.75rem', paddingTop: '1rem', borderTop: '1px solid #2f3336' }}>
            <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bio</span>
            <p style={{ margin: '0.35rem 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>{user.telegram_bio}</p>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1rem' }}>{personaLabels.title}</h2>
        {personaLoading && !persona && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5' }}>
            <LoadingSpinner size="sm" />
            <span>Loading persona…</span>
          </div>
        )}
        {personaError && <p style={{ color: '#f91854', marginBottom: '0.75rem' }}>{personaError}</p>}
        {!personaLoading && !persona && (
          <>
            <p style={{ color: '#8b98a5', marginBottom: '1rem' }}>{personaLabels.noPersonaYet}</p>
            <button type="button" className="btn btn-primary" onClick={handleGeneratePersona} disabled={personaGenerating}>
              {personaGenerating ? personaLabels.regenerating : personaLabels.generateBtn}
            </button>
          </>
        )}
        {persona && (
          <>
            {/* Sales intelligence */}
            {(persona.follow_up_priority || persona.buying_intent_score != null || persona.engagement_level || persona.spending_capacity) && (
              <div style={{ marginBottom: '1rem', padding: '.85rem 1rem', background: '#0a0a18', borderRadius: 10, border: '1px solid #1e1e32' }}>
                <span style={{ color: '#8b98a5', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '.6rem' }}>Sales intelligence</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginBottom: persona.buying_intent_score != null ? '.7rem' : 0 }}>
                  {persona.follow_up_priority && (() => {
                    const p: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
                      hot: { label: 'Hot', color: '#ff4757', bg: 'rgba(255,71,87,.12)', border: 'rgba(255,71,87,.35)', icon: '🔥' },
                      warm: { label: 'Warm', color: '#ffa502', bg: 'rgba(255,165,2,.12)', border: 'rgba(255,165,2,.35)', icon: '⚡' },
                      cold: { label: 'Cold', color: '#5c6bc0', bg: 'rgba(92,107,192,.12)', border: 'rgba(92,107,192,.35)', icon: '❄️' },
                      nurture: { label: 'Nurture', color: '#78909c', bg: 'rgba(120,144,156,.12)', border: 'rgba(120,144,156,.35)', icon: '🌱' },
                    };
                    const cfg = p[persona.follow_up_priority] ?? p.nurture;
                    return <span key="p" style={{ borderRadius: 12, padding: '.15rem .6rem', fontSize: '.75rem', fontWeight: 600, color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}>{cfg.icon} {cfg.label}</span>;
                  })()}
                  {persona.engagement_level && (() => {
                    const e: Record<string, { icon: string; color: string }> = {
                      champion: { icon: '👑', color: '#ffd700' },
                      active: { icon: '⚡', color: '#4caf50' },
                      passive: { icon: '💤', color: '#9e9e9e' },
                      lurker: { icon: '👁️', color: '#607d8b' },
                    };
                    const cfg = e[persona.engagement_level];
                    return cfg ? <span key="e" style={{ fontSize: '.8rem', color: cfg.color, background: '#111122', border: '1px solid #1e1e32', borderRadius: 8, padding: '.15rem .5rem' }}>{cfg.icon} {persona.engagement_level}</span> : null;
                  })()}
                  {persona.spending_capacity && persona.spending_capacity !== 'unknown' && (() => {
                    const s: Record<string, { label: string; color: string }> = {
                      high: { label: 'High $$$', color: '#4caf50' },
                      medium: { label: 'Medium $$', color: '#ff9800' },
                      low: { label: 'Low $', color: '#9e9e9e' },
                    };
                    const cfg = s[persona.spending_capacity];
                    return cfg ? <span key="s" style={{ fontSize: '.8rem', color: cfg.color, background: '#111122', border: '1px solid #1e1e32', borderRadius: 8, padding: '.15rem .5rem' }}>{cfg.label}</span> : null;
                  })()}
                </div>
                {persona.buying_intent_score != null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                    <span style={{ fontSize: '.75rem', color: '#8b98a5', flexShrink: 0 }}>Buying intent</span>
                    <div style={{ flex: 1, height: 5, background: '#1e1e32', borderRadius: 3, overflow: 'hidden', maxWidth: 160 }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, (persona.buying_intent_score ?? 0) * 10)}%`,
                        background: (persona.buying_intent_score ?? 0) >= 7 ? '#ff4757' : (persona.buying_intent_score ?? 0) >= 4 ? '#ffa502' : '#5c6bc0',
                        borderRadius: 3,
                      }} />
                    </div>
                    <span style={{ fontSize: '.78rem', fontWeight: 700, color: (persona.buying_intent_score ?? 0) >= 7 ? '#ff4757' : (persona.buying_intent_score ?? 0) >= 4 ? '#ffa502' : (persona.buying_intent_score ?? 0) >= 1 ? '#5c6bc0' : '#555' }}>
                      {persona.buying_intent_score}/10
                    </span>
                  </div>
                )}
              </div>
            )}

            {persona.summary && (
              <div style={{ marginBottom: '1rem' }}>
                <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{personaLabels.summary}</span>
                <p style={{ margin: '0.35rem 0 0', lineHeight: 1.5 }}>{persona.summary}</p>
              </div>
            )}
            {persona.topics && Array.isArray(persona.topics) && persona.topics.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{personaLabels.topics}</span>
                <div style={{ marginTop: '0.35rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {(persona.topics as string[]).map((t) => (
                    <span key={t} className="badge badge-default">{t}</span>
                  ))}
                </div>
              </div>
            )}
            {(persona.inferred_age_range || persona.inferred_occupation || (persona.inferred_goals && (persona.inferred_goals as string[]).length > 0)) && (
              <div style={{ marginBottom: '1rem' }}>
                <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{personaLabels.inferredProfile}</span>
                <div style={{ marginTop: '0.35rem', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                  {persona.inferred_age_range && <span>Age range: {persona.inferred_age_range}</span>}
                  {persona.inferred_occupation && <span>Occupation: {persona.inferred_occupation}</span>}
                  {persona.inferred_goals && Array.isArray(persona.inferred_goals) && (persona.inferred_goals as string[]).length > 0 && (
                    <span>Goals: {(persona.inferred_goals as string[]).join(', ')}</span>
                  )}
                </div>
              </div>
            )}
            {persona.social_links && typeof persona.social_links === 'object' && (
              (persona.social_links.instagram || persona.social_links.twitter || persona.social_links.linkedin || (persona.social_links.other && persona.social_links.other.length > 0)) && (
                <div style={{ marginBottom: '1rem' }}>
                  <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Social links</span>
                  <div style={{ marginTop: '0.35rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                    {persona.social_links.instagram && <span>Instagram: {persona.social_links.instagram}</span>}
                    {persona.social_links.twitter && <span>Twitter: {persona.social_links.twitter}</span>}
                    {persona.social_links.linkedin && <span>LinkedIn: {persona.social_links.linkedin}</span>}
                    {persona.social_links.other && (persona.social_links.other as string[]).map((o) => <span key={o}>{o}</span>)}
                  </div>
                </div>
              )
            )}
            {persona.content_preferences && (
              <div style={{ marginBottom: '1rem' }}>
                <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{personaLabels.contentPreferences}</span>
                <p style={{ margin: '0.35rem 0 0', lineHeight: 1.5 }}>{persona.content_preferences}</p>
              </div>
            )}
            {persona.outreach_approach && (
              <div style={{ marginBottom: '1rem' }}>
                <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Outreach approach</span>
                <p style={{ margin: '0.35rem 0 0', lineHeight: 1.5 }}>💡 {persona.outreach_approach}</p>
              </div>
            )}
            {persona.buying_signals && Array.isArray(persona.buying_signals) && (persona.buying_signals as string[]).length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Buying signals</span>
                <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.25rem', color: '#4caf50' }}>
                  {(persona.buying_signals as string[]).map((s) => <li key={s} style={{ marginBottom: '.15rem' }}>🎯 {s}</li>)}
                </ul>
              </div>
            )}
            {persona.pain_points && Array.isArray(persona.pain_points) && (persona.pain_points as string[]).length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{personaLabels.painPoints}</span>
                <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.25rem' }}>{(persona.pain_points as string[]).map((pp) => <li key={pp}>{pp}</li>)}</ul>
              </div>
            )}
            {persona.objection_patterns && Array.isArray(persona.objection_patterns) && (persona.objection_patterns as string[]).length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Objection patterns</span>
                <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.25rem', color: '#ffa502' }}>
                  {(persona.objection_patterns as string[]).map((o) => <li key={o} style={{ marginBottom: '.15rem' }}>🛡️ {o}</li>)}
                </ul>
              </div>
            )}
            {persona.inference_evidence && (
              <div style={{ marginBottom: '1rem' }}>
                <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{personaLabels.evidence}</span>
                <div style={{ margin: '0.35rem 0 0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{persona.inference_evidence}</div>
              </div>
            )}
            <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginTop: '1rem', marginBottom: 0 }}>
              Last run: {persona.run_at ? formatDate(persona.run_at) : '—'}
              {persona.generated_for_range && ` · Generated for: ${persona.generated_for_range}`}
              {persona.model_used && ` · Model: ${persona.model_used}`}
              {(persona.prompt_tokens != null || persona.completion_tokens != null) && (
                <> · {persona.prompt_tokens ?? 0} in / {persona.completion_tokens ?? 0} out tokens</>
              )}
            </p>
            <button type="button" className="btn btn-secondary" style={{ marginTop: '0.75rem' }} onClick={handleGeneratePersona} disabled={personaGenerating}>
              {personaGenerating ? personaLabels.regenerating : personaLabels.generateBtn}
            </button>
          </>
        )}
      </div>

      {fromId && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1rem' }}>Top 3 relationships</h2>
          <p style={{ color: '#8b98a5', fontSize: '0.8125rem', margin: '0 0 0.75rem' }}>
            Same period and chats as the stats above. Counts: reactions (emoji on messages) and replies (direct replies to a message).
          </p>
          {topRelationshipsLoading && topRelationships.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5' }}>
              <LoadingSpinner size="sm" />
              <span>Loading…</span>
            </div>
          )}
          {!topRelationshipsLoading && topRelationships.length === 0 && (
            <p style={{ color: '#8b98a5', margin: 0 }}>No interactions with other members in the selected chats/range.</p>
          )}
          {topRelationships.map((rel, idx) => {
            const insight = relationshipInsightByKey[rel.otherFromId];
            const loading = relationshipLoadingByKey[rel.otherFromId];
            const generating = relationshipGeneratingByKey[rel.otherFromId];
            const relError = relationshipErrorByKey[rel.otherFromId];
            const isLast = idx === topRelationships.length - 1;
            const profileName = user?.display_name || user?.first_name || user?.from_id || 'This contact';
            return (
              <div key={rel.otherFromId} style={{ marginBottom: isLast ? 0 : '1.25rem', paddingBottom: isLast ? 0 : '1.25rem', borderBottom: isLast ? 'none' : '1px solid #2f3336' }}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.35rem' }}>
                  <a href={`/users/${encodeURIComponent(rel.otherFromId)}`} style={{ fontWeight: 600 }}>
                    {rel.otherDisplayName}
                  </a>
                </div>
                <div style={{ color: '#8b98a5', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>
                  <div><strong>{profileName}</strong> → {rel.otherDisplayName}: {rel.reactionsToThem} reactions, {rel.repliesToThem} replies</div>
                  <div>{rel.otherDisplayName} → <strong>{profileName}</strong>: {rel.reactionsFromThem} reactions, {rel.repliesFromThem} replies</div>
                </div>
                {relError && <p style={{ color: '#f91854', fontSize: '0.875rem', margin: '0.25rem 0 0.5rem' }}>{relError}</p>}
                {loading && !insight && <p style={{ color: '#8b98a5', fontSize: '0.875rem', margin: 0 }}>Loading summary…</p>}
                {!insight && !loading && (
                  <button type="button" className="btn btn-primary" style={{ fontSize: '0.8125rem' }} onClick={() => handleGenerateRelationshipSummary(rel.otherFromId)} disabled={generating}>
                    {generating ? 'Generating…' : 'Generate relationship summary'}
                  </button>
                )}
                {insight && (
                  <>
                    {insight.summary && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Summary</span>
                        <p style={{ margin: '0.35rem 0 0', lineHeight: 1.5 }}>{insight.summary}</p>
                      </div>
                    )}
                    {(insight.tone || insight.mutual_or_one_sided || insight.evolution) && (
                      <div style={{ marginBottom: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.875rem' }}>
                        {insight.tone && <span><strong>Tone:</strong> {insight.tone}</span>}
                        {insight.mutual_or_one_sided && <span><strong>Balance:</strong> {insight.mutual_or_one_sided}</span>}
                        {insight.evolution && <span><strong>Evolution:</strong> {insight.evolution}</span>}
                      </div>
                    )}
                    {insight.inference_evidence && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <span style={{ color: '#8b98a5', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Evidence</span>
                        <div style={{ margin: '0.35rem 0 0', lineHeight: 1.6, whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>{insight.inference_evidence}</div>
                      </div>
                    )}
                    <p style={{ color: '#8b98a5', fontSize: '0.75rem', marginTop: '0.5rem', marginBottom: 0 }}>
                      {insight.run_at ? `Generated ${formatDate(insight.run_at)}` : ''}
                      {insight.generated_for_range && ` · Generated for: ${insight.generated_for_range}`}
                      {insight.model_used && ` · ${insight.model_used}`}
                    </p>
                    <button type="button" className="btn btn-secondary" style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }} onClick={() => handleGenerateRelationshipSummary(rel.otherFromId)} disabled={generating}>
                      {generating ? 'Regenerating…' : 'Regenerate summary'}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="stats-row">
        <div className="kpi-card">
          <div className="value">{user.stats.messagesSent.toLocaleString()}</div>
          <div className="label">Messages sent</div>
        </div>
        <div className="kpi-card">
          <div className="value">{(user.stats.serviceMessages ?? 0).toLocaleString()}</div>
          <div className="label">Service messages</div>
        </div>
        <div className="kpi-card">
          <div className="value">{user.stats.reactionsGiven.toLocaleString()}</div>
          <div className="label">Reactions given</div>
        </div>
        <div className="kpi-card">
          <div className="value">{user.stats.reactionsReceived.toLocaleString()}</div>
          <div className="label">Reactions received</div>
        </div>
        <div className="kpi-card">
          <div className="value">{(user.stats.reactionsRatio ?? 0)}</div>
          <div className="label">Reactions / message ratio</div>
        </div>
        <div className="kpi-card">
          <div className="value">{(user.stats.totalWords ?? 0).toLocaleString()}</div>
          <div className="label">Total words</div>
        </div>
        <div className="kpi-card">
          <div className="value">{(user.stats.totalChars ?? 0).toLocaleString()}</div>
          <div className="label">Total characters</div>
        </div>
        <div className="kpi-card">
          <div className="value">{(user.stats.activeDays ?? 0).toLocaleString()}</div>
          <div className="label">Active days</div>
        </div>
        <div className="kpi-card">
          <div className="value">{(user.stats.photos ?? 0)}</div>
          <div className="label">Photos</div>
        </div>
        <div className="kpi-card">
          <div className="value">{(user.stats.videos ?? 0)}</div>
          <div className="label">Videos</div>
        </div>
        <div className="kpi-card">
          <div className="value">{(user.stats.messagesEdited ?? 0)}</div>
          <div className="label">Messages edited</div>
        </div>
        <div className="kpi-card">
          <div className="value">{(user.stats.replies ?? 0)}</div>
          <div className="label">Replies</div>
        </div>
      </div>
      {(user.stats.topReactedToName || user.stats.topReactedToId) && user.stats.topReactedToId && (
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Most reactions given to: <a href={`/users/${encodeURIComponent(user.stats.topReactedToId)}`}>{user.stats.topReactedToName || user.stats.topReactedToId}</a>
        </p>
      )}

      <div className="card">
        <h2>Messages over time (this user)</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>
          Click a point to see messages for that period. All dates in range are shown.
        </p>
        <div className="chart-container">
          {messagesChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={messagesChartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2f3336" />
                <XAxis dataKey="periodLabel" stroke="#8b98a5" fontSize={12} />
                <YAxis stroke="#8b98a5" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#16181c', border: '1px solid #2f3336', borderRadius: 8 }}
                  labelStyle={{ color: '#e7e9ea' }}
                  formatter={(value: number) => [value, 'Messages']}
                  labelFormatter={(label) => label}
                />
                {byChatMessages.length > 0 ? (
                  byChatMessages.map((c) => (
                    <Area
                      key={c.chatId}
                      type="monotone"
                      dataKey={c.slug}
                      name={c.chatName}
                      stroke={chatIdToColor(c.chatId)}
                      fill={chatIdToColor(c.chatId)}
                      fillOpacity={0.3}
                      dot={{ r: 5, cursor: 'pointer' }}
                      activeDot={{
                        r: 12,
                        cursor: 'pointer',
                        onClick: (_e: unknown, payload: unknown) => {
                          const p = (payload as { payload?: Record<string, unknown> })?.payload ?? (payload as Record<string, unknown>);
                          if (p?.period != null) setModalPoint({
                            period: p.period as string,
                            periodLabel: (p.periodLabel as string) ?? formatPeriod(p.period as string),
                            count: Number(p.count) ?? 0,
                            type: 'messages',
                            chatId: c.chatId,
                            chatName: c.chatName,
                          });
                        },
                      }}
                    />
                  ))
                ) : (
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#1d9bf0"
                    fill="#1d9bf0"
                    fillOpacity={0.3}
                    dot={{ r: 5, cursor: 'pointer' }}
                    activeDot={{
                      r: 12,
                      cursor: 'pointer',
                      onClick: (_e: unknown, payload: unknown) => {
                        const p = (payload as { payload?: { period?: string; periodLabel?: string; count?: number } })?.payload ?? (payload as { period?: string; periodLabel?: string; count?: number });
                        if (p?.period != null) setModalPoint({
                          period: p.period,
                          periodLabel: p.periodLabel ?? formatPeriod(p.period),
                          count: p.count ?? 0,
                          type: 'messages',
                        });
                      },
                    }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b98a5' }}>
              No message data for this range.
            </div>
          )}
        </div>
        {byChatMessages.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #2f3336', fontSize: '0.8125rem', color: '#8b98a5' }}>
            {byChatMessages.map((c) => (
              <span key={c.chatId} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ width: 12, height: 12, borderRadius: 2, background: chatIdToColor(c.chatId), flexShrink: 0 }} aria-hidden />
                <span style={{ color: '#e7e9ea' }}>{c.chatName}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Reactions over time (this user)</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>
          Click a point to see reactions for that period. All dates in range are shown.
        </p>
        <div className="chart-container">
          {reactionsChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={reactionsChartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2f3336" />
                <XAxis dataKey="periodLabel" stroke="#8b98a5" fontSize={12} />
                <YAxis stroke="#8b98a5" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#16181c', border: '1px solid #2f3336', borderRadius: 8 }}
                  labelStyle={{ color: '#e7e9ea' }}
                  formatter={(value: number) => [value, 'Reactions']}
                  labelFormatter={(label) => label}
                />
                {byChatReactions.length > 0 ? (
                  byChatReactions.map((c) => (
                    <Area
                      key={c.chatId}
                      type="monotone"
                      dataKey={c.slug}
                      name={c.chatName}
                      stroke={chatIdToColor(c.chatId)}
                      fill={chatIdToColor(c.chatId)}
                      fillOpacity={0.3}
                      dot={{ r: 5, cursor: 'pointer' }}
                      activeDot={{
                        r: 12,
                        cursor: 'pointer',
                        onClick: (_e: unknown, payload: unknown) => {
                          const p = (payload as { payload?: Record<string, unknown> })?.payload ?? (payload as Record<string, unknown>);
                          if (p?.period != null) setModalPoint({
                            period: p.period as string,
                            periodLabel: (p.periodLabel as string) ?? formatPeriod(p.period as string),
                            count: Number(p.count) ?? 0,
                            type: 'reactions',
                            chatId: c.chatId,
                            chatName: c.chatName,
                          });
                        },
                      }}
                    />
                  ))
                ) : (
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#00ba7c"
                    fill="#00ba7c"
                    fillOpacity={0.3}
                    dot={{ r: 5, cursor: 'pointer' }}
                    activeDot={{
                      r: 12,
                      cursor: 'pointer',
                      onClick: (_e: unknown, payload: unknown) => {
                        const p = (payload as { payload?: { period?: string; periodLabel?: string; count?: number } })?.payload ?? (payload as { period?: string; periodLabel?: string; count?: number });
                        if (p?.period != null) setModalPoint({
                          period: p.period,
                          periodLabel: p.periodLabel ?? formatPeriod(p.period),
                          count: p.count ?? 0,
                          type: 'reactions',
                        });
                      },
                    }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b98a5' }}>
              No reaction data for this range.
            </div>
          )}
        </div>
        {byChatReactions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #2f3336', fontSize: '0.8125rem', color: '#8b98a5' }}>
            {byChatReactions.map((c) => (
              <span key={c.chatId} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ width: 12, height: 12, borderRadius: 2, background: chatIdToColor(c.chatId), flexShrink: 0 }} aria-hidden />
                <span style={{ color: '#e7e9ea' }}>{c.chatName}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>CRM &amp; follow-up</h2>
        <div className="form-group">
          <div className="toggle-wrap">
            <input
              type="checkbox"
              id="is_premium"
              checked={user.is_premium}
              onChange={(e) => handlePatch({ is_premium: e.target.checked })}
              disabled={saving}
            />
            <label htmlFor="is_premium">In Premium</label>
          </div>
        </div>
        <div className="form-group">
          <label>Assigned to</label>
          <input
            type="text"
            value={user.assigned_to ?? ''}
            onChange={(e) => setUser((u) => (u ? { ...u, assigned_to: e.target.value || null } : null))}
            onBlur={() => handlePatch({ assigned_to: user.assigned_to ?? '' })}
            placeholder="Operator name"
          />
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea
            value={user.notes ?? ''}
            onChange={(e) => setUser((u) => (u ? { ...u, notes: e.target.value || null } : null))}
            onBlur={() => handlePatch({ notes: user.notes ?? '' })}
            placeholder="Free-form notes about this contact"
          />
        </div>
      </div>

      <div className="card">
        <h2>Calls (upsell follow-up)</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Log calls 1–10 with notes, objections, and plans discussed.
        </p>
        {!showCallForm ? (
          <button type="button" className="btn" onClick={() => setShowCallForm(true)} disabled={user.calls.length >= 10}>
            Log call
          </button>
        ) : (
          <form onSubmit={handleSubmitCall}>
            <div className="form-group">
              <label>Call number (1–10)</label>
              <select
                value={callForm.call_number}
                onChange={(e) => setCallForm((f) => ({ ...f, call_number: Number(e.target.value) }))}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n} disabled={usedCallNumbers.includes(n)}>
                    Call {n} {usedCallNumbers.includes(n) ? '(already logged)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Notes (what was discussed)</label>
              <textarea
                value={callForm.notes}
                onChange={(e) => setCallForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="What was discussed in the call"
              />
            </div>
            <div className="form-group">
              <label>Objections</label>
              <textarea
                value={callForm.objections}
                onChange={(e) => setCallForm((f) => ({ ...f, objections: e.target.value }))}
                placeholder="Why they haven't joined Premium / payment concerns"
              />
            </div>
            <div className="form-group">
              <label>Plans discussed</label>
              <textarea
                value={callForm.plans_discussed}
                onChange={(e) => setCallForm((f) => ({ ...f, plans_discussed: e.target.value }))}
                placeholder="Payment plans, offers, etc."
              />
            </div>
            <div className="form-group">
              <label>Created by</label>
              <input
                type="text"
                value={callForm.created_by}
                onChange={(e) => setCallForm((f) => ({ ...f, created_by: e.target.value }))}
                placeholder="Operator name"
              />
            </div>
            <button type="submit" className="btn" disabled={saving}>Save call</button>
            <button type="button" className="btn btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={() => setShowCallForm(false)}>
              Cancel
            </button>
          </form>
        )}

        <ul className="calls-list" style={{ marginTop: '1.5rem' }}>
          {user.calls.map((c) => (
            <li key={c.id}>
              <div className="call-meta">
                Call {c.call_number} · {formatDate(c.called_at)} · {c.created_by || '—'}
              </div>
              {c.notes && <p style={{ margin: '0.35rem 0', fontSize: '0.875rem' }}><strong>Notes:</strong> {c.notes}</p>}
              {c.objections && <p style={{ margin: '0.35rem 0', fontSize: '0.875rem' }}><strong>Objections:</strong> {c.objections}</p>}
              {c.plans_discussed && <p style={{ margin: '0.35rem 0', fontSize: '0.875rem' }}><strong>Plans discussed:</strong> {c.plans_discussed}</p>}
            </li>
          ))}
        </ul>
        {user.calls.length === 0 && !showCallForm && (
          <p style={{ color: '#8b98a5', marginTop: '1rem', fontSize: '0.875rem' }}>No calls logged yet.</p>
        )}
      </div>

      <div className="card">
        <h2>Reactions given (who they react to)</h2>
        {fromId ? <ReactionsGivenList fromId={fromId} chatIds={profileChatIds.length > 0 ? profileChatIds : undefined} initialData={profileChatIds.length === 0 ? _reactionsGiven : null} /> : <p style={{ color: '#8b98a5' }}>No Telegram ID yet (list-only contact). Stats and lists will appear after they interact and you re-import.</p>}
      </div>

      <div className="card">
        <h2>Recent messages</h2>
        {fromId ? <UserMessagesList fromId={fromId} chatIds={profileChatIds.length > 0 ? profileChatIds : undefined} initialMessages={profileChatIds.length === 0 ? _recentMsgs : null} /> : null}
      </div>

      {modalPoint && (
        <div className="modal-backdrop" onClick={() => setModalPoint(null)} role="presentation">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modalPoint.type === 'reactions' ? 'Reactions' : 'Messages'}: {modalPoint.periodLabel}{modalPoint.chatName ? ` — ${modalPoint.chatName}` : ''}</h3>
              <button type="button" className="modal-close" onClick={() => setModalPoint(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              {modalPoint.chatName && (
                <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#8b98a5' }}>
                  Chat: <strong style={{ color: '#e7e9ea' }}>{modalPoint.chatName}</strong>
                </p>
              )}
              {modalPoint.type === 'messages' ? (
                periodDetailLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5' }}>
                    <LoadingSpinner size="sm" />
                    <span>Loading…</span>
                  </div>
                ) : periodDetail ? (
                  <>
                    <section>
                      <strong>{periodDetail.count.toLocaleString()}</strong> message{periodDetail.count !== 1 ? 's' : ''} in this period.
                    </section>
                    <section>
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>AI insight — why this day?</h4>
                      {dayInsightError && (
                        <p style={{ color: '#f91854', fontSize: '0.875rem', marginBottom: '0.5rem', background: 'rgba(249,24,84,0.1)', padding: '0.5rem', borderRadius: 6 }} role="alert">
                          {dayInsightError}
                        </p>
                      )}
                      {dayInsightLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5', fontSize: '0.875rem' }}>
                          <LoadingSpinner size="sm" />
                          <span>Loading…</span>
                        </div>
                      ) : dayInsight ? (
                        <>
                          <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 0.5rem', fontSize: '0.875rem' }}>{dayInsight.summary}</p>
                          <p style={{ color: '#8b98a5', fontSize: '0.75rem', margin: 0 }}>
                            Analysis for this contact on this day.
                            {(dayInsight.prompt_tokens != null || dayInsight.completion_tokens != null) && (
                              <> · {dayInsight.prompt_tokens ?? 0} in / {dayInsight.completion_tokens ?? 0} out tokens</>
                            )}
                            {dayInsight.run_at && <> · {new Date(dayInsight.run_at).toLocaleString('en-US')}</>}
                          </p>
                        </>
                      ) : (
                        <div>
                          <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                            Generate an AI analysis of why this contact had activity this day.
                          </p>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={dayInsightGenerating}
                            onClick={async () => {
                              if (!modalPoint) return;
                              setDayInsightError(null);
                              setDayInsightGenerating(true);
                              try {
                                const { start: ps, end: pe } = periodBounds(modalPoint.period, groupBy);
                                const params = new URLSearchParams({ start: ps, end: pe });
                                const chatIdsToUse = modalPoint.chatId != null ? [modalPoint.chatId] : profileChatIds;
                                chatIdsToUse.forEach((id) => params.append('chatId', String(id)));
                                const fid = user?.from_id ?? null;
                                if (fid) params.set('fromId', fid);
                                const res = await fetch(`/api/stats/day-insight?${params}`, { method: 'POST' });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data.error || 'Failed to generate');
                                setDayInsight(data.insight ?? null);
                              } catch (e) {
                                setDayInsight(null);
                                setDayInsightError(e instanceof Error ? e.message : 'Failed to generate');
                              } finally {
                                setDayInsightGenerating(false);
                              }
                            }}
                          >
                            {dayInsightGenerating ? 'Generating…' : 'Generate insight'}
                          </button>
                        </div>
                      )}
                    </section>
                    {periodDetail.byUser.length > 0 && (
                      <section>
                        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>By user</h4>
                        <table className="by-user-table">
                          <thead>
                            <tr><th>User</th><th>Messages</th></tr>
                          </thead>
                          <tbody>
                            {periodDetail.byUser.map((u) => (
                              <tr key={u.from_id}>
                                <td>{u.display_name || u.from_id}</td>
                                <td>{u.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </section>
                    )}
                    {periodDetail.recentMessages.length > 0 && (
                      <section>
                        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>Messages (scroll to see all)</h4>
                        {periodDetail.recentMessages.map((m, i) => (
                          <div key={i} className="recent-msg">
                            <div className="meta">
                              {m.date ? new Date(m.date).toLocaleString('en-US') : ''} · {m.display_name || m.from_id || '—'}
                            </div>
                            <div className="text">{(m.text || '').slice(0, 200)}{(m.text && m.text.length > 200) ? '…' : ''}</div>
                          </div>
                        ))}
                      </section>
                    )}
                  </>
                ) : (
                  <p style={{ color: '#8b98a5' }}>Could not load period details.</p>
                )
              ) : (
                periodReactionsLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5' }}>
                    <LoadingSpinner size="sm" />
                    <span>Loading…</span>
                  </div>
                ) : periodReactionsDetail ? (
                  <>
                    <section>
                      <strong>{periodReactionsDetail.count.toLocaleString()}</strong> reaction{periodReactionsDetail.count !== 1 ? 's' : ''} in this period.
                    </section>
                    <section>
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>AI insight — why this day?</h4>
                      {dayInsightError && (
                        <p style={{ color: '#f91854', fontSize: '0.875rem', marginBottom: '0.5rem', background: 'rgba(249,24,84,0.1)', padding: '0.5rem', borderRadius: 6 }} role="alert">
                          {dayInsightError}
                        </p>
                      )}
                      {dayInsightLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5', fontSize: '0.875rem' }}>
                          <LoadingSpinner size="sm" />
                          <span>Loading…</span>
                        </div>
                      ) : dayInsight ? (
                        <>
                          <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 0.5rem', fontSize: '0.875rem' }}>{dayInsight.summary}</p>
                          <p style={{ color: '#8b98a5', fontSize: '0.75rem', margin: 0 }}>
                            Analysis for this contact on this day.
                            {(dayInsight.prompt_tokens != null || dayInsight.completion_tokens != null) && (
                              <> · {dayInsight.prompt_tokens ?? 0} in / {dayInsight.completion_tokens ?? 0} out tokens</>
                            )}
                            {dayInsight.run_at && <> · {new Date(dayInsight.run_at).toLocaleString('en-US')}</>}
                          </p>
                        </>
                      ) : (
                        <div>
                          <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                            Generate an AI analysis of why this contact had activity this day.
                          </p>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={dayInsightGenerating}
                            onClick={async () => {
                              if (!modalPoint) return;
                              setDayInsightError(null);
                              setDayInsightGenerating(true);
                              try {
                                const { start: ps, end: pe } = periodBounds(modalPoint.period, groupBy);
                                const params = new URLSearchParams({ start: ps, end: pe });
                                const chatIdsToUse = modalPoint.chatId != null ? [modalPoint.chatId] : profileChatIds;
                                chatIdsToUse.forEach((id) => params.append('chatId', String(id)));
                                const fid = user?.from_id ?? null;
                                if (fid) params.set('fromId', fid);
                                const res = await fetch(`/api/stats/day-insight?${params}`, { method: 'POST' });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data.error || 'Failed to generate');
                                setDayInsight(data.insight ?? null);
                              } catch (e) {
                                setDayInsight(null);
                                setDayInsightError(e instanceof Error ? e.message : 'Failed to generate');
                              } finally {
                                setDayInsightGenerating(false);
                              }
                            }}
                          >
                            {dayInsightGenerating ? 'Generating…' : 'Generate insight'}
                          </button>
                        </div>
                      )}
                    </section>
                    {periodReactionsDetail.recentReactions.length > 0 && (
                      <section>
                        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>Reactions (scroll to see all)</h4>
                        {periodReactionsDetail.recentReactions.map((r, i) => (
                          <div key={i} className="recent-msg">
                            <div className="meta">
                              {r.reacted_at ? new Date(r.reacted_at).toLocaleString('en-US') : ''} · {r.reactor_name || r.reactor_from_id} reacted {r.emoji ?? '❤️'}
                            </div>
                            <div className="text">
                              {r.message_author_name || r.message_author_id || '—'}: {(r.message_text || '').slice(0, 200)}{(r.message_text && r.message_text.length > 200) ? '…' : ''}
                            </div>
                          </div>
                        ))}
                      </section>
                    )}
                  </>
                ) : (
                  <p style={{ color: '#8b98a5' }}>Could not load period reactions.</p>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReactionsGivenList({ fromId, chatIds, initialData }: { fromId: string; chatIds?: number[]; initialData?: { chatId: number; chatName: string | null; chatSlug: string | null; receiverFromId: string; receiverName: string | null; count: number }[] | null }) {
  const [list, setList] = useState<{ chatId: number; chatName: string | null; chatSlug: string | null; receiverFromId: string; receiverName: string | null; count: number }[]>(initialData ?? []);
  useEffect(() => {
    // If data was seeded by /full and chat filter hasn't changed, skip network request
    if (initialData && (!chatIds || chatIds.length === 0)) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (chatIds?.length) chatIds.forEach((id) => params.append('chatId', String(id)));
    fetch(`/api/users/${encodeURIComponent(fromId)}/reactions-given?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then(setList)
      .catch((e) => { if (!(e instanceof DOMException && e.name === 'AbortError')) setList([]); });
    return () => controller.abort();
  }, [fromId, chatIds]);
  if (list.length === 0) return <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>No reactions given.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Chat</th><th>User</th><th>Reactions given</th><th></th></tr>
        </thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={`${r.chatId}-${r.receiverFromId}-${i}`}>
              <td style={{ color: '#8b98a5', fontSize: '0.8125rem' }}>{r.chatName || r.chatSlug || r.chatId}</td>
              <td>{r.receiverName || r.receiverFromId}</td>
              <td>{r.count}</td>
              <td><a href={`/users/${encodeURIComponent(r.receiverFromId)}`}>View profile</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserMessagesList({ fromId, chatIds, initialMessages }: { fromId: string; chatIds?: number[]; initialMessages?: { date: string; text: string | null; chat_id?: number; chat_name?: string | null; chat_slug?: string | null }[] | null }) {
  const [data, setData] = useState<{ messages: { date: string; text: string | null; chat_id?: number; chat_name?: string | null; chat_slug?: string | null }[] } | null>(
    initialMessages ? { messages: initialMessages } : null
  );
  useEffect(() => {
    // If seeded by /full and no extra chat filter, skip fetch
    if (initialMessages && (!chatIds || chatIds.length === 0)) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: '15' });
    if (chatIds?.length) chatIds.forEach((id) => params.append('chatId', String(id)));
    fetch(`/api/users/${encodeURIComponent(fromId)}/messages?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch((e) => { if (!(e instanceof DOMException && e.name === 'AbortError')) setData(null); });
    return () => controller.abort();
  }, [fromId, chatIds]);
  if (!data) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5', fontSize: '0.875rem' }}>
      <LoadingSpinner size="sm" />
      <span>Loading…</span>
    </div>
  );
  if (data.messages.length === 0) return <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>No messages.</p>;
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {data.messages.map((m, i) => (
        <li key={i} style={{ borderBottom: '1px solid #2f3336', padding: '0.75rem 0' }}>
          <div style={{ fontSize: '0.8125rem', color: '#8b98a5', marginBottom: '0.25rem' }}>
            {new Date(m.date).toLocaleString('en-US')}
            {(m.chat_name ?? m.chat_slug) && (
              <span style={{ marginLeft: '0.5rem' }}> · {(m.chat_name ?? m.chat_slug) ?? m.chat_id}</span>
            )}
          </div>
          <div style={{ fontSize: '0.875rem' }}>{(m.text || '').slice(0, 300)}{(m.text && m.text.length > 300) ? '…' : ''}</div>
        </li>
      ))}
    </ul>
  );
}
