'use client';

import { useEffect, useState } from 'react';

export interface MemberOption {
  from_id: string;
  display_name: string | null;
  username: string | null;
}

interface Candidate {
  id: number;
  from_id: string | null;
  display_name: string | null;
  username: string | null;
  email?: string | null;
}

/** Search-as-you-type member picker backed by /api/members/search (all members, active or not). */
export function MemberSearchInput({
  value,
  onSelect,
  onClear,
  placeholder = 'Buscar miembro por nombre, usuario o email…',
}: {
  value: MemberOption | null;
  onSelect: (member: MemberOption) => void;
  onClear: () => void;
  placeholder?: string;
}) {
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
    <div>
      {value && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.875rem' }}>
            {value.display_name || value.username || value.from_id}
            {value.username ? ` (@${value.username})` : ''}
          </span>
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem' }} onClick={onClear}>
            Quitar
          </button>
        </div>
      )}
      <input
        type="text"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', maxWidth: 320, background: '#0f1419', border: '1px solid #2f3336', color: '#e7e9ea', padding: '0.4rem 0.6rem', borderRadius: 6, fontSize: '0.8125rem' }}
      />
      {searching && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#8b98a5' }}>Buscando…</span>}
      {results.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0' }}>
          {results
            .filter((r) => r.from_id)
            .map((r) => (
              <li key={r.id} style={{ marginBottom: '0.25rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.8125rem' }}
                  onClick={() => {
                    onSelect({ from_id: r.from_id as string, display_name: r.display_name, username: r.username });
                    setQ('');
                    setResults([]);
                  }}
                >
                  {r.display_name || r.username || `Miembro ${r.id}`} {r.username ? `(@${r.username})` : ''}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
