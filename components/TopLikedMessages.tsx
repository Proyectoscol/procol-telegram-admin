'use client';

import { useEffect, useRef, useState } from 'react';
import { LoadingSpinner } from '@/components/Loading';
import { MemberSearchInput, type MemberOption } from '@/components/MemberSearchInput';

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
  reactions: { reactor_from_id: string; reactor_display_name: string | null; reactor_username: string | null; emoji: string | null; reacted_at: string | null }[];
  quotes: { message_id: number; author_from_id: string | null; author_display_name: string | null; author_username: string | null; text: string | null; date: string | null }[];
}

function authorLabel(m: { author_display_name: string | null; author_username: string | null; author_from_id: string | null }): string {
  return m.author_display_name || (m.author_username ? `@${m.author_username}` : null) || m.author_from_id || '—';
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

  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

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
      })
      .catch((e) => { if (e?.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [chatIds.join(','), start, end, authorFilter?.from_id]);

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
      <h2 style={{ marginTop: 0 }}>Mensajes más gustados</h2>
      <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
        Top 10 mensajes con más reacciones en el rango y chats filtrados. El conteo de citas es de todo el historial.
      </p>

      <div style={{ marginBottom: '1rem' }}>
        <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem', color: '#8b98a5' }}>
          Filtrar por autor {authorFilter && (isDefault ? '(predeterminado)' : '(esta sesión)')}
        </span>
        <MemberSearchInput value={authorFilter} onSelect={setAuthorFilter} onClear={() => setAuthorFilter(null)} />
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5' }}>
          <LoadingSpinner size="sm" />
          <span>Cargando…</span>
        </div>
      ) : error ? (
        <p style={{ color: '#f91854', fontSize: '0.875rem' }}>{error}</p>
      ) : messages.length === 0 ? (
        <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>
          No hay mensajes con reacciones en el rango{authorFilter ? ' para este autor' : ''}.
        </p>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th className="th-index">#</th>
                <th>Autor</th>
                <th>Chat</th>
                <th>Fecha</th>
                <th>Reacciones</th>
                <th>Citas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m, i) => (
                <tr key={`${m.chat_id}-${m.message_id}`}>
                  <td className="th-index">{i + 1}</td>
                  <td>{authorLabel(m)}</td>
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
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(detailLoading || detail || detailError) && (
        <div className="modal-backdrop" onClick={() => { setDetail(null); setDetailError(null); }} role="presentation">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Detalle del mensaje</h3>
              <button type="button" className="modal-close" onClick={() => { setDetail(null); setDetailError(null); }} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              {detailLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5' }}>
                  <LoadingSpinner size="sm" />
                  <span>Cargando…</span>
                </div>
              ) : detailError ? (
                <p style={{ color: '#f91854', fontSize: '0.875rem' }}>{detailError}</p>
              ) : detail ? (
                <>
                  <section>
                    <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: '#8b98a5' }}>
                      {detail.chat_name || '—'} · {authorLabel(detail)} · {detail.date ? new Date(detail.date).toLocaleString('en-US') : '—'}
                    </p>
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: '0.875rem' }}>{detail.text || <em>(sin texto{detail.media_type ? ` — ${detail.media_type}` : ''})</em>}</p>
                  </section>
                  <section>
                    <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>
                      Reacciones ({detail.reactions.length})
                    </h4>
                    {detail.reactions.length === 0 ? (
                      <p style={{ color: '#8b98a5', fontSize: '0.8125rem' }}>Sin reacciones.</p>
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
                      Citado por ({detail.quotes.length})
                    </h4>
                    {detail.quotes.length === 0 ? (
                      <p style={{ color: '#8b98a5', fontSize: '0.8125rem' }}>Nadie lo ha citado.</p>
                    ) : (
                      detail.quotes.map((q) => (
                        <div key={q.message_id} className="recent-msg">
                          <div className="meta">
                            {q.date ? new Date(q.date).toLocaleString('en-US') : ''} · {q.author_display_name || (q.author_username ? `@${q.author_username}` : q.author_from_id) || '—'}
                          </div>
                          <div className="text">{q.text || <em>(sin texto)</em>}</div>
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
