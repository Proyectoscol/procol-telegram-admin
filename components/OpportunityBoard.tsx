'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingCard } from '@/components/Loading';

type PremiumFilter = 'all' | 'only' | 'exclude';

interface OpportunityCard {
  userId: number;
  fromId: string | null;
  displayName: string | null;
  username: string | null;
  isPremium: boolean;
  isLifetime: boolean;
  isCurrentMember: boolean;
  score: number;
  reason: string | null;
  recommendedAction: string | null;
  doneAt: string | null;
  lastCalculated: string;
}

interface CategoryBlock {
  category: string;
  emoji: string;
  title: string;
  blurb: string;
  cards: OpportunityCard[];
}

interface Board {
  categories: CategoryBlock[];
  totalOpen: number;
  lastCalculated: string | null;
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) return 'badge-risk';
  if (score >= 60) return 'badge-warn';
  return 'badge-default';
}

function ToggleSwitch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: '#8b98a5', cursor: 'pointer' }}>
      <span
        className="toggle-switch"
        data-on={on}
        role="switch"
        aria-checked={on}
        tabIndex={0}
        onClick={() => onChange(!on)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onChange(!on);
          }
        }}
      >
        <span className="toggle-switch-thumb" />
      </span>
      {label}
    </label>
  );
}

const PREMIUM_FILTER_OPTIONS: { value: PremiumFilter; label: string }[] = [
  { value: 'all', label: 'All members' },
  { value: 'only', label: 'Premium only' },
  { value: 'exclude', label: 'Not premium' },
];

function PremiumFilterControl({ value, onChange }: { value: PremiumFilter; onChange: (v: PremiumFilter) => void }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem', color: '#8b98a5' }}>
      {PREMIUM_FILTER_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`btn ${value === opt.value ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '0.3rem 0.6rem', fontSize: '0.8125rem' }}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function OpportunityBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [mining, setMining] = useState(false);
  const [mineResult, setMineResult] = useState<{ membersScanned: number; eventsCreated: number } | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [currentOnly, setCurrentOnly] = useState(true);
  const [premiumFilter, setPremiumFilter] = useState<PremiumFilter>('all');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ current: String(currentOnly), premium: premiumFilter });
    fetch(`/api/opportunities?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setBoard(data);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load opportunities'))
      .finally(() => setLoading(false));
  }, [currentOnly, premiumFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const recompute = async () => {
    setRecomputing(true);
    setError(null);
    try {
      const res = await fetch('/api/opportunities/recompute', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to recalculate');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to recalculate');
    } finally {
      setRecomputing(false);
    }
  };

  const mineTimelines = async () => {
    setMining(true);
    setError(null);
    setMineResult(null);
    try {
      const res = await fetch('/api/members/mine-timelines', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to mine timelines');
      setMineResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mine timelines');
    } finally {
      setMining(false);
    }
  };

  const markDone = async (userId: number) => {
    setPendingIds((prev) => new Set(prev).add(userId));
    try {
      const res = await fetch('/api/opportunities/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, done: true }),
      });
      if (!res.ok) throw new Error('Failed to mark done');
      setBoard((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          totalOpen: prev.totalOpen - 1,
          categories: prev.categories.map((c) => ({
            ...c,
            cards: c.cards.filter((card) => card.userId !== userId),
          })),
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark done');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  if (loading && !board) return <LoadingCard message="Loading opportunities…" />;
  if (error && !board) return <div className="alert alert-error">{error}</div>;
  if (!board) return null;

  const activeCategories = board.categories.filter((c) => c.cards.length > 0);

  return (
    <>
      <div className="filters" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.9375rem' }}>
            <strong>{board.totalOpen}</strong> open opportunit{board.totalOpen === 1 ? 'y' : 'ies'}
            {board.lastCalculated && (
              <span style={{ color: '#8b98a5', marginLeft: '0.75rem', fontSize: '0.8125rem' }}>
                Last calculated {new Date(board.lastCalculated).toLocaleString('en-US')}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <ToggleSwitch on={currentOnly} onChange={setCurrentOnly} label="Current members only" />
            <PremiumFilterControl value={premiumFilter} onChange={setPremiumFilter} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" onClick={mineTimelines} disabled={mining}>
            {mining ? 'Mining…' : 'Mine timelines from messages'}
          </button>
          <button type="button" className="btn btn-primary" onClick={recompute} disabled={recomputing}>
            {recomputing ? 'Recalculating…' : 'Recalculate'}
          </button>
        </div>
      </div>

      {mineResult && (
        <div className="alert alert-success">
          Scanned messages for <strong>{mineResult.membersScanned}</strong> member(s), logged{' '}
          <strong>{mineResult.eventsCreated}</strong> new timeline event(s) (first messages, goals, wins, problems,
          dollar amounts mentioned). Re-running never duplicates — check each member&apos;s Timeline.
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {activeCategories.length === 0 ? (
        <div className="card">
          No open opportunities for this filter. Try &quot;Current members only&quot; / the Premium filter above, or
          run Recalculate after new activity, imports, wins, or roadmap changes.
        </div>
      ) : (
        activeCategories.map((cat) => (
          <div className="card" key={cat.category}>
            <h2>
              {cat.emoji} {cat.title} <span style={{ color: '#8b98a5', fontWeight: 400 }}>({cat.cards.length})</span>
            </h2>
            <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>{cat.blurb}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {cat.cards.map((card) => {
                const href = card.fromId ? `/users/${encodeURIComponent(card.fromId)}` : `/users/by-id/${card.userId}`;
                return (
                  <div
                    key={card.userId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '1rem',
                      padding: '0.75rem 1rem',
                      border: '1px solid #2f3336',
                      borderRadius: 8,
                      background: '#0f1419',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <a href={href} style={{ fontWeight: 600, color: '#e7e9ea', textDecoration: 'none' }}>
                          {card.displayName || card.username || card.fromId || `Member ${card.userId}`}
                        </a>
                        {card.isPremium && <span className="badge badge-premium">Premium</span>}
                        {card.isLifetime && <span className="badge badge-success">Lifetime</span>}
                        {!card.isCurrentMember && <span className="badge badge-muted">Not a member</span>}
                        <span className={`badge ${scoreBadgeClass(card.score)}`}>Score {card.score}</span>
                      </div>
                      {card.reason && (
                        <div style={{ fontSize: '0.9375rem', color: '#e7e9ea', marginTop: '0.3rem', fontWeight: 500 }}>
                          {card.reason}
                        </div>
                      )}
                      {card.recommendedAction && (
                        <div style={{ fontSize: '0.8125rem', color: '#8b98a5', marginTop: '0.15rem' }}>
                          → {card.recommendedAction}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={pendingIds.has(card.userId)}
                      onClick={() => markDone(card.userId)}
                      style={{ flexShrink: 0 }}
                    >
                      Mark done
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </>
  );
}
