'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingCard } from '@/components/Loading';
import { ROADMAP_STAGES, WIN_CONFIDENCES, COACH_NOTE_TYPES, FOLLOWUP_PRIORITIES } from '@/lib/crm/constants';

interface Roadmap {
  stage: string | null;
  main_goal: string | null;
  current_blocker: string | null;
  next_action: string | null;
  assigned_to: string | null;
  due_date: string | null;
  progress_notes: string | null;
}

interface Win {
  id: number;
  amount: number | string | null;
  description: string | null;
  occurred_at: string | null;
  source: string | null;
  confidence: string | null;
}

interface CoachNote {
  id: number;
  note_type: string | null;
  summary: string | null;
  next_action: string | null;
  follow_up_date: string | null;
  created_by: string | null;
  created_at: string;
}

interface FollowUp {
  id: number;
  due_date: string | null;
  status: string;
  priority: string;
  reason: string | null;
  completed_at: string | null;
}

interface TimelineEvent {
  id: number;
  event_type: string;
  title: string;
  description: string | null;
  occurred_at: string;
  source: string | null;
}

interface CrmData {
  roadmap: Roadmap | null;
  wins: Win[];
  coachNotes: CoachNote[];
  followUps: FollowUp[];
  timeline: TimelineEvent[];
}

const EVENT_ICON: Record<string, string> = {
  JOINED: '👋',
  WIN: '🏆',
  COACH_CALL: '🗣️',
  SALES_CALL: '📞',
  FOLLOW_UP: '⏰',
  ROADMAP_CHANGE: '🗺️',
  PURCHASE: '💳',
  COURSE_PROGRESS: '🎓',
  IMPORT: '📥',
  BOT_NOTE: '🤖',
  OTHER: '•',
};

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

export function MemberCrm({ userId }: { userId: number }) {
  const [data, setData] = useState<CrmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/members/${userId}/crm`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load CRM data'))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Roadmap ──────────────────────────────────────────────────────────────
  const [roadmapForm, setRoadmapForm] = useState<Roadmap>({
    stage: null, main_goal: '', current_blocker: '', next_action: '', assigned_to: '', due_date: '', progress_notes: '',
  });
  const [roadmapSaving, setRoadmapSaving] = useState(false);
  useEffect(() => {
    if (data?.roadmap) {
      setRoadmapForm({
        stage: data.roadmap.stage,
        main_goal: data.roadmap.main_goal ?? '',
        current_blocker: data.roadmap.current_blocker ?? '',
        next_action: data.roadmap.next_action ?? '',
        assigned_to: data.roadmap.assigned_to ?? '',
        due_date: data.roadmap.due_date ? data.roadmap.due_date.slice(0, 10) : '',
        progress_notes: data.roadmap.progress_notes ?? '',
      });
    }
  }, [data?.roadmap]);

  const saveRoadmap = async () => {
    setRoadmapSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/members/${userId}/roadmap`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roadmapForm),
      });
      const roadmap = await res.json();
      if (!res.ok) throw new Error(roadmap.error || 'Failed to save roadmap');
      setData((d) => (d ? { ...d, roadmap } : d));
      load(); // refresh timeline
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save roadmap');
    } finally {
      setRoadmapSaving(false);
    }
  };

  // ── Wins ─────────────────────────────────────────────────────────────────
  const [showWinForm, setShowWinForm] = useState(false);
  const [winForm, setWinForm] = useState({ amount: '', description: '', occurred_at: '', confidence: 'CONFIRMED' as string, source: '' });
  const [winSaving, setWinSaving] = useState(false);
  const submitWin = async (e: React.FormEvent) => {
    e.preventDefault();
    setWinSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/members/${userId}/wins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...winForm, amount: winForm.amount ? Number(winForm.amount) : null, occurred_at: winForm.occurred_at || null }),
      });
      const win = await res.json();
      if (!res.ok) throw new Error(win.error || 'Failed to save win');
      setData((d) => (d ? { ...d, wins: [win, ...d.wins] } : d));
      setShowWinForm(false);
      setWinForm({ amount: '', description: '', occurred_at: '', confidence: 'CONFIRMED', source: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save win');
    } finally {
      setWinSaving(false);
    }
  };

  // ── Coach notes ──────────────────────────────────────────────────────────
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteForm, setNoteForm] = useState({ note_type: 'CALL' as string, summary: '', next_action: '', follow_up_date: '', created_by: '' });
  const [noteSaving, setNoteSaving] = useState(false);
  const submitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    setNoteSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/members/${userId}/coach-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...noteForm, follow_up_date: noteForm.follow_up_date || null }),
      });
      const note = await res.json();
      if (!res.ok) throw new Error(note.error || 'Failed to save note');
      setData((d) => (d ? { ...d, coachNotes: [note, ...d.coachNotes] } : d));
      setShowNoteForm(false);
      setNoteForm({ note_type: 'CALL', summary: '', next_action: '', follow_up_date: '', created_by: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save note');
    } finally {
      setNoteSaving(false);
    }
  };

  // ── Follow-ups ───────────────────────────────────────────────────────────
  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [followUpForm, setFollowUpForm] = useState({ due_date: '', priority: 'MEDIUM' as string, reason: '' });
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [pendingFollowUpIds, setPendingFollowUpIds] = useState<Set<number>>(new Set());
  const submitFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setFollowUpSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/members/${userId}/follow-ups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...followUpForm, due_date: followUpForm.due_date || null }),
      });
      const followUp = await res.json();
      if (!res.ok) throw new Error(followUp.error || 'Failed to save follow-up');
      setData((d) => (d ? { ...d, followUps: [followUp, ...d.followUps] } : d));
      setShowFollowUpForm(false);
      setFollowUpForm({ due_date: '', priority: 'MEDIUM', reason: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save follow-up');
    } finally {
      setFollowUpSaving(false);
    }
  };

  const setFollowUpStatus = async (id: number, status: 'DONE' | 'CANCELLED') => {
    setPendingFollowUpIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/members/${userId}/follow-ups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const followUp = await res.json();
      if (!res.ok) throw new Error(followUp.error || 'Failed to update follow-up');
      setData((d) => (d ? { ...d, followUps: d.followUps.map((f) => (f.id === id ? followUp : f)) } : d));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update follow-up');
    } finally {
      setPendingFollowUpIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  if (loading && !data) return <LoadingCard message="Loading CRM data…" />;
  if (!data) return error ? <div className="alert alert-error">{error}</div> : null;

  const openFollowUps = data.followUps.filter((f) => f.status === 'OPEN');
  const closedFollowUps = data.followUps.filter((f) => f.status !== 'OPEN');

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <h2>Roadmap</h2>
        <div className="form-group">
          <label>Stage</label>
          <select value={roadmapForm.stage ?? ''} onChange={(e) => setRoadmapForm((f) => ({ ...f, stage: e.target.value || null }))}>
            <option value="">Not set</option>
            {ROADMAP_STAGES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Main goal</label>
          <input type="text" value={roadmapForm.main_goal ?? ''} onChange={(e) => setRoadmapForm((f) => ({ ...f, main_goal: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Current blocker</label>
          <input type="text" value={roadmapForm.current_blocker ?? ''} onChange={(e) => setRoadmapForm((f) => ({ ...f, current_blocker: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Next action</label>
          <input type="text" value={roadmapForm.next_action ?? ''} onChange={(e) => setRoadmapForm((f) => ({ ...f, next_action: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Assigned to</label>
          <input type="text" value={roadmapForm.assigned_to ?? ''} onChange={(e) => setRoadmapForm((f) => ({ ...f, assigned_to: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Due date</label>
          <input type="date" value={roadmapForm.due_date ?? ''} onChange={(e) => setRoadmapForm((f) => ({ ...f, due_date: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Progress notes</label>
          <textarea value={roadmapForm.progress_notes ?? ''} onChange={(e) => setRoadmapForm((f) => ({ ...f, progress_notes: e.target.value }))} />
        </div>
        <button type="button" className="btn" disabled={roadmapSaving} onClick={saveRoadmap}>
          {roadmapSaving ? 'Saving…' : 'Save roadmap'}
        </button>
      </div>

      <div className="card">
        <h2>Wins</h2>
        {!showWinForm ? (
          <button type="button" className="btn" onClick={() => setShowWinForm(true)}>Log win</button>
        ) : (
          <form onSubmit={submitWin}>
            <div className="form-group">
              <label>Amount</label>
              <input type="number" value={winForm.amount} onChange={(e) => setWinForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={winForm.description} onChange={(e) => setWinForm((f) => ({ ...f, description: e.target.value }))} placeholder="What happened" />
            </div>
            <div className="form-group">
              <label>Date</label>
              <input type="date" value={winForm.occurred_at} onChange={(e) => setWinForm((f) => ({ ...f, occurred_at: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Source</label>
              <input type="text" value={winForm.source} onChange={(e) => setWinForm((f) => ({ ...f, source: e.target.value }))} placeholder="Event, DM, call, ..." />
            </div>
            <div className="form-group">
              <label>Confidence</label>
              <select value={winForm.confidence} onChange={(e) => setWinForm((f) => ({ ...f, confidence: e.target.value }))}>
                {WIN_CONFIDENCES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn" disabled={winSaving}>Save win</button>
            <button type="button" className="btn btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={() => setShowWinForm(false)}>Cancel</button>
          </form>
        )}
        <ul className="calls-list" style={{ marginTop: '1.5rem' }}>
          {data.wins.map((w) => (
            <li key={w.id}>
              <div className="call-meta">
                {fmtDate(w.occurred_at)}{w.amount != null ? ` · $${Number(w.amount).toLocaleString()}` : ''}{w.confidence ? ` · ${w.confidence}` : ''}
              </div>
              {w.description && <p style={{ margin: '0.35rem 0', fontSize: '0.875rem' }}>{w.description}</p>}
            </li>
          ))}
        </ul>
        {data.wins.length === 0 && !showWinForm && <p style={{ color: '#8b98a5', marginTop: '1rem', fontSize: '0.875rem' }}>No wins logged yet.</p>}
      </div>

      <div className="card">
        <h2>Coach notes</h2>
        {!showNoteForm ? (
          <button type="button" className="btn" onClick={() => setShowNoteForm(true)}>Add note</button>
        ) : (
          <form onSubmit={submitNote}>
            <div className="form-group">
              <label>Type</label>
              <select value={noteForm.note_type} onChange={(e) => setNoteForm((f) => ({ ...f, note_type: e.target.value }))}>
                {COACH_NOTE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Summary</label>
              <textarea value={noteForm.summary} onChange={(e) => setNoteForm((f) => ({ ...f, summary: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Next action</label>
              <input type="text" value={noteForm.next_action} onChange={(e) => setNoteForm((f) => ({ ...f, next_action: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Follow-up date</label>
              <input type="date" value={noteForm.follow_up_date} onChange={(e) => setNoteForm((f) => ({ ...f, follow_up_date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Created by</label>
              <input type="text" value={noteForm.created_by} onChange={(e) => setNoteForm((f) => ({ ...f, created_by: e.target.value }))} />
            </div>
            <button type="submit" className="btn" disabled={noteSaving}>Save note</button>
            <button type="button" className="btn btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={() => setShowNoteForm(false)}>Cancel</button>
          </form>
        )}
        <ul className="calls-list" style={{ marginTop: '1.5rem' }}>
          {data.coachNotes.map((n) => (
            <li key={n.id}>
              <div className="call-meta">{fmtDate(n.created_at)}{n.note_type ? ` · ${n.note_type}` : ''} · {n.created_by || '—'}</div>
              {n.summary && <p style={{ margin: '0.35rem 0', fontSize: '0.875rem' }}>{n.summary}</p>}
              {n.next_action && <p style={{ margin: '0.35rem 0', fontSize: '0.875rem' }}><strong>Next:</strong> {n.next_action}</p>}
            </li>
          ))}
        </ul>
        {data.coachNotes.length === 0 && !showNoteForm && <p style={{ color: '#8b98a5', marginTop: '1rem', fontSize: '0.875rem' }}>No coach notes yet.</p>}
      </div>

      <div className="card">
        <h2>Follow-ups</h2>
        {!showFollowUpForm ? (
          <button type="button" className="btn" onClick={() => setShowFollowUpForm(true)}>Schedule follow-up</button>
        ) : (
          <form onSubmit={submitFollowUp}>
            <div className="form-group">
              <label>Due date</label>
              <input type="date" value={followUpForm.due_date} onChange={(e) => setFollowUpForm((f) => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select value={followUpForm.priority} onChange={(e) => setFollowUpForm((f) => ({ ...f, priority: e.target.value }))}>
                {FOLLOWUP_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Reason</label>
              <textarea value={followUpForm.reason} onChange={(e) => setFollowUpForm((f) => ({ ...f, reason: e.target.value }))} />
            </div>
            <button type="submit" className="btn" disabled={followUpSaving}>Save follow-up</button>
            <button type="button" className="btn btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={() => setShowFollowUpForm(false)}>Cancel</button>
          </form>
        )}
        <ul className="calls-list" style={{ marginTop: '1.5rem' }}>
          {openFollowUps.map((f) => (
            <li key={f.id}>
              <div className="call-meta">Due {fmtDate(f.due_date)} · {f.priority}</div>
              {f.reason && <p style={{ margin: '0.35rem 0', fontSize: '0.875rem' }}>{f.reason}</p>}
              <button type="button" className="btn btn-secondary" disabled={pendingFollowUpIds.has(f.id)} onClick={() => setFollowUpStatus(f.id, 'DONE')}>
                Mark done
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginLeft: '0.5rem' }}
                disabled={pendingFollowUpIds.has(f.id)}
                onClick={() => setFollowUpStatus(f.id, 'CANCELLED')}
              >
                Cancel
              </button>
            </li>
          ))}
          {closedFollowUps.map((f) => (
            <li key={f.id} style={{ opacity: 0.6 }}>
              <div className="call-meta">Due {fmtDate(f.due_date)} · {f.status}</div>
              {f.reason && <p style={{ margin: '0.35rem 0', fontSize: '0.875rem' }}>{f.reason}</p>}
            </li>
          ))}
        </ul>
        {data.followUps.length === 0 && !showFollowUpForm && <p style={{ color: '#8b98a5', marginTop: '1rem', fontSize: '0.875rem' }}>No follow-ups yet.</p>}
      </div>

      <div className="card">
        <h2>Timeline</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
          Every important event, chronological — automatically logged from the sections above.
        </p>
        {data.timeline.length === 0 ? (
          <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>No events yet.</p>
        ) : (
          <ul className="calls-list">
            {data.timeline.map((ev) => (
              <li key={ev.id}>
                <div className="call-meta">
                  {EVENT_ICON[ev.event_type] ?? '•'} {fmtDate(ev.occurred_at)}{ev.source ? ` · ${ev.source}` : ''}
                </div>
                <p style={{ margin: '0.35rem 0', fontSize: '0.875rem', fontWeight: 600 }}>{ev.title}</p>
                {ev.description && <p style={{ margin: '0.35rem 0', fontSize: '0.875rem', color: '#8b98a5' }}>{ev.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
