'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

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
}

const ACCENT = '#7c6af7';
const ACCENT_DIM = '#3b3666';
const COLORS = [
  '#7c6af7', '#60a5fa', '#34d399', '#fb923c', '#f472b6',
  '#facc15', '#a78bfa', '#38bdf8', '#4ade80', '#f87171',
];

export default function IntelligencePage() {
  const [rows, setRows] = useState<PersonaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/personas')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setRows(data);
        else setError(data.error ?? 'Failed to load');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const topicCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      for (const t of row.topics ?? []) {
        map.set(t, (map.get(t) ?? 0) + 1);
      }
    }
    return Array.from(map.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (selectedTopics.size > 0) {
      list = list.filter((r) =>
        (r.topics ?? []).some((t) => selectedTopics.has(t))
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.display_name.toLowerCase().includes(q) ||
          (r.username ?? '').toLowerCase().includes(q) ||
          (r.summary ?? '').toLowerCase().includes(q) ||
          (r.inferred_occupation ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, selectedTopics, search]);

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
    setSearch('');
  }

  const avatar = (row: PersonaRow) => {
    const url = row.profile_photo_urls?.[0];
    if (url) return <img src={url} alt={row.display_name} className="intel-avatar" />;
    const initials = row.display_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return <div className="intel-avatar intel-avatar-fallback">{initials}</div>;
  };

  if (loading) return <div className="intel-loading">Loading intelligence data…</div>;
  if (error) return <div className="intel-error">Error: {error}</div>;
  if (rows.length === 0)
    return (
      <div className="intel-empty">
        <h2>No personas generated yet</h2>
        <p>Go to a contact profile and generate their AI persona first.</p>
      </div>
    );

  return (
    <div className="intel-root">
      <div className="intel-header">
        <div>
          <h1 className="intel-title">People Intelligence</h1>
          <p className="intel-subtitle">
            {rows.length} profiles with AI personas{' '}
            {filtered.length !== rows.length && `· ${filtered.length} shown`}
          </p>
        </div>
        <div className="intel-search-wrap">
          <input
            className="intel-search"
            placeholder="Search by name, occupation, summary…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {(selectedTopics.size > 0 || search) && (
            <button className="intel-clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {topicCounts.length > 0 && (
        <section className="intel-chart-section">
          <h2 className="intel-section-title">Topics across the group</h2>
          <p className="intel-section-hint">Click a bar to filter by topic</p>
          <div className="intel-chart-wrap">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={topicCounts}
                layout="vertical"
                margin={{ top: 4, right: 32, bottom: 4, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#888', fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="topic"
                  width={180}
                  tick={{ fill: '#ccc', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#2a2a3a' }}
                  contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8 }}
                  labelStyle={{ color: '#fff' }}
                  itemStyle={{ color: ACCENT }}
                  formatter={(v: number) => [`${v} people`, 'Count']}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => toggleTopic(d.topic)}>
                  {topicCounts.map((entry, i) => (
                    <Cell
                      key={entry.topic}
                      fill={selectedTopics.has(entry.topic) ? ACCENT : COLORS[i % COLORS.length]}
                      opacity={selectedTopics.size === 0 || selectedTopics.has(entry.topic) ? 1 : 0.35}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="intel-topic-pills">
            {topicCounts.map((tc, i) => (
              <button
                key={tc.topic}
                className={`intel-pill${selectedTopics.has(tc.topic) ? ' active' : ''}`}
                style={{ '--pill-color': COLORS[i % COLORS.length] } as React.CSSProperties}
                onClick={() => toggleTopic(tc.topic)}
              >
                {tc.topic}
                <span className="intel-pill-count">{tc.count}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="intel-grid-section">
        <h2 className="intel-section-title">
          {selectedTopics.size > 0
            ? `People interested in: ${Array.from(selectedTopics).join(', ')}`
            : 'All profiles'}
        </h2>
        {filtered.length === 0 ? (
          <div className="intel-no-match">No profiles match the current filters.</div>
        ) : (
          <div className="intel-grid">
            {filtered.map((row) => (
              <a key={row.id} href={`/users/${row.from_id}`} className="intel-card">
                <div className="intel-card-top">
                  {avatar(row)}
                  <div className="intel-card-identity">
                    <div className="intel-card-name">{row.display_name}</div>
                    {row.username && <div className="intel-card-username">@{row.username}</div>}
                    {row.inferred_occupation && (
                      <div className="intel-card-occupation">{row.inferred_occupation}</div>
                    )}
                  </div>
                  {row.is_premium && <span className="intel-premium" title="Premium">★</span>}
                </div>

                {row.summary && (
                  <p className="intel-card-summary">{row.summary}</p>
                )}

                {(row.topics ?? []).length > 0 && (
                  <div className="intel-card-topics">
                    {(row.topics ?? []).slice(0, 5).map((t) => (
                      <span
                        key={t}
                        className={`intel-card-topic${selectedTopics.has(t) ? ' highlighted' : ''}`}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {(row.inferred_goals ?? []).length > 0 && (
                  <div className="intel-card-goals">
                    <span className="intel-card-label">Goals</span>
                    <ul>
                      {(row.inferred_goals ?? []).slice(0, 2).map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </a>
            ))}
          </div>
        )}
      </section>

      <style>{`
        .intel-root {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem 1.5rem 4rem;
        }
        .intel-loading, .intel-error, .intel-empty {
          padding: 4rem 2rem;
          text-align: center;
          color: #888;
        }
        .intel-error { color: #f87171; }
        .intel-empty h2 { margin-bottom: .5rem; }

        .intel-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 2.5rem;
          flex-wrap: wrap;
        }
        .intel-title {
          font-size: 1.75rem;
          font-weight: 700;
          margin: 0 0 .25rem;
        }
        .intel-subtitle { color: #888; margin: 0; font-size: .9rem; }
        .intel-search-wrap { display: flex; gap: .5rem; align-items: center; }
        .intel-search {
          background: #1a1a2e;
          border: 1px solid #333;
          border-radius: 8px;
          padding: .5rem .9rem;
          color: #fff;
          font-size: .9rem;
          width: 280px;
          outline: none;
        }
        .intel-search:focus { border-color: ${ACCENT}; }
        .intel-clear {
          background: transparent;
          border: 1px solid #444;
          border-radius: 6px;
          color: #aaa;
          padding: .4rem .75rem;
          font-size: .8rem;
          cursor: pointer;
        }
        .intel-clear:hover { border-color: #888; color: #fff; }

        .intel-chart-section, .intel-grid-section {
          margin-bottom: 2.5rem;
        }
        .intel-section-title {
          font-size: 1.1rem;
          font-weight: 600;
          margin: 0 0 .25rem;
        }
        .intel-section-hint { font-size: .8rem; color: #666; margin: 0 0 1rem; }
        .intel-chart-wrap {
          background: #111122;
          border: 1px solid #222;
          border-radius: 12px;
          padding: 1.25rem 1rem;
          margin-bottom: 1rem;
        }

        .intel-topic-pills {
          display: flex;
          flex-wrap: wrap;
          gap: .4rem;
        }
        .intel-pill {
          display: inline-flex;
          align-items: center;
          gap: .35rem;
          background: #1a1a2e;
          border: 1px solid #333;
          border-radius: 20px;
          padding: .25rem .65rem;
          font-size: .78rem;
          color: #ccc;
          cursor: pointer;
          transition: all .15s;
        }
        .intel-pill:hover { border-color: var(--pill-color); color: #fff; }
        .intel-pill.active {
          background: var(--pill-color);
          border-color: var(--pill-color);
          color: #fff;
          font-weight: 600;
        }
        .intel-pill-count {
          background: rgba(255,255,255,.15);
          border-radius: 10px;
          padding: 0 .4rem;
          font-size: .7rem;
        }

        .intel-no-match { color: #666; padding: 2rem 0; text-align: center; }

        .intel-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1rem;
        }
        .intel-card {
          background: #111122;
          border: 1px solid #222;
          border-radius: 12px;
          padding: 1.25rem;
          text-decoration: none;
          color: inherit;
          transition: border-color .15s, transform .15s;
          display: flex;
          flex-direction: column;
          gap: .75rem;
        }
        .intel-card:hover {
          border-color: ${ACCENT};
          transform: translateY(-2px);
        }
        .intel-card-top {
          display: flex;
          align-items: center;
          gap: .75rem;
          position: relative;
        }
        .intel-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .intel-avatar-fallback {
          background: ${ACCENT_DIM};
          color: ${ACCENT};
          font-weight: 700;
          font-size: .85rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .intel-card-identity { flex: 1; min-width: 0; }
        .intel-card-name {
          font-weight: 600;
          font-size: .95rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .intel-card-username { font-size: .78rem; color: #666; }
        .intel-card-occupation { font-size: .78rem; color: #7c6af7; margin-top: .1rem; }
        .intel-premium {
          color: #facc15;
          font-size: .9rem;
          position: absolute;
          top: 0;
          right: 0;
        }
        .intel-card-summary {
          font-size: .82rem;
          color: #aaa;
          line-height: 1.5;
          margin: 0;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .intel-card-topics {
          display: flex;
          flex-wrap: wrap;
          gap: .3rem;
        }
        .intel-card-topic {
          background: #1e1e32;
          border: 1px solid #333;
          border-radius: 12px;
          padding: .15rem .5rem;
          font-size: .72rem;
          color: #999;
        }
        .intel-card-topic.highlighted {
          background: ${ACCENT_DIM};
          border-color: ${ACCENT};
          color: #c4b9ff;
        }
        .intel-card-goals {
          font-size: .78rem;
        }
        .intel-card-label {
          font-weight: 600;
          color: #666;
          font-size: .7rem;
          text-transform: uppercase;
          letter-spacing: .05em;
          display: block;
          margin-bottom: .25rem;
        }
        .intel-card-goals ul {
          margin: 0;
          padding-left: 1.1em;
          color: #888;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
