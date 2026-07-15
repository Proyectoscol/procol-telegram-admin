'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingCard } from '@/components/Loading';

interface Candidate {
  id: number;
  display_name: string | null;
  username: string | null;
}

interface ReviewRow {
  id: number;
  import_type: string;
  reason: string;
  suggested_name: string | null;
  suggested_username: string | null;
  suggested_telegram_id: string | null;
  suggested_email: string | null;
  candidates: Candidate[];
  created_at: string;
}

const REASON_LABEL: Record<string, string> = {
  DUPLICATE_NAME: 'Multiple members share this name',
  UNMATCHED: "Couldn't find a matching member",
  MISSING_IDENTIFIER: 'No name, username, ID, or email in this row',
};

function SearchResolver({ onResolve }: { onResolve: (userId: number) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/members/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <input
        type="text"
        placeholder="Search members by name, username, or email…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', maxWidth: 320, background: '#0f1419', border: '1px solid #2f3336', color: '#e7e9ea', padding: '0.4rem 0.6rem', borderRadius: 6, fontSize: '0.8125rem' }}
      />
      {searching && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#8b98a5' }}>Searching…</span>}
      {results.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0' }}>
          {results.map((r) => (
            <li key={r.id} style={{ marginBottom: '0.25rem' }}>
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8125rem' }} onClick={() => onResolve(r.id)}>
                {r.display_name || r.username || `Member ${r.id}`} {r.username ? `(@${r.username})` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ReviewQueuePage() {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    fetch('/api/review-queue')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setRows(d.results);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load review queue'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (reviewId: number, userId: number) => {
    setPendingIds((prev) => new Set(prev).add(reviewId));
    try {
      const res = await fetch(`/api/review-queue/${reviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve');
      setRows((prev) => (prev ? prev.filter((r) => r.id !== reviewId) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(reviewId);
        return next;
      });
    }
  };

  const skip = async (reviewId: number) => {
    setPendingIds((prev) => new Set(prev).add(reviewId));
    try {
      const res = await fetch(`/api/review-queue/${reviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'skip' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to skip');
      setRows((prev) => (prev ? prev.filter((r) => r.id !== reviewId) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to skip');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(reviewId);
        return next;
      });
    }
  };

  if (!rows && !error) return <LoadingCard message="Loading review queue…" />;

  return (
    <div>
      <h1>Review queue</h1>
      <p style={{ color: '#8b98a5', marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
        Rows from list imports that couldn&apos;t be confidently matched to a member. Resolve to an existing
        member, or skip.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {rows && rows.length === 0 && <div className="card">Nothing to review. All caught up.</div>}
      {rows?.map((row) => (
        <div className="card" key={row.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <span className="badge badge-default">{row.import_type}</span>{' '}
              <span style={{ color: '#8b98a5', fontSize: '0.8125rem' }}>{REASON_LABEL[row.reason] ?? row.reason}</span>
            </div>
            <button type="button" className="btn btn-secondary" disabled={pendingIds.has(row.id)} onClick={() => skip(row.id)}>
              Skip
            </button>
          </div>
          <div style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
            {row.suggested_name && <div><strong>Name:</strong> {row.suggested_name}</div>}
            {row.suggested_username && <div><strong>Username:</strong> @{row.suggested_username}</div>}
            {row.suggested_telegram_id && <div><strong>Telegram ID:</strong> {row.suggested_telegram_id}</div>}
            {row.suggested_email && <div><strong>Email:</strong> {row.suggested_email}</div>}
          </div>

          {row.candidates.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <p style={{ fontSize: '0.8125rem', color: '#8b98a5', marginBottom: '0.35rem' }}>Same name, pick the right one:</p>
              {row.candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginRight: '0.5rem', marginBottom: '0.35rem' }}
                  disabled={pendingIds.has(row.id)}
                  onClick={() => resolve(row.id, c.id)}
                >
                  {c.display_name || c.username || `Member ${c.id}`} {c.username ? `(@${c.username})` : ''}
                </button>
              ))}
            </div>
          )}

          <SearchResolver onResolve={(userId) => resolve(row.id, userId)} />
        </div>
      ))}
    </div>
  );
}
