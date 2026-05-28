'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PersonaRow {
  id: number;
  from_id: number;
  display_name: string;
  username: string | null;
  is_premium: boolean;
  profile_photo_urls: string[] | null;
  is_current_member: boolean;
  summary: string | null;
  topics: string[] | null;
  inferred_age_range: string | null;
  inferred_occupation: string | null;
  inferred_goals: string[] | null;
  pain_points: string[] | null;
  content_preferences: string | null;
  run_at: string;
  buying_intent_score: number;
  buying_signals: string[] | null;
  follow_up_priority: string | null;
  engagement_level: string | null;
  outreach_approach: string | null;
  objection_patterns: string[] | null;
  spending_capacity: string | null;
}

interface BatchStatus {
  status: 'idle' | 'running' | 'done' | 'aborted' | 'error';
  filter?: string;
  total: number;
  processed: number;
  failed: number;
  remaining?: number;
  started_at?: string;
  finished_at?: string;
  logs?: Array<{ ts: number; userId: number; name: string; success: boolean; error?: string }>;
}

type ViewMode = 'pipeline' | 'grid' | 'table';
type BatchFilter = 'no_persona' | 'all' | 'premium';
type SortKey = 'buying_intent_score' | 'display_name' | 'engagement_level' | 'spending_capacity';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  hot:     { label: 'Hot',     color: '#ff4757', bg: 'rgba(255,71,87,.12)',   border: 'rgba(255,71,87,.35)',   icon: '🔥' },
  warm:    { label: 'Warm',    color: '#ffa502', bg: 'rgba(255,165,2,.12)',   border: 'rgba(255,165,2,.35)',   icon: '⚡' },
  cold:    { label: 'Cold',    color: '#5c6bc0', bg: 'rgba(92,107,192,.12)',  border: 'rgba(92,107,192,.35)',  icon: '❄️' },
  nurture: { label: 'Nurture', color: '#78909c', bg: 'rgba(120,144,156,.12)', border: 'rgba(120,144,156,.35)', icon: '🌱' },
};

const ENGAGEMENT_CONFIG: Record<string, { icon: string; color: string }> = {
  champion: { icon: '👑', color: '#ffd700' },
  active:   { icon: '⚡', color: '#4caf50' },
  passive:  { icon: '💤', color: '#9e9e9e' },
  lurker:   { icon: '👁️',  color: '#607d8b' },
};

const SPENDING_CONFIG: Record<string, { label: string; color: string }> = {
  high:    { label: 'High $$$', color: '#4caf50' },
  medium:  { label: 'Medium $$', color: '#ff9800' },
  low:     { label: 'Low $',    color: '#9e9e9e' },
  unknown: { label: 'Unknown',  color: '#607d8b' },
};

const TOPIC_COLORS = ['#7c6af7','#60a5fa','#34d399','#fb923c','#f472b6','#facc15','#a78bfa','#38bdf8','#4ade80','#f87171','#e879f9','#22d3ee'];

function intentColor(score: number): string {
  if (score >= 7) return '#ff4757';
  if (score >= 4) return '#ffa502';
  if (score >= 1) return '#5c6bc0';
  return '#444';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ value, label, sub, color }: { value: string | number; label: string; sub?: string; color?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={color ? { color } : undefined}>{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function Avatar({ row }: { row: PersonaRow }) {
  const url = row.profile_photo_urls?.[0];
  if (url) return <img src={url} alt={row.display_name} className="avatar" />;
  const initials = row.display_name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
  const engCfg = ENGAGEMENT_CONFIG[row.engagement_level ?? 'passive'];
  return (
    <div className="avatar avatar-fallback" style={{ background: `${engCfg?.color ?? '#444'}22`, color: engCfg?.color ?? '#888' }}>
      {initials}
    </div>
  );
}

function IntentBar({ score }: { score: number }) {
  const pct = Math.min(100, score * 10);
  const color = intentColor(score);
  return (
    <div className="intent-bar-wrap" title={`Buying intent: ${score}/10`}>
      <div className="intent-bar-track">
        <div className="intent-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="intent-score" style={{ color }}>{score}/10</span>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string | null }) {
  const cfg = PRIORITY_CONFIG[priority ?? 'nurture'] ?? PRIORITY_CONFIG.nurture;
  return (
    <span className="priority-badge" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function TopicPill({ topic, highlight }: { topic: string; highlight?: boolean }) {
  return (
    <span className={`topic-pill${highlight ? ' hl' : ''}`}>{topic}</span>
  );
}

// ─── Pipeline Card ────────────────────────────────────────────────────────────

function PipelineCard({ row, highlightTopics, onInfo }: { row: PersonaRow; highlightTopics: Set<string>; onInfo: (row: PersonaRow) => void }) {
  const cfg = PRIORITY_CONFIG[row.follow_up_priority ?? 'nurture'] ?? PRIORITY_CONFIG.nurture;
  const engCfg = ENGAGEMENT_CONFIG[row.engagement_level ?? 'passive'];
  return (
    <div className="pipeline-card" style={{ borderColor: cfg.border, '--card-bg': cfg.bg, cursor: 'pointer' } as React.CSSProperties} onClick={() => { window.location.href = `/users/${row.from_id}`; }}>
      <div className="pc-header">
        <Avatar row={row} />
        <div className="pc-identity">
          <div className="pc-name">
            {row.display_name}
            {row.is_premium && <span className="premium-star" title="Premium">★</span>}
          </div>
          {row.inferred_occupation && <div className="pc-occupation">{row.inferred_occupation}</div>}
        </div>
        <div className="pc-header-right">
          {engCfg && (
            <span className="eng-icon" title={`Engagement: ${row.engagement_level}`} style={{ color: engCfg.color }}>
              {engCfg.icon}
            </span>
          )}
          <button className="card-info-btn" onClick={(e) => { e.stopPropagation(); onInfo(row); }} title="Quick info">ⓘ</button>
        </div>
      </div>

      <IntentBar score={row.buying_intent_score} />

      {(row.topics ?? []).length > 0 && (
        <div className="pc-topics">
          {(row.topics ?? []).slice(0, 4).map((t) => (
            <TopicPill key={t} topic={t} highlight={highlightTopics.has(t)} />
          ))}
        </div>
      )}

      {row.outreach_approach && (
        <div className="pc-approach">
          <span className="approach-icon">💡</span>
          <span>{row.outreach_approach.slice(0, 110)}{row.outreach_approach.length > 110 ? '…' : ''}</span>
        </div>
      )}

      {(row.buying_signals ?? []).length > 0 && (
        <div className="pc-signals">
          {(row.buying_signals ?? []).slice(0, 2).map((s, i) => (
            <div key={i} className="signal-item">🎯 {s}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineColumn({ priority, rows, highlightTopics, onInfo }: { priority: string; rows: PersonaRow[]; highlightTopics: Set<string>; onInfo: (row: PersonaRow) => void }) {
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.nurture;
  return (
    <div className="pipeline-col">
      <div className="pipeline-col-header" style={{ color: cfg.color, borderColor: cfg.border }}>
        <span>{cfg.icon} {cfg.label}</span>
        <span className="pipeline-count">{rows.length}</span>
      </div>
      <div className="pipeline-cards">
        {rows.map((r) => <PipelineCard key={r.id} row={r} highlightTopics={highlightTopics} onInfo={onInfo} />)}
        {rows.length === 0 && <div className="pipeline-empty">No contacts</div>}
      </div>
    </div>
  );
}

// ─── Grid Card ────────────────────────────────────────────────────────────────

function GridCard({ row, highlightTopics, onInfo }: { row: PersonaRow; highlightTopics: Set<string>; onInfo: (row: PersonaRow) => void }) {
  return (
    <div className="grid-card" onClick={() => { window.location.href = `/users/${row.from_id}`; }}>
      <div className="gc-top">
        <Avatar row={row} />
        <div className="gc-identity">
          <div className="gc-name">
            {row.display_name}
            {row.is_premium && <span className="premium-star">★</span>}
          </div>
          {row.username && <div className="gc-username">@{row.username}</div>}
          {row.inferred_occupation && <div className="gc-occupation">{row.inferred_occupation}</div>}
        </div>
        <div className="gc-top-actions">
          <PriorityBadge priority={row.follow_up_priority} />
          <button className="card-info-btn" onClick={(e) => { e.stopPropagation(); onInfo(row); }} title="Quick info">ⓘ</button>
        </div>
      </div>

      <IntentBar score={row.buying_intent_score} />

      {row.summary && <p className="gc-summary">{row.summary}</p>}

      {(row.topics ?? []).length > 0 && (
        <div className="gc-topics">
          {(row.topics ?? []).slice(0, 5).map((t) => (
            <TopicPill key={t} topic={t} highlight={highlightTopics.has(t)} />
          ))}
        </div>
      )}

      <div className="gc-meta">
        {row.engagement_level && (
          <span style={{ color: ENGAGEMENT_CONFIG[row.engagement_level]?.color ?? '#888' }}>
            {ENGAGEMENT_CONFIG[row.engagement_level]?.icon} {row.engagement_level}
          </span>
        )}
        {row.spending_capacity && row.spending_capacity !== 'unknown' && (
          <span style={{ color: SPENDING_CONFIG[row.spending_capacity]?.color ?? '#888' }}>
            {SPENDING_CONFIG[row.spending_capacity]?.label}
          </span>
        )}
        {row.inferred_age_range && <span>{row.inferred_age_range}</span>}
      </div>

      {row.outreach_approach && (
        <div className="gc-approach">💡 {row.outreach_approach.slice(0, 130)}{row.outreach_approach.length > 130 ? '…' : ''}</div>
      )}
    </div>
  );
}

// ─── Table View ───────────────────────────────────────────────────────────────

function TableView({ rows }: { rows: PersonaRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('buying_intent_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let va: string | number = a[sortKey] ?? '';
      let vb: string | number = b[sortKey] ?? '';
      if (sortKey === 'buying_intent_score') { va = Number(va); vb = Number(vb); }
      const cmp = typeof va === 'number' ? (va as number) - (vb as number) : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  function SortTh({ label, k }: { label: string; k: SortKey }) {
    return (
      <th onClick={() => toggleSort(k)} className="sortable-th">
        {label} {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
      </th>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <SortTh label="Intent" k="buying_intent_score" />
            <th>Priority</th>
            <SortTh label="Engagement" k="engagement_level" />
            <SortTh label="Spending" k="spending_capacity" />
            <th>Occupation</th>
            <th>Topics</th>
            <th>Outreach approach</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.id} className="data-row" onClick={() => { window.location.href = `/users/${row.from_id}`; }}>
              <td>
                <div className="td-name">
                  <Avatar row={row} />
                  <div>
                    <div className="td-display-name">{row.display_name}{row.is_premium && <span className="premium-star">★</span>}</div>
                    {row.username && <div className="td-username">@{row.username}</div>}
                  </div>
                </div>
              </td>
              <td>
                <div className="td-intent">
                  <span style={{ color: intentColor(row.buying_intent_score), fontWeight: 700 }}>{row.buying_intent_score}</span>
                  <span className="intent-max">/10</span>
                </div>
              </td>
              <td><PriorityBadge priority={row.follow_up_priority} /></td>
              <td>
                {row.engagement_level && (
                  <span style={{ color: ENGAGEMENT_CONFIG[row.engagement_level]?.color ?? '#888' }}>
                    {ENGAGEMENT_CONFIG[row.engagement_level]?.icon} {row.engagement_level}
                  </span>
                )}
              </td>
              <td>
                {row.spending_capacity && (
                  <span style={{ color: SPENDING_CONFIG[row.spending_capacity]?.color ?? '#888', fontSize: '.8rem' }}>
                    {SPENDING_CONFIG[row.spending_capacity]?.label ?? row.spending_capacity}
                  </span>
                )}
              </td>
              <td className="td-occ">{row.inferred_occupation ?? '—'}</td>
              <td>
                <div className="td-topics">
                  {(row.topics ?? []).slice(0, 3).map((t) => <TopicPill key={t} topic={t} />)}
                </div>
              </td>
              <td className="td-approach">{row.outreach_approach ? row.outreach_approach.slice(0, 90) + (row.outreach_approach.length > 90 ? '…' : '') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Persona Info Modal ───────────────────────────────────────────────────────

function PersonaInfoModal({ row, onClose }: { row: PersonaRow; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const engCfg = ENGAGEMENT_CONFIG[row.engagement_level ?? ''];

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box persona-modal">
        <div className="modal-header">
          <div className="pm-title-row">
            <Avatar row={row} />
            <div style={{ minWidth: 0 }}>
              <div className="pm-name">
                {row.display_name}
                {row.is_premium && <span className="premium-star">★</span>}
              </div>
              {row.username && <div className="pm-username">@{row.username}</div>}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="pm-body">
          <div className="pm-signals-row">
            <PriorityBadge priority={row.follow_up_priority} />
            {engCfg && (
              <span className="pm-chip" style={{ color: engCfg.color }}>
                {engCfg.icon} {row.engagement_level}
              </span>
            )}
            {row.spending_capacity && row.spending_capacity !== 'unknown' && (
              <span className="pm-chip" style={{ color: SPENDING_CONFIG[row.spending_capacity]?.color ?? '#888' }}>
                {SPENDING_CONFIG[row.spending_capacity]?.label ?? row.spending_capacity}
              </span>
            )}
            {row.inferred_age_range && <span className="pm-chip">{row.inferred_age_range}</span>}
          </div>

          {row.inferred_occupation && (
            <div style={{ fontSize: '.8rem', color: '#7c6af7', marginBottom: '.25rem' }}>{row.inferred_occupation}</div>
          )}

          <IntentBar score={row.buying_intent_score} />

          {row.summary && (
            <div className="pm-section">
              <div className="pm-section-label">Summary</div>
              <p className="pm-text">{row.summary}</p>
            </div>
          )}

          {(row.topics ?? []).length > 0 && (
            <div className="pm-section">
              <div className="pm-section-label">Topics</div>
              <div className="pm-chips">
                {(row.topics ?? []).map((t) => <TopicPill key={t} topic={t} />)}
              </div>
            </div>
          )}

          {row.outreach_approach && (
            <div className="pm-section">
              <div className="pm-section-label">Outreach approach</div>
              <p className="pm-text">💡 {row.outreach_approach}</p>
            </div>
          )}

          {(row.buying_signals ?? []).length > 0 && (
            <div className="pm-section">
              <div className="pm-section-label">Buying signals</div>
              {(row.buying_signals ?? []).map((s, i) => (
                <div key={i} className="pm-list-item" style={{ color: '#4caf50' }}>🎯 {s}</div>
              ))}
            </div>
          )}

          {(row.inferred_goals ?? []).length > 0 && (
            <div className="pm-section">
              <div className="pm-section-label">Goals</div>
              <div className="pm-chips">
                {(row.inferred_goals ?? []).map((g, i) => <span key={i} className="topic-pill">{g}</span>)}
              </div>
            </div>
          )}

          {(row.pain_points ?? []).length > 0 && (
            <div className="pm-section">
              <div className="pm-section-label">Pain points</div>
              {(row.pain_points ?? []).map((p, i) => (
                <div key={i} className="pm-list-item">⚠️ {p}</div>
              ))}
            </div>
          )}

          {(row.objection_patterns ?? []).length > 0 && (
            <div className="pm-section">
              <div className="pm-section-label">Objection patterns</div>
              {(row.objection_patterns ?? []).map((o, i) => (
                <div key={i} className="pm-list-item" style={{ color: '#ffa502' }}>🛡️ {o}</div>
              ))}
            </div>
          )}

          {row.content_preferences && (
            <div className="pm-section">
              <div className="pm-section-label">Content preferences</div>
              <p className="pm-text">{row.content_preferences}</p>
            </div>
          )}
        </div>

        <div className="pm-footer">
          <span className="pm-meta">{row.run_at ? `Analyzed ${new Date(row.run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</span>
          <a href={`/users/${row.from_id}`} className="btn-primary" style={{ textDecoration: 'none', fontSize: '.84rem', padding: '.5rem 1rem' }}>
            View full profile →
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Batch Modal ──────────────────────────────────────────────────────────────

interface Estimate {
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgCostPerRun: number;
  totalCost: number;
  totalTokens: number;
  estimatedMinutes: number;
  basedOnRuns: number;
}

function BatchModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [filter, setFilter] = useState<BatchFilter>('no_persona');
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [dryTotal, setDryTotal] = useState(0);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [runningRef] = useState<{ active: boolean }>({ active: false });
  const abortedRef = useRef(false);

  // Resume check on open
  useEffect(() => {
    fetch('/api/personas/batch/status')
      .then((r) => r.json())
      .then((data: BatchStatus) => {
        if (data.status === 'running') {
          setBatchStatus(data);
          setStep(3);
          runningRef.active = true;
          tickLoop();
        } else if (data.status === 'done') {
          setBatchStatus(data);
          setStep(4);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tickLoop = useCallback(async () => {
    abortedRef.current = false;
    while (true) {
      if (abortedRef.current) break;
      try {
        const res = await fetch('/api/personas/batch/tick', { method: 'POST' });
        const data = await res.json() as BatchStatus & { lastUser?: { name: string; success: boolean; error?: string } };
        setBatchStatus(data);
        if (data.status !== 'running') break;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    runningRef.active = false;
    setBatchStatus((prev) => {
      if (!prev) return prev;
      return prev;
    });
    if (!abortedRef.current) setStep(4);
  }, [runningRef]);

  async function fetchEstimate() {
    setLoadingEstimate(true);
    try {
      const res = await fetch('/api/personas/batch/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, dryRun: true }),
      });
      const data = await res.json() as { total: number; estimate: Estimate };
      setDryTotal(data.total);
      setEstimate(data.estimate);
      setStep(2);
    } finally {
      setLoadingEstimate(false);
    }
  }

  async function startBatch() {
    const res = await fetch('/api/personas/batch/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter }),
    });
    const data = await res.json() as { ok: boolean; total: number; estimate: Estimate; error?: string };
    if (!data.ok) { alert(data.error ?? 'Failed to start'); return; }
    setBatchStatus({ status: 'running', total: data.total, processed: 0, failed: 0 });
    setStep(3);
    runningRef.active = true;
    tickLoop();
  }

  async function abort() {
    abortedRef.current = true;
    await fetch('/api/personas/batch/abort', { method: 'POST' });
    setBatchStatus((prev) => prev ? { ...prev, status: 'aborted' } : prev);
    setStep(4);
  }

  const logs = batchStatus?.logs ?? [];
  const pct = batchStatus && batchStatus.total > 0 ? Math.round(((batchStatus.processed + batchStatus.failed) / batchStatus.total) * 100) : 0;
  const elapsedSec = batchStatus?.started_at ? Math.floor((Date.now() - new Date(batchStatus.started_at).getTime()) / 1000) : 0;
  const elapsedStr = elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <div className="modal-header">
          <span className="modal-title">
            {step === 1 && 'Run AI Personas'}
            {step === 2 && 'Review & Confirm'}
            {step === 3 && 'Generating Personas…'}
            {step === 4 && (batchStatus?.status === 'aborted' ? 'Batch Aborted' : '✓ Batch Complete!')}
          </span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Step 1: Select filter */}
        {step === 1 && (
          <div className="modal-body">
            <p className="modal-desc">Choose which current members to analyze with AI.</p>
            <div className="filter-options">
              {([
                ['no_persona', 'Members without a persona', 'Only run for people not yet analyzed — fastest option'],
                ['all', 'All current members', 'Re-run for everyone, including those already analyzed'],
                ['premium', 'Premium members only', 'Only Telegram Premium subscribers'],
              ] as [BatchFilter, string, string][]).map(([val, label, desc]) => (
                <label key={val} className={`filter-option${filter === val ? ' selected' : ''}`}>
                  <input type="radio" value={val} checked={filter === val} onChange={() => setFilter(val)} />
                  <div>
                    <div className="fo-label">{label}</div>
                    <div className="fo-desc">{desc}</div>
                  </div>
                </label>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={fetchEstimate} disabled={loadingEstimate}>
                {loadingEstimate ? 'Calculating…' : 'Get Estimate →'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Estimate */}
        {step === 2 && estimate && (
          <div className="modal-body">
            <div className="estimate-count">{dryTotal} <span>members selected</span></div>
            <div className="estimate-grid">
              <div className="est-item"><span className="est-label">Estimated cost</span><span className="est-val">${estimate.totalCost.toFixed(2)}</span></div>
              <div className="est-item"><span className="est-label">Total tokens</span><span className="est-val">{(estimate.totalTokens / 1000).toFixed(0)}K</span></div>
              <div className="est-item"><span className="est-label">Estimated time</span><span className="est-val">~{estimate.estimatedMinutes} min</span></div>
              <div className="est-item"><span className="est-label">Avg cost/run</span><span className="est-val">${estimate.avgCostPerRun.toFixed(4)}</span></div>
            </div>
            <p className="est-note">
              {estimate.basedOnRuns > 0
                ? `Based on ${estimate.basedOnRuns} previous run${estimate.basedOnRuns > 1 ? 's' : ''}. Keep this tab open during processing.`
                : 'No historical data — using conservative estimates. Keep this tab open during processing.'}
            </p>
            {dryTotal === 0 && <p className="est-warn">No eligible members found for this filter.</p>}
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setStep(1)}>← Back</button>
              <button className="btn-primary" onClick={startBatch} disabled={dryTotal === 0}>
                Start Processing {dryTotal} members →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Running */}
        {step === 3 && batchStatus && (
          <div className="modal-body">
            <div className="progress-header">
              <span className="progress-nums">{batchStatus.processed + batchStatus.failed} / {batchStatus.total}</span>
              <span className="progress-pct">{pct}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="progress-meta">
              ✓ {batchStatus.processed} done · ✗ {batchStatus.failed} failed · {elapsedStr} elapsed
            </div>
            <div className="batch-log">
              {logs.slice(0, 12).map((entry, i) => (
                <div key={i} className={`log-entry${entry.success ? '' : ' failed'}`}>
                  {entry.success ? '✓' : '✗'} <strong>{entry.name}</strong>
                  {!entry.success && entry.error && <span className="log-err"> — {entry.error.slice(0, 60)}</span>}
                </div>
              ))}
              {logs.length === 0 && <div className="log-empty">Starting up…</div>}
            </div>
            <div className="modal-footer">
              <button className="btn-danger" onClick={abort}>Abort ✕</button>
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 4 && batchStatus && (
          <div className="modal-body">
            <div className="done-icon">{batchStatus.status === 'aborted' ? '⛔' : '🎉'}</div>
            <div className="done-stats">
              <div className="ds-item"><span className="ds-num">{batchStatus.processed}</span><span className="ds-label">processed</span></div>
              <div className="ds-item"><span className="ds-num" style={{ color: batchStatus.failed > 0 ? '#ff4757' : undefined }}>{batchStatus.failed}</span><span className="ds-label">failed</span></div>
              <div className="ds-item"><span className="ds-num">{batchStatus.total}</span><span className="ds-label">total</span></div>
            </div>
            {batchStatus.started_at && batchStatus.finished_at && (
              <p className="done-time">
                Time: {Math.floor((new Date(batchStatus.finished_at).getTime() - new Date(batchStatus.started_at).getTime()) / 60000)}m{' '}
                {Math.floor(((new Date(batchStatus.finished_at).getTime() - new Date(batchStatus.started_at).getTime()) % 60000) / 1000)}s
              </p>
            )}
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => { setStep(1); setBatchStatus(null); setEstimate(null); }}>
                Run again ↺
              </button>
              <button className="btn-primary" onClick={() => { onComplete(); onClose(); }}>View Results →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IntelligencePage() {
  const [rows, setRows] = useState<PersonaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('grid');
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState('');
  const [engagementFilter, setEngagementFilter] = useState('');
  const [spendingFilter, setSpendingFilter] = useState('');
  const [intentFilter, setIntentFilter] = useState('');
  const [premiumFilter, setPremiumFilter] = useState('');
  const [ageFilter, setAgeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showBatch, setShowBatch] = useState(false);
  const [showChart, setShowChart] = useState(true);
  const [infoPersona, setInfoPersona] = useState<PersonaRow | null>(null);

  function loadData() {
    setLoading(true);
    fetch('/api/personas')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setRows(data);
        else setError(data.error ?? 'Failed to load');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadData(); }, []);

  const topicCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) for (const t of row.topics ?? []) map.set(t, (map.get(t) ?? 0) + 1);
    return Array.from(map.entries()).map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count).slice(0, 20);
  }, [rows]);

  const uniqueAgeRanges = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) if (r.inferred_age_range) seen.add(r.inferred_age_range);
    return Array.from(seen).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (priorityFilter) list = list.filter((r) => (r.follow_up_priority ?? 'nurture') === priorityFilter);
    if (engagementFilter) list = list.filter((r) => (r.engagement_level ?? 'passive') === engagementFilter);
    if (spendingFilter) list = list.filter((r) => (r.spending_capacity ?? 'unknown') === spendingFilter);
    if (premiumFilter === 'premium') list = list.filter((r) => r.is_premium);
    if (premiumFilter === 'non_premium') list = list.filter((r) => !r.is_premium);
    if (ageFilter) list = list.filter((r) => r.inferred_age_range === ageFilter);
    if (intentFilter === 'high') list = list.filter((r) => (r.buying_intent_score ?? 0) >= 7);
    if (intentFilter === 'medium') list = list.filter((r) => { const s = r.buying_intent_score ?? 0; return s >= 4 && s <= 6; });
    if (intentFilter === 'low') list = list.filter((r) => { const s = r.buying_intent_score ?? 0; return s >= 1 && s <= 3; });
    if (intentFilter === 'none') list = list.filter((r) => (r.buying_intent_score ?? 0) === 0);
    if (selectedTopics.size > 0) list = list.filter((r) => (r.topics ?? []).some((t) => selectedTopics.has(t)));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.display_name.toLowerCase().includes(q) ||
        (r.username ?? '').toLowerCase().includes(q) ||
        (r.summary ?? '').toLowerCase().includes(q) ||
        (r.inferred_occupation ?? '').toLowerCase().includes(q) ||
        (r.outreach_approach ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, priorityFilter, engagementFilter, spendingFilter, premiumFilter, ageFilter, intentFilter, selectedTopics, search]);

  const stats = useMemo(() => ({
    total: rows.length,
    hot: rows.filter((r) => (r.follow_up_priority ?? '') === 'hot').length,
    avgIntent: rows.length ? Math.round((rows.reduce((s, r) => s + (r.buying_intent_score ?? 0), 0) / rows.length) * 10) / 10 : 0,
    champions: rows.filter((r) => r.engagement_level === 'champion').length,
    withSignals: rows.filter((r) => (r.buying_signals ?? []).length > 0).length,
  }), [rows]);

  const pipelineGroups = useMemo(() => ({
    hot: filtered.filter((r) => r.follow_up_priority === 'hot'),
    warm: filtered.filter((r) => r.follow_up_priority === 'warm'),
    cold: filtered.filter((r) => r.follow_up_priority === 'cold'),
    nurture: filtered.filter((r) => !r.follow_up_priority || r.follow_up_priority === 'nurture'),
  }), [filtered]);

  function toggleTopic(topic: string) {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  }

  function clearFilters() {
    setSelectedTopics(new Set());
    setPriorityFilter('');
    setEngagementFilter('');
    setSpendingFilter('');
    setIntentFilter('');
    setPremiumFilter('');
    setAgeFilter('');
    setSearch('');
  }

  const hasFilters = selectedTopics.size > 0 || priorityFilter || engagementFilter || spendingFilter || intentFilter || premiumFilter || ageFilter || search;

  if (loading) return <div className="page-loading">Loading intelligence data…</div>;
  if (error) return <div className="page-error">Error: {error}</div>;

  return (
    <div className="intel-root">
      {/* Header */}
      <div className="intel-header">
        <div>
          <h1 className="intel-title">People Intelligence</h1>
          <p className="intel-subtitle">
            {rows.length} profiles analysed
            {filtered.length !== rows.length && ` · ${filtered.length} shown`}
          </p>
        </div>
        <button className="btn-run" onClick={() => setShowBatch(true)}>
          ▶ Run AI Personas
        </button>
      </div>

      {/* Stat cards */}
      {rows.length > 0 && (
        <div className="stats-row">
          <StatCard value={stats.total} label="Total profiles" />
          <StatCard value={stats.hot} label="Hot leads" sub="Intent ≥ 7" color="#ff4757" />
          <StatCard value={stats.avgIntent} label="Avg intent score" sub="out of 10" color={intentColor(stats.avgIntent)} />
          <StatCard value={stats.champions} label="Champions" sub="Top engagers" color="#ffd700" />
          <StatCard value={stats.withSignals} label="Buying signals" sub="Have explicit intent" color="#4caf50" />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🧠</div>
          <h2>No personas yet</h2>
          <p>Run AI Personas to start building your intelligence database for current members.</p>
          <button className="btn-primary" onClick={() => setShowBatch(true)}>Run AI Personas →</button>
        </div>
      ) : (
        <>
          {/* Controls bar */}
          <div className="controls-bar">
            <div className="controls-row1">
              <div className="view-tabs">
                {(['pipeline', 'grid', 'table'] as ViewMode[]).map((v) => (
                  <button key={v} className={`view-tab${view === v ? ' active' : ''}`} onClick={() => setView(v)}>
                    {v === 'pipeline' ? '📊 Pipeline' : v === 'grid' ? '⊞ Grid' : '≡ Table'}
                  </button>
                ))}
              </div>
              <input
                className="filter-search"
                placeholder="Search name, occupation, summary…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="btn-chart-toggle" onClick={() => setShowChart((s) => !s)}>
                {showChart ? '▲ Hide chart' : '▼ Topics'}
              </button>
              {hasFilters && (
                <button className="btn-clear" onClick={clearFilters}>
                  Clear all ✕
                </button>
              )}
            </div>
            <div className="controls-row2">
              <select className="filter-select" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
                <option value="">All priorities</option>
                {Object.entries(PRIORITY_CONFIG).map(([k, cfg]) => (
                  <option key={k} value={k}>{cfg.icon} {cfg.label}</option>
                ))}
              </select>
              <select className="filter-select" value={intentFilter} onChange={(e) => setIntentFilter(e.target.value)}>
                <option value="">All intent scores</option>
                <option value="high">🔥 High intent (7–10)</option>
                <option value="medium">⚡ Medium intent (4–6)</option>
                <option value="low">❄️ Low intent (1–3)</option>
                <option value="none">No signal (0)</option>
              </select>
              <select className="filter-select" value={engagementFilter} onChange={(e) => setEngagementFilter(e.target.value)}>
                <option value="">All engagement</option>
                {Object.entries(ENGAGEMENT_CONFIG).map(([k, cfg]) => (
                  <option key={k} value={k}>{cfg.icon} {k}</option>
                ))}
              </select>
              <select className="filter-select" value={spendingFilter} onChange={(e) => setSpendingFilter(e.target.value)}>
                <option value="">All spending</option>
                {Object.entries(SPENDING_CONFIG).map(([k, cfg]) => (
                  <option key={k} value={k}>{cfg.label}</option>
                ))}
              </select>
              <select className="filter-select" value={premiumFilter} onChange={(e) => setPremiumFilter(e.target.value)}>
                <option value="">All members</option>
                <option value="premium">✨ Premium only</option>
                <option value="non_premium">Non-premium only</option>
              </select>
              {uniqueAgeRanges.length > 0 && (
                <select className="filter-select" value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)}>
                  <option value="">All ages</option>
                  {uniqueAgeRanges.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              )}
              {hasFilters && (
                <span className="filter-count">
                  {filtered.length} of {rows.length} shown
                </span>
              )}
            </div>
          </div>

          {/* Topic chart */}
          {showChart && topicCounts.length > 0 && (
            <div className="chart-section">
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={Math.max(240, topicCounts.length * 26)}>
                  <BarChart data={topicCounts} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#666', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="topic" width={170} tick={{ fill: '#aaa', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: '#1a1a2e' }}
                      contentStyle={{ background: '#111', border: '1px solid #333', borderRadius: 8 }}
                      labelStyle={{ color: '#fff' }}
                      formatter={(v: number) => [`${v} people`, 'Count']}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => toggleTopic(d.topic)}>
                      {topicCounts.map((e, i) => (
                        <Cell key={e.topic} fill={TOPIC_COLORS[i % TOPIC_COLORS.length]} opacity={selectedTopics.size === 0 || selectedTopics.has(e.topic) ? 1 : 0.3} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="topic-pills">
                {topicCounts.map((tc, i) => (
                  <button
                    key={tc.topic}
                    className={`topic-btn${selectedTopics.has(tc.topic) ? ' active' : ''}`}
                    style={{ '--tc': TOPIC_COLORS[i % TOPIC_COLORS.length] } as React.CSSProperties}
                    onClick={() => toggleTopic(tc.topic)}
                  >
                    {tc.topic} <span className="tc-count">{tc.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Content */}
          {view === 'pipeline' && (
            <div className="pipeline-board">
              {(['hot', 'warm', 'cold', 'nurture'] as const).map((p) => (
                <PipelineColumn key={p} priority={p} rows={pipelineGroups[p]} highlightTopics={selectedTopics} onInfo={setInfoPersona} />
              ))}
            </div>
          )}

          {view === 'grid' && (
            <div className="grid-board">
              {filtered.map((row) => <GridCard key={row.id} row={row} highlightTopics={selectedTopics} onInfo={setInfoPersona} />)}
              {filtered.length === 0 && <div className="no-match">No profiles match the current filters.</div>}
            </div>
          )}

          {view === 'table' && <TableView rows={filtered} />}
        </>
      )}

      {infoPersona && (
        <PersonaInfoModal row={infoPersona} onClose={() => setInfoPersona(null)} />
      )}

      {showBatch && (
        <BatchModal
          onClose={() => setShowBatch(false)}
          onComplete={() => loadData()}
        />
      )}

      <style>{`
        .intel-root { max-width: 1400px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
        .page-loading, .page-error { padding: 4rem; text-align: center; color: #888; }
        .page-error { color: #f87171; }

        .intel-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
        .intel-title { font-size: 1.75rem; font-weight: 700; margin: 0 0 .25rem; }
        .intel-subtitle { color: #666; margin: 0; font-size: .88rem; }

        .btn-run { background: #7c6af7; color: #fff; border: none; border-radius: 8px; padding: .6rem 1.2rem; font-size: .9rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
        .btn-run:hover { background: #6a58e5; }

        .stats-row { display: flex; gap: 1rem; margin-bottom: 1.75rem; flex-wrap: wrap; }
        .stat-card { background: #111122; border: 1px solid #1e1e32; border-radius: 12px; padding: 1rem 1.25rem; flex: 1; min-width: 110px; }
        .stat-value { font-size: 1.9rem; font-weight: 700; line-height: 1; }
        .stat-label { font-size: .8rem; color: #666; margin-top: .35rem; font-weight: 500; }
        .stat-sub { font-size: .72rem; color: #444; margin-top: .15rem; }

        .empty-state { text-align: center; padding: 5rem 2rem; }
        .empty-icon { font-size: 3rem; margin-bottom: 1rem; }
        .empty-state h2 { margin: 0 0 .5rem; }
        .empty-state p { color: #888; margin-bottom: 1.5rem; }

        .controls-bar { display: flex; flex-direction: column; gap: .6rem; margin-bottom: 1rem; }
        .controls-row1 { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
        .controls-row2 { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
        .view-tabs { display: flex; gap: .25rem; background: #111122; border: 1px solid #1e1e32; border-radius: 8px; padding: .25rem; flex-shrink: 0; }
        .view-tab { background: transparent; border: none; border-radius: 6px; padding: .4rem .8rem; color: #666; font-size: .85rem; cursor: pointer; }
        .view-tab.active { background: #7c6af7; color: #fff; font-weight: 600; }
        .filter-select { background: #111122; border: 1px solid #1e1e32; border-radius: 6px; color: #ccc; padding: .4rem .6rem; font-size: .82rem; cursor: pointer; }
        .filter-select:focus { outline: none; border-color: #7c6af7; }
        .filter-search { background: #111122; border: 1px solid #1e1e32; border-radius: 6px; color: #fff; padding: .4rem .75rem; font-size: .83rem; outline: none; flex: 1; min-width: 180px; }
        .filter-search:focus { border-color: #7c6af7; }
        .btn-clear { background: transparent; border: 1px solid #333; border-radius: 6px; color: #ff6b6b; padding: .35rem .65rem; font-size: .78rem; cursor: pointer; white-space: nowrap; }
        .btn-clear:hover { background: rgba(255,107,107,.1); border-color: #ff6b6b; }
        .btn-chart-toggle { background: transparent; border: 1px solid #1e1e32; border-radius: 6px; color: #666; padding: .35rem .65rem; font-size: .78rem; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
        .btn-chart-toggle:hover { color: #ccc; }
        .filter-count { font-size: .78rem; color: #7c6af7; white-space: nowrap; margin-left: .25rem; font-weight: 600; }

        .chart-section { background: #0d0d1a; border: 1px solid #1e1e32; border-radius: 12px; padding: 1.25rem; margin-bottom: 1.5rem; }
        .chart-wrap { margin-bottom: .75rem; }
        .topic-pills { display: flex; flex-wrap: wrap; gap: .35rem; }
        .topic-btn { background: #111122; border: 1px solid #1e1e32; border-radius: 16px; color: #aaa; padding: .2rem .6rem; font-size: .75rem; cursor: pointer; display: inline-flex; align-items: center; gap: .3rem; }
        .topic-btn:hover { border-color: var(--tc); color: #fff; }
        .topic-btn.active { background: var(--tc); border-color: var(--tc); color: #fff; font-weight: 600; }
        .tc-count { background: rgba(255,255,255,.15); border-radius: 8px; padding: 0 .35rem; font-size: .68rem; }

        /* Pipeline */
        .pipeline-board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; align-items: start; }
        @media (max-width: 1100px) { .pipeline-board { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 640px) { .pipeline-board { grid-template-columns: 1fr; } }
        .pipeline-col { background: #0a0a18; border: 1px solid #1e1e32; border-radius: 12px; overflow: hidden; }
        .pipeline-col-header { display: flex; justify-content: space-between; align-items: center; padding: .7rem 1rem; border-bottom: 1px solid; font-size: .85rem; font-weight: 600; }
        .pipeline-count { background: rgba(255,255,255,.08); border-radius: 10px; padding: .1rem .5rem; font-size: .78rem; }
        .pipeline-cards { padding: .5rem; display: flex; flex-direction: column; gap: .5rem; max-height: 75vh; overflow-y: auto; }
        .pipeline-empty { text-align: center; color: #444; padding: 2rem 1rem; font-size: .82rem; }
        .pipeline-card { display: block; text-decoration: none; color: inherit; background: var(--card-bg, #111); border: 1px solid #1e1e32; border-radius: 10px; padding: .85rem; transition: border-color .15s, transform .1s; display: flex; flex-direction: column; gap: .5rem; }
        .pipeline-card:hover { border-color: #7c6af7; transform: translateY(-1px); }
        .pc-header { display: flex; align-items: center; gap: .6rem; }
        .pc-identity { flex: 1; min-width: 0; }
        .pc-name { font-weight: 600; font-size: .88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pc-occupation { font-size: .73rem; color: #7c6af7; margin-top: .1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .eng-icon { font-size: .9rem; }
        .pc-topics { display: flex; flex-wrap: wrap; gap: .25rem; }
        .pc-approach { font-size: .75rem; color: #888; line-height: 1.4; display: flex; gap: .3rem; }
        .approach-icon { flex-shrink: 0; }
        .pc-signals { display: flex; flex-direction: column; gap: .2rem; }
        .signal-item { font-size: .72rem; color: #4caf50; line-height: 1.3; }

        /* Shared micro-components */
        .avatar { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
        .avatar-fallback { display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: .8rem; }
        .premium-star { color: #ffd700; margin-left: .25rem; font-size: .8rem; }
        .intent-bar-wrap { display: flex; align-items: center; gap: .5rem; }
        .intent-bar-track { flex: 1; height: 5px; background: #1e1e32; border-radius: 3px; overflow: hidden; }
        .intent-bar-fill { height: 100%; border-radius: 3px; transition: width .3s; }
        .intent-score { font-size: .72rem; font-weight: 700; white-space: nowrap; }
        .priority-badge { border-radius: 12px; padding: .15rem .55rem; font-size: .72rem; font-weight: 600; white-space: nowrap; }
        .topic-pill { background: #1e1e32; border: 1px solid #2a2a3e; border-radius: 10px; padding: .1rem .45rem; font-size: .7rem; color: #888; white-space: nowrap; }
        .topic-pill.hl { background: #2d2060; border-color: #7c6af7; color: #c4b9ff; }

        /* Grid */
        .grid-board { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 1rem; }
        .no-match { text-align: center; color: #555; padding: 3rem; grid-column: 1/-1; }
        .grid-card { display: block; text-decoration: none; color: inherit; background: #0d0d1a; border: 1px solid #1e1e32; border-radius: 12px; padding: 1.1rem; display: flex; flex-direction: column; gap: .6rem; transition: border-color .15s, transform .15s; }
        .grid-card:hover { border-color: #7c6af7; transform: translateY(-2px); }
        .gc-top { display: flex; align-items: center; gap: .7rem; }
        .gc-identity { flex: 1; min-width: 0; }
        .gc-name { font-weight: 600; font-size: .92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .gc-username { font-size: .74rem; color: #555; }
        .gc-occupation { font-size: .75rem; color: #7c6af7; }
        .gc-summary { font-size: .79rem; color: #999; line-height: 1.5; margin: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .gc-topics { display: flex; flex-wrap: wrap; gap: .25rem; }
        .gc-meta { display: flex; gap: .75rem; font-size: .75rem; color: #777; }
        .gc-approach { font-size: .76rem; color: #888; line-height: 1.4; }

        /* Table */
        .table-wrap { overflow-x: auto; }
        .data-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
        .data-table th { background: #0a0a18; border-bottom: 1px solid #1e1e32; padding: .65rem .75rem; text-align: left; color: #666; font-weight: 600; font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
        .sortable-th { cursor: pointer; user-select: none; }
        .sortable-th:hover { color: #aaa; }
        .data-row { border-bottom: 1px solid #0f0f1e; cursor: pointer; transition: background .1s; }
        .data-row:hover { background: #111122; }
        .data-table td { padding: .6rem .75rem; vertical-align: middle; }
        .td-name { display: flex; align-items: center; gap: .6rem; }
        .td-display-name { font-weight: 600; font-size: .85rem; }
        .td-username { font-size: .72rem; color: #555; }
        .td-intent { display: flex; align-items: baseline; gap: .15rem; }
        .intent-max { color: #444; font-size: .72rem; }
        .td-occ { color: #888; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .td-topics { display: flex; flex-wrap: wrap; gap: .2rem; max-width: 200px; }
        .td-approach { color: #888; max-width: 250px; font-size: .78rem; }

        /* Batch Modal */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.75); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem; }
        .modal-box { background: #0d0d1a; border: 1px solid #2a2a3e; border-radius: 16px; width: 100%; max-width: 500px; overflow: hidden; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 1.5rem; border-bottom: 1px solid #1e1e32; }
        .modal-title { font-weight: 700; font-size: 1.05rem; }
        .modal-close { background: transparent; border: none; color: #666; font-size: 1.1rem; cursor: pointer; padding: .25rem .5rem; }
        .modal-close:hover { color: #fff; }
        .modal-body { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem; }
        .modal-desc { color: #888; margin: 0; font-size: .88rem; }
        .filter-options { display: flex; flex-direction: column; gap: .5rem; }
        .filter-option { display: flex; gap: .75rem; align-items: flex-start; padding: .75rem 1rem; border: 1px solid #1e1e32; border-radius: 10px; cursor: pointer; transition: border-color .15s; }
        .filter-option input { margin-top: .15rem; accent-color: #7c6af7; }
        .filter-option.selected { border-color: #7c6af7; background: rgba(124,106,247,.05); }
        .fo-label { font-weight: 600; font-size: .88rem; }
        .fo-desc { font-size: .78rem; color: #666; margin-top: .15rem; }
        .estimate-count { font-size: 2.5rem; font-weight: 700; text-align: center; }
        .estimate-count span { font-size: 1rem; color: #666; font-weight: 400; }
        .estimate-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
        .est-item { background: #111122; border: 1px solid #1e1e32; border-radius: 10px; padding: .85rem; }
        .est-label { display: block; font-size: .75rem; color: #666; margin-bottom: .35rem; }
        .est-val { font-size: 1.35rem; font-weight: 700; color: #c4b9ff; }
        .est-note { font-size: .78rem; color: #555; margin: 0; line-height: 1.5; }
        .est-warn { color: #ff9800; font-size: .82rem; margin: 0; }
        .progress-header { display: flex; justify-content: space-between; }
        .progress-nums { font-weight: 700; font-size: 1.1rem; }
        .progress-pct { font-size: 1.1rem; color: #7c6af7; font-weight: 700; }
        .progress-track { background: #1e1e32; border-radius: 6px; height: 10px; overflow: hidden; }
        .progress-fill { background: linear-gradient(90deg, #7c6af7, #4caf50); height: 100%; border-radius: 6px; transition: width .4s; }
        .progress-meta { font-size: .8rem; color: #666; text-align: center; }
        .batch-log { background: #070710; border: 1px solid #1e1e32; border-radius: 8px; padding: .75rem; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: .3rem; font-family: monospace; font-size: .78rem; }
        .log-entry { color: #4caf50; }
        .log-entry.failed { color: #ff4757; }
        .log-err { color: #ff8a80; }
        .log-empty { color: #444; text-align: center; padding: .5rem; }
        .done-icon { font-size: 3rem; text-align: center; }
        .done-stats { display: flex; justify-content: center; gap: 2rem; }
        .ds-item { text-align: center; }
        .ds-num { display: block; font-size: 2rem; font-weight: 700; }
        .ds-label { font-size: .78rem; color: #666; }
        .done-time { font-size: .82rem; color: #555; text-align: center; margin: 0; }
        .modal-footer { display: flex; justify-content: flex-end; gap: .75rem; padding-top: .5rem; border-top: 1px solid #1e1e32; }
        .btn-primary { background: #7c6af7; color: #fff; border: none; border-radius: 8px; padding: .6rem 1.2rem; font-size: .88rem; font-weight: 600; cursor: pointer; }
        .btn-primary:hover:not(:disabled) { background: #6a58e5; }
        .btn-primary:disabled { opacity: .5; cursor: not-allowed; }
        .btn-ghost { background: transparent; border: 1px solid #2a2a3e; color: #888; border-radius: 8px; padding: .6rem 1.2rem; font-size: .88rem; cursor: pointer; }
        .btn-ghost:hover { color: #fff; border-color: #444; }
        .btn-danger { background: rgba(255,71,87,.15); border: 1px solid rgba(255,71,87,.4); color: #ff4757; border-radius: 8px; padding: .6rem 1.2rem; font-size: .88rem; cursor: pointer; font-weight: 600; }
        .btn-danger:hover { background: rgba(255,71,87,.25); }

        /* Card info button */
        .gc-top-actions { display: flex; flex-direction: column; gap: .3rem; align-items: flex-end; flex-shrink: 0; }
        .pc-header-right { display: flex; flex-direction: column; gap: .2rem; align-items: center; }
        .card-info-btn { background: rgba(124,106,247,.1); border: 1px solid rgba(124,106,247,.2); border-radius: 5px; color: #7c6af7; font-size: .72rem; cursor: pointer; padding: .18rem .45rem; line-height: 1.3; opacity: 0; transition: opacity .15s; white-space: nowrap; font-style: normal; }
        .grid-card:hover .card-info-btn, .pipeline-card:hover .card-info-btn { opacity: 1; }
        .card-info-btn:hover { background: rgba(124,106,247,.25) !important; opacity: 1 !important; }

        /* Persona info modal */
        .persona-modal { max-width: 560px; max-height: 88vh; display: flex; flex-direction: column; }
        .pm-title-row { display: flex; gap: .75rem; align-items: center; min-width: 0; flex: 1; overflow: hidden; }
        .pm-name { font-weight: 700; font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pm-username { font-size: .78rem; color: #555; }
        .pm-body { overflow-y: auto; padding: 1rem 1.5rem 1.25rem; display: flex; flex-direction: column; gap: .85rem; flex: 1; }
        .pm-signals-row { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; }
        .pm-chip { font-size: .78rem; color: #888; background: #111122; border: 1px solid #1e1e32; border-radius: 8px; padding: .15rem .5rem; }
        .pm-section { display: flex; flex-direction: column; gap: .3rem; }
        .pm-section-label { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: #555; font-weight: 600; }
        .pm-text { margin: 0; font-size: .83rem; color: #ccc; line-height: 1.55; }
        .pm-chips { display: flex; flex-wrap: wrap; gap: .25rem; }
        .pm-list-item { font-size: .81rem; line-height: 1.45; color: #aaa; padding: .08rem 0; }
        .pm-footer { display: flex; justify-content: space-between; align-items: center; padding: .85rem 1.5rem; border-top: 1px solid #1e1e32; flex-shrink: 0; gap: .75rem; }
        .pm-meta { font-size: .72rem; color: #444; }
      `}</style>
    </div>
  );
}
