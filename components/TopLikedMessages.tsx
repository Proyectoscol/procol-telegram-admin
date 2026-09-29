'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LoadingSpinner } from '@/components/Loading';
import { MemberSearchInput, type MemberOption } from '@/components/MemberSearchInput';
import { Pagination, PAGE_SIZE } from '@/components/Pagination';
import { ExportCsvModal, type ExportColumn } from '@/components/ExportCsvModal';
import { formatMessagesAsText, type MessageForTextExport } from '@/lib/utils/formatMessagesAsText';

interface TopMessage {
  chat_id: number;
  message_id: number;
  chat_name: string | null;
  author_from_id: string | null;
  author_display_name: string | null;
  author_username: string | null;
  date: string | null;
  text: string | null;
  reaction_count: number;
  quote_count: number;
  reactions_by_emoji: { emoji: string | null; count: number }[];
}

interface MessageDetail {
  chat_id: number;
  message_id: number;
  chat_name: string | null;
  author_from_id: string | null;
  author_display_name: string | null;
  author_username: string | null;
  date: string | null;
  text: string | null;
  media_type: string | null;
  reaction_total: number;
  reactions: { reactor_from_id: string; reactor_display_name: string | null; reactor_username: string | null; emoji: string | null; reacted_at: string | null }[];
  quotes: { message_id: number; author_from_id: string | null; author_display_name: string | null; author_username: string | null; text: string | null; date: string | null }[];
}

type SortKey = 'chat' | 'date' | 'reactions' | 'quotes';

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'chat', label: 'Chat' },
  { key: 'date', label: 'Date' },
  { key: 'reactions', label: 'Reactions' },
  { key: 'quotes', label: 'Quotes' },
];

function authorLabel(m: { author_display_name: string | null; author_username: string | null; author_from_id: string | null }): string {
  return m.author_display_name || (m.author_username ? `@${m.author_username}` : null) || m.author_from_id || '—';
}

const MESSAGE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'rank', label: 'Rank' },
  { key: 'author', label: 'Author' },
  { key: 'chat', label: 'Chat' },
  { key: 'date', label: 'Date' },
  { key: 'text', label: 'Message' },
  { key: 'reaction_count', label: 'Reactions' },
  { key: 'reactions_breakdown', label: 'Reaction breakdown' },
  { key: 'quote_count', label: 'Quotes' },
];

const EXPORT_COUNT_OPTIONS = [10, 20, 50, 100] as const;

function sortValue(m: TopMessage, key: SortKey): string | number {
  switch (key) {
    case 'chat': return (m.chat_name || '').toLowerCase();
    case 'date': return m.date ? new Date(m.date).getTime() : 0;
    case 'reactions': return m.reaction_count;
    case 'quotes': return m.quote_count;
  }
}

export function TopLikedMessages({
  chatIds,
  start,
  end,
  defaultAuthor,
}: {
  chatIds: number[];
  start: string | null;
  end: string | null;
  defaultAuthor: MemberOption | null;
}) {
  const [authorFilter, setAuthorFilter] = useState<MemberOption | null>(null);
  const defaultApplied = useRef(false);

  useEffect(() => {
    if (!defaultApplied.current && defaultAuthor) {
      setAuthorFilter(defaultAuthor);
      defaultApplied.current = true;
    }
  }, [defaultAuthor]);

  const [messages, setMessages] = useState<TopMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<SortKey>('reactions');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [exportCount, setExportCount] = useState<number>(10);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!start || !end) return;
    setLoading(true);
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    chatIds.forEach((id) => params.append('chatId', String(id)));
    params.set('start', start);
    params.set('end', end);
    if (authorFilter?.from_id) params.set('authorFromId', authorFilter.from_id);
    fetch(`/api/stats/top-messages?${params}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load top messages');
        return r.json();
      })
      .then((payload) => {
        if (payload.error) throw new Error(payload.error);
        setMessages(Array.isArray(payload.messages) ? payload.messages : []);
        setError(null);
        setPage(1);
      })
      .catch((e) => { if (e?.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [chatIds.join(','), start, end, authorFilter?.from_id]);

  const sortedMessages = useMemo(() => {
    const copy = [...messages];
    copy.sort((a, b) => {
      const av = sortValue(a, sortBy);
      const bv = sortValue(b, sortBy);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [messages, sortBy, sortDir]);

  const pagedMessages = sortedMessages.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const exportRows = useMemo(
    () =>
      sortedMessages.slice(0, exportCount).map((m, i) => ({
        rank: i + 1,
        author: authorLabel(m),
        chat: m.chat_name || '—',
        date: m.date ? new Date(m.date).toLocaleString('en-US') : '—',
        text: m.text || '(no text)',
        reaction_count: m.reaction_count,
        reactions_breakdown: m.reactions_by_emoji.map((e) => `${e.emoji ?? '❤️'} ${e.count}`).join(', '),
        quote_count: m.quote_count,
      })),
    [sortedMessages, exportCount]
  );

  const openDetail = (chatId: number, messageId: number) => {
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    fetch(`/api/stats/message-detail?chatId=${chatId}&messageId=${messageId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load message detail');
        return r.json();
      })
      .then((payload) => {
        if (payload.error) throw new Error(payload.error);
        setDetail(payload);
      })
      .catch((e) => setDetailError(e.message))
      .finally(() => setDetailLoading(false));
  };

  const isDefault = !!authorFilter && !!defaultAuthor && authorFilter.from_id === defaultAuthor.from_id;

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>Top Liked Messages</h2>
      <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
        All messages with reactions in the filtered range and chats, ranked by total reactions. Quote counts are all-time. Sort any column and page through the full list.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1rem' }}>
        <div>
          <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem', color: '#8b98a5' }}>
            Filter by author {authorFilter && (isDefault ? '(default)' : '(this session)')}
          </span>
          <MemberSearchInput value={authorFilter} onSelect={setAuthorFilter} onClear={() => setAuthorFilter(null)} />
        </div>
        <div>
          <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem', color: '#8b98a5' }}>
            Export (by current sort)
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <select
              value={exportCount}
              onChange={(e) => setExportCount(Number(e.target.value))}
              style={{ padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid #2f3336', background: '#0f1419', color: '#e7e9ea', fontSize: '0.8125rem' }}
            >
              {EXPORT_COUNT_OPTIONS.map((n) => (
                <option key={n} value={n} disabled={n > messages.length && messages.length > 0}>
                  First {n}
                </option>
              ))}
              <option value={messages.length || 1}>All fetched ({messages.length})</option>
            </select>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8125rem', padding: '0.4rem 0.75rem' }} onClick={() => setExportOpen(true)} disabled={messages.length === 0}>
              Export
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5' }}>
          <LoadingSpinner size="sm" />
          <span>Loading…</span>
        </div>
      ) : error ? (
        <p style={{ color: '#f91854', fontSize: '0.875rem' }}>{error}</p>
      ) : messages.length === 0 ? (
        <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>
          No messages with reactions in this range{authorFilter ? ' for this author' : ''}.
        </p>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th className="th-index">#</th>
                <th>Message</th>
                {SORT_COLUMNS.map(({ key, label }) => (
                  <th key={key} className="sortable-th">
                    <span className="sortable-th-label">{label}</span>
                    <span className="sortable-th-arrows">
                      <button
                        type="button"
                        className={`sort-arrow ${sortBy === key && sortDir === 'asc' ? 'sort-arrow-active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setSortBy(key); setSortDir('asc'); setPage(1); }}
                        aria-label={`Sort by ${label} ascending`}
                        title="Sort ascending"
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden><path d="M5 2L2 6h6L5 2z" /></svg>
                      </button>
                      <button
                        type="button"
                        className={`sort-arrow ${sortBy === key && sortDir === 'desc' ? 'sort-arrow-active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setSortBy(key); setSortDir('desc'); setPage(1); }}
                        aria-label={`Sort by ${label} descending`}
                        title="Sort descending"
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden><path d="M5 8L2 4h6L5 8z" /></svg>
                      </button>
                    </span>
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagedMessages.map((m, i) => (
                <tr key={`${m.chat_id}-${m.message_id}`}>
                  <td className="th-index">{(page - 1) * PAGE_SIZE + i + 1}</td>
                  <td style={{ maxWidth: 320, minWidth: 220 }}>
                    <div
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        fontSize: '0.8125rem',
                      }}
                    >
                      {m.text || <em style={{ color: '#8b98a5' }}>(no text)</em>}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#8b98a5', marginTop: '0.15rem' }}>{authorLabel(m)}</div>
                  </td>
                  <td>{m.chat_name || '—'}</td>
                  <td>{m.date ? new Date(m.date).toLocaleString('en-US') : '—'}</td>
                  <td>
                    <strong>{m.reaction_count}</strong>{' '}
                    {m.reactions_by_emoji.map((e, idx) => (
                      <span key={idx} style={{ marginLeft: idx === 0 ? '0.35rem' : '0.25rem', fontSize: '0.8125rem', color: '#8b98a5' }}>
                        {e.emoji ?? '❤️'} {e.count}
                      </span>
                    ))}
                  </td>
                  <td>{m.quote_count}</td>
                  <td>
                    <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} onClick={() => openDetail(m.chat_id, m.message_id)}>
                      View detail
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sortedMessages.length > 0 && (
        <Pagination currentPage={page} totalItems={sortedMessages.length} onPageChange={setPage} itemLabel="messages" />
      )}

      <ExportCsvModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export Top Liked Messages"
        filenamePrefix="top-liked-messages"
        rows={exportRows}
        columns={MESSAGE_EXPORT_COLUMNS}
        formatText={(rows) => formatMessagesAsText(rows as MessageForTextExport[])}
        showMemberFilter={false}
      />

      {(detailLoading || detail || detailError) && (
        <div className="modal-backdrop" onClick={() => { setDetail(null); setDetailError(null); }} role="presentation">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Message detail</h3>
              <button type="button" className="modal-close" onClick={() => { setDetail(null); setDetailError(null); }} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              {detailLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5' }}>
                  <LoadingSpinner size="sm" />
                  <span>Loading…</span>
                </div>
              ) : detailError ? (
                <p style={{ color: '#f91854', fontSize: '0.875rem' }}>{detailError}</p>
              ) : detail ? (
                <>
                  <section>
                    <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: '#8b98a5' }}>
                      {detail.chat_name || '—'} · {authorLabel(detail)} · {detail.date ? new Date(detail.date).toLocaleString('en-US') : '—'}
                    </p>
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: '0.875rem' }}>{detail.text || <em>(no text{detail.media_type ? ` — ${detail.media_type}` : ''})</em>}</p>
                  </section>
                  <section>
                    <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>
                      Reactions ({detail.reaction_total > detail.reactions.length
                        ? `${detail.reactions.length} named of ${detail.reaction_total} total`
                        : detail.reactions.length})
                    </h4>
                    {detail.reaction_total > detail.reactions.length && (
                      <p style={{ color: '#8b98a5', fontSize: '0.75rem', marginTop: '-0.25rem', marginBottom: '0.5rem' }}>
                        Telegram only exposes a capped sample of named reactors — the true total is higher than who we can name.
                      </p>
                    )}
                    {detail.reactions.length === 0 ? (
                      <p style={{ color: '#8b98a5', fontSize: '0.8125rem' }}>No reactions.</p>
                    ) : (
                      detail.reactions.map((r, idx) => (
                        <div key={idx} className="recent-msg">
                          <div className="meta">{r.reacted_at ? new Date(r.reacted_at).toLocaleString('en-US') : ''}</div>
                          <div className="text">{r.emoji ?? '❤️'} {r.reactor_display_name || (r.reactor_username ? `@${r.reactor_username}` : r.reactor_from_id)}</div>
                        </div>
                      ))
                    )}
                  </section>
                  <section>
                    <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>
                      Quoted by ({detail.quotes.length})
                    </h4>
                    {detail.quotes.length === 0 ? (
                      <p style={{ color: '#8b98a5', fontSize: '0.8125rem' }}>No one has quoted it yet.</p>
                    ) : (
                      detail.quotes.map((q) => (
                        <div key={q.message_id} className="recent-msg">
                          <div className="meta">
                            {q.date ? new Date(q.date).toLocaleString('en-US') : ''} · {q.author_display_name || (q.author_username ? `@${q.author_username}` : q.author_from_id) || '—'}
                          </div>
                          <div className="text">{q.text || <em>(no text)</em>}</div>
                        </div>
                      ))
                    )}
                  </section>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
