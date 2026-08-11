'use client';

import { useState, useRef } from 'react';
import { LoadingSpinner } from '@/components/Loading';
import { ExportCsvModal, type ExportColumn } from '@/components/ExportCsvModal';

const ROSTER_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'from_id', label: 'User ID' },
  { key: 'username', label: 'Username' },
  { key: 'display_name', label: 'Contact' },
  { key: 'is_current_member', label: 'Member' },
  { key: 'is_premium', label: 'Premium' },
  { key: 'messages_sent', label: 'Messages' },
  { key: 'reactions_given', label: 'Reactions given' },
];

export default function ImportPage() {
  const [userFile, setUserFile] = useState<File | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userResult, setUserResult] = useState<{
    created: number;
    updated: number;
    total: number;
    errors?: string[];
    errorCount?: number;
  } | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const userInputRef = useRef<HTMLInputElement>(null);

  const [questionnaireFile, setQuestionnaireFile] = useState<File | null>(null);
  const [questionnairePreviewLoading, setQuestionnairePreviewLoading] = useState(false);
  const [questionnaireApplyLoading, setQuestionnaireApplyLoading] = useState(false);
  const [questionnairePreview, setQuestionnairePreview] = useState<{
    counts: { total: number; update: number; review: number; skip: number };
  } | null>(null);
  const [questionnaireResult, setQuestionnaireResult] = useState<{
    total: number;
    updated: number;
    unmatched: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const [questionnaireError, setQuestionnaireError] = useState<string | null>(null);
  const questionnaireInputRef = useRef<HTMLInputElement>(null);

  const handleQuestionnairePreview = async () => {
    if (!questionnaireFile) {
      setQuestionnaireError('Please select a CSV file.');
      return;
    }
    setQuestionnaireError(null);
    setQuestionnairePreview(null);
    setQuestionnaireResult(null);
    setQuestionnairePreviewLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', questionnaireFile);
      const res = await fetch('/api/import/questionnaire/preview', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setQuestionnairePreview(data);
    } catch (err) {
      setQuestionnaireError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setQuestionnairePreviewLoading(false);
    }
  };

  const handleQuestionnaireApply = async () => {
    if (!questionnaireFile) return;
    setQuestionnaireError(null);
    setQuestionnaireApplyLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', questionnaireFile);
      const res = await fetch('/api/import/questionnaire', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setQuestionnaireResult(data);
      setQuestionnairePreview(null);
      setQuestionnaireFile(null);
      if (questionnaireInputRef.current) questionnaireInputRef.current.value = '';
    } catch (err) {
      setQuestionnaireError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setQuestionnaireApplyLoading(false);
    }
  };

  const IMPORT_LIST_TYPES = [
    { id: 'PAYMENT_PLAN', label: 'Payment plan list' },
    { id: 'LIFETIME', label: 'Lifetime member list' },
    { id: 'PREMIUM', label: 'Premium member list' },
    { id: 'EVENT_TICKET', label: 'Event ticket list' },
    { id: 'EMAIL', label: 'Email list' },
    { id: 'MEMBER_UPDATE', label: 'General member update / notes' },
  ];
  const [listType, setListType] = useState(IMPORT_LIST_TYPES[0].id);
  const [listText, setListText] = useState('');
  const [listPreview, setListPreview] = useState<{
    rows: { input: { name: string | null; username: string | null; telegramId: string | null; email: string | null }; status: string; matchedUserName?: string; reason?: string }[];
    counts: { total: number; update: number; review: number; skip: number };
  } | null>(null);
  const [listPreviewLoading, setListPreviewLoading] = useState(false);
  const [listApplyLoading, setListApplyLoading] = useState(false);
  const [listApplyResult, setListApplyResult] = useState<{
    total: number;
    updated: number;
    tagged: number;
    unmatched: number;
    skipped: number;
    noChange: number;
    errors: string[];
  } | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const handleListPreview = async () => {
    if (!listText.trim()) {
      setListError('Paste some rows first.');
      return;
    }
    setListError(null);
    setListPreview(null);
    setListApplyResult(null);
    setListPreviewLoading(true);
    try {
      const res = await fetch('/api/import/list/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importType: listType, text: listText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setListPreview(data);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setListPreviewLoading(false);
    }
  };

  const handleListApply = async () => {
    if (!listText.trim()) return;
    setListError(null);
    setListApplyLoading(true);
    try {
      const res = await fetch('/api/import/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importType: listType, text: listText, fileName: 'pasted-list' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setListApplyResult(data);
      setListPreview(null);
      setListText('');
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setListApplyLoading(false);
    }
  };

  const [scraperRefreshing, setScraperRefreshing] = useState(false);
  const [scraperRefreshResult, setScraperRefreshResult] = useState<{
    main: { groupTitle: string; telegramGroupId: string; memberCount: number; added?: number; updated?: number; error?: string } | null;
    premium: { groupTitle: string; telegramGroupId: string; memberCount: number; updated?: number; error?: string } | null;
    durationMs: number;
  } | null>(null);
  const [scraperRefreshError, setScraperRefreshError] = useState<string | null>(null);

  const handleScraperRefresh = async () => {
    setScraperRefreshError(null);
    setScraperRefreshResult(null);
    setScraperRefreshing(true);
    try {
      const res = await fetch('/api/telegram-scraper/refresh', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');
      setScraperRefreshResult(data);
    } catch (err) {
      setScraperRefreshError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setScraperRefreshing(false);
    }
  };

  const [chatSyncing, setChatSyncing] = useState(false);
  const [chatSyncResult, setChatSyncResult] = useState<{
    groups: {
      telegramGroupId: string;
      title: string;
      messagesFetched: number;
      messagesInserted: number;
      reactionsInserted: number;
      hasMore: boolean;
      error?: string;
    }[];
    durationMs: number;
  } | null>(null);
  const [chatSyncError, setChatSyncError] = useState<string | null>(null);

  const handleChatSync = async () => {
    setChatSyncError(null);
    setChatSyncResult(null);
    setChatSyncing(true);
    try {
      const res = await fetch('/api/telegram-scraper/sync-chats', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setChatSyncResult(data);
    } catch (err) {
      setChatSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setChatSyncing(false);
    }
  };

  const [rosterModalRole, setRosterModalRole] = useState<'main' | 'premium' | null>(null);
  const [rosterLoadingRole, setRosterLoadingRole] = useState<'main' | 'premium' | null>(null);
  const [rosterRows, setRosterRows] = useState<Record<string, unknown>[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const openRosterModal = async (role: 'main' | 'premium') => {
    setRosterError(null);
    setRosterLoadingRole(role);
    try {
      const res = await fetch(`/api/members/roster?role=${role}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load members');
      setRosterRows(Array.isArray(data.rows) ? data.rows : []);
      setRosterModalRole(role);
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : 'Failed to load members');
    } finally {
      setRosterLoadingRole(null);
    }
  };

  const [photosZipFile, setPhotosZipFile] = useState<File | null>(null);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosResult, setPhotosResult] = useState<{
    created: number;
    updated: number;
    total: number;
    photosUploaded: number;
    errors?: string[];
    errorCount?: number;
  } | null>(null);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userFile) {
      setUserError('Please select a file.');
      return;
    }
    setUserError(null);
    setUserResult(null);
    setUserLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', userFile);
      const res = await fetch('/api/import/users-update', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setUserResult(data);
      setUserFile(null);
      if (userInputRef.current) userInputRef.current.value = '';
    } catch (err) {
      setUserError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUserLoading(false);
    }
  };

  const handlePhotosZipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photosZipFile) {
      setPhotosError('Please select a ZIP file.');
      return;
    }
    setPhotosError(null);
    setPhotosResult(null);
    setPhotosLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', photosZipFile);
      const res = await fetch('/api/import/user-info-with-photos', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setPhotosResult(data);
      setPhotosZipFile(null);
      if (photosInputRef.current) photosInputRef.current.value = '';
    } catch (err) {
      setPhotosError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setPhotosLoading(false);
    }
  };

  return (
    <div>
      <h1>Import data</h1>
      <p style={{ color: '#8b98a5', marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
        <strong>Update members</strong> and <strong>Sync chats</strong> (automated Telegram sync), <strong>User info</strong> (profile data), and <strong>User info + profile photos</strong> (ZIP).
      </p>

      <section className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Update members (Telegram)</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Scrapes the Main and Premium groups directly from Telegram and applies the same updates as the manual CSV
          imports below — no script to run, no files to upload. Requires connecting a Telegram account and assigning
          the Main/Premium groups first in <a href="/settings">Settings → Telegram scraper</a>.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button type="button" className="btn" onClick={handleScraperRefresh} disabled={scraperRefreshing}>
            {scraperRefreshing ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <LoadingSpinner size="sm" />
                Updating…
              </span>
            ) : (
              'Update members'
            )}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => openRosterModal('main')} disabled={rosterLoadingRole === 'main'}>
            {rosterLoadingRole === 'main' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <LoadingSpinner size="sm" />
                Loading…
              </span>
            ) : (
              'Copy Main members'
            )}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => openRosterModal('premium')} disabled={rosterLoadingRole === 'premium'}>
            {rosterLoadingRole === 'premium' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <LoadingSpinner size="sm" />
                Loading…
              </span>
            ) : (
              'Copy Premium members'
            )}
          </button>
        </div>
        {rosterError && <div className="alert alert-error" style={{ marginTop: '1rem' }}>{rosterError}</div>}
        {scraperRefreshError && <div className="alert alert-error" style={{ marginTop: '1rem' }}>{scraperRefreshError}</div>}
        {scraperRefreshResult && (
          <div className="alert alert-success" style={{ marginTop: '1rem' }}>
            <div>
              {scraperRefreshResult.main && (
                <div>
                  <strong>Main</strong> ({scraperRefreshResult.main.groupTitle}):{' '}
                  {scraperRefreshResult.main.error
                    ? <span style={{ color: '#f91854' }}>{scraperRefreshResult.main.error}</span>
                    : <>{scraperRefreshResult.main.memberCount} members — added {scraperRefreshResult.main.added}, updated {scraperRefreshResult.main.updated}.</>}
                </div>
              )}
              {scraperRefreshResult.premium && (
                <div style={{ marginTop: scraperRefreshResult.main ? '0.35rem' : 0 }}>
                  <strong>Premium</strong> ({scraperRefreshResult.premium.groupTitle}):{' '}
                  {scraperRefreshResult.premium.error
                    ? <span style={{ color: '#f91854' }}>{scraperRefreshResult.premium.error}</span>
                    : <>{scraperRefreshResult.premium.memberCount} members — marked premium {scraperRefreshResult.premium.updated}.</>}
                </div>
              )}
              {!scraperRefreshResult.main && !scraperRefreshResult.premium && (
                <div>No group is assigned as Main or Premium yet.</div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Sync chats (Telegram)</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Pulls messages and reactions directly from Telegram for whichever groups have &quot;Sync chat&quot; enabled in{' '}
          <a href="/settings">Settings → Telegram scraper</a> — no more exporting <code style={{ background: '#2f3336', padding: '0.1rem 0.35rem', borderRadius: 4 }}>result.json</code> from
          Telegram Desktop by hand. Syncs incrementally (only new messages since last time) and is capped per click, so
          a large first-time backfill may take a few clicks — keep clicking &quot;Sync chats&quot; until no group reports
          &quot;more to sync&quot;.
        </p>
        <button type="button" className="btn" onClick={handleChatSync} disabled={chatSyncing}>
          {chatSyncing ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <LoadingSpinner size="sm" />
              Syncing…
            </span>
          ) : (
            'Sync chats'
          )}
        </button>
        {chatSyncError && <div className="alert alert-error" style={{ marginTop: '1rem' }}>{chatSyncError}</div>}
        {chatSyncResult && (
          <div className="alert alert-success" style={{ marginTop: '1rem' }}>
            {chatSyncResult.groups.map((g) => (
              <div key={g.telegramGroupId} style={{ marginBottom: '0.35rem' }}>
                <strong>{g.title}</strong>:{' '}
                {g.error ? (
                  <span style={{ color: '#f91854' }}>{g.error}</span>
                ) : (
                  <>
                    {g.messagesInserted} new message{g.messagesInserted === 1 ? '' : 's'}, {g.reactionsInserted} reaction{g.reactionsInserted === 1 ? '' : 's'}.
                    {g.hasMore && <span style={{ color: '#f90' }}> More to sync — click again.</span>}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <ExportCsvModal
        open={rosterModalRole !== null}
        onClose={() => setRosterModalRole(null)}
        title={rosterModalRole === 'main' ? 'Main members' : 'Premium members'}
        filenamePrefix={rosterModalRole === 'main' ? 'main-members' : 'premium-members'}
        rows={rosterRows}
        columns={ROSTER_EXPORT_COLUMNS}
      />

      <section className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>User info + profile photos (ZIP)</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Upload a <code style={{ background: '#2f3336', padding: '0.2rem 0.4rem', borderRadius: 4 }}>.zip</code> containing one folder of profile images (<code>profile_photos/</code>) and one or more JSON files (same structure as User info, with <code>profile_photos</code> paths). Each JSON can have ~90 users. Images are uploaded to Supabase Storage and URLs saved in the contact.
        </p>
        <form onSubmit={handlePhotosZipSubmit}>
          <div className="upload-zone">
            <label className="form-group">
              <span style={{ display: 'block', marginBottom: '0.5rem' }}>Select ZIP file</span>
              <input
                ref={photosInputRef}
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => setPhotosZipFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <p>{photosZipFile ? photosZipFile.name : 'No file selected'}</p>
          </div>
          {photosError && <div className="alert alert-error">{photosError}</div>}
          {photosResult && (
            <>
              <div className="alert alert-success">
                User info + photos import complete. Created: <strong>{photosResult.created}</strong>, updated: <strong>{photosResult.updated}</strong>, total: <strong>{photosResult.total}</strong>, profile photos uploaded: <strong>{photosResult.photosUploaded}</strong>.
              </div>
              {photosResult.errorCount != null && photosResult.errorCount > 0 && (
                <div className="alert" style={{ background: 'rgba(255, 165, 0, 0.15)', border: '1px solid #f90', color: '#f90' }}>
                  {photosResult.errorCount} error(s).
                  {photosResult.errors && photosResult.errors.length > 0 && (
                    <details style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
                      <summary>First errors</summary>
                      <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                        {photosResult.errors.slice(0, 10).map((e, i) => (
                          <li key={i} style={{ marginBottom: '0.25rem' }}>{e}</li>
                        ))}
                        {photosResult.errors.length > 10 && <li>… and {photosResult.errors.length - 10} more</li>}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </>
          )}
          <button type="submit" className="btn" disabled={!photosZipFile || photosLoading}>
            {photosLoading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <LoadingSpinner size="sm" />
                Uploading…
              </span>
            ) : (
              'Upload ZIP and import users + photos'
            )}
          </button>
        </form>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>User info (update contacts)</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Upload a JSON file with user profile data (e.g. from a user-list export). Each entry&apos;s <code style={{ background: '#2f3336', padding: '0.2rem 0.4rem', borderRadius: 4 }}>id</code> is matched to <code>from_id</code> as <code>user</code> + id (e.g. <code>5164610325</code> → <code>user5164610325</code>). Existing users are updated; new IDs create new contact rows.
        </p>
        <form onSubmit={handleUserSubmit}>
          <div className="upload-zone">
            <label className="form-group">
              <span style={{ display: 'block', marginBottom: '0.5rem' }}>Select user info JSON</span>
              <input
                ref={userInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => setUserFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <p>{userFile ? userFile.name : 'No file selected'}</p>
          </div>
          {userError && <div className="alert alert-error">{userError}</div>}
          {userResult && (
            <>
              <div className="alert alert-success">
                User info import complete. Created: {userResult.created}, updated: {userResult.updated}, total processed: {userResult.total}.
              </div>
              {userResult.errorCount != null && userResult.errorCount > 0 && (
                <div className="alert" style={{ background: 'rgba(255, 165, 0, 0.15)', border: '1px solid #f90', color: '#f90' }}>
                  {userResult.errorCount} row(s) had errors.
                  {userResult.errors && userResult.errors.length > 0 && (
                    <details style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
                      <summary>First errors</summary>
                      <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                        {userResult.errors.slice(0, 10).map((e, i) => (
                          <li key={i} style={{ marginBottom: '0.25rem' }}>{e}</li>
                        ))}
                        {userResult.errors.length > 10 && <li>… and {userResult.errors.length - 10} more</li>}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </>
          )}
          <button type="submit" className="btn" disabled={!userFile || userLoading}>
            {userLoading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <LoadingSpinner size="sm" />
                Uploading…
              </span>
            ) : (
              'Upload and update users'
            )}
          </button>
        </form>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>CRM list import</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Paste a list (name / username / email, one per line — tab, comma, or semicolon separated; a header row is
          fine). Rows are matched against existing members by username, Telegram ID, email, then exact name.
          Anything uncertain goes to the <a href="/review-queue">Review Queue</a> instead of creating a duplicate.
        </p>
        <div className="form-group">
          <label>Import type</label>
          <select value={listType} onChange={(e) => { setListType(e.target.value); setListPreview(null); setListApplyResult(null); }}>
            {IMPORT_LIST_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Rows</label>
          <textarea
            value={listText}
            onChange={(e) => { setListText(e.target.value); setListPreview(null); }}
            placeholder={'Jane Doe, jane@example.com, 500\n@johnny, john@example.com'}
            style={{ minHeight: 160, fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}
          />
        </div>
        {listError && <div className="alert alert-error">{listError}</div>}

        {listPreview && (
          <div className="alert" style={{ background: 'rgba(29,155,240,0.12)', border: '1px solid #1d9bf0', color: '#e7e9ea', marginBottom: '1rem' }}>
            {listPreview.counts.total} row(s): <strong>{listPreview.counts.update}</strong> will update an existing
            member, <strong>{listPreview.counts.review}</strong> need review, <strong>{listPreview.counts.skip}</strong> are
            empty and will be skipped.
          </div>
        )}

        {listApplyResult && (
          <div className="alert alert-success">
            Import complete. Updated: <strong>{listApplyResult.updated}</strong> (tagged: {listApplyResult.tagged}),
            sent to review: <strong>{listApplyResult.unmatched}</strong>, skipped: {listApplyResult.skipped}, total
            rows: {listApplyResult.total}.
            {listApplyResult.noChange > 0 && (
              <span> {listApplyResult.noChange} row(s) matched a member but had nothing to apply — for a
              &quot;General member update&quot; note, add a header row (e.g. <code>name,notes</code>) so the notes
              column is recognized.</span>
            )}
            {listApplyResult.unmatched > 0 && (
              <span> Resolve the unmatched rows in the <a href="/review-queue">Review Queue</a>.</span>
            )}
          </div>
        )}

        <button type="button" className="btn btn-secondary" disabled={!listText.trim() || listPreviewLoading} onClick={handleListPreview}>
          {listPreviewLoading ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <LoadingSpinner size="sm" />
              Previewing…
            </span>
          ) : (
            'Preview'
          )}
        </button>
        <button
          type="button"
          className="btn"
          style={{ marginLeft: '0.5rem' }}
          disabled={!listText.trim() || listApplyLoading}
          onClick={handleListApply}
        >
          {listApplyLoading ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <LoadingSpinner size="sm" />
              Importing…
            </span>
          ) : (
            'Apply import'
          )}
        </button>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Welcome questionnaire</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Upload the questionnaire CSV export (one column per question). Columns are detected by header —
          name/username/email/Telegram ID identify the member; age, location, goals, business, and &quot;why
          joined&quot; are extracted automatically, and every column is kept regardless. Matched the same way as the
          CRM list import; unmatched rows go to the <a href="/review-queue">Review Queue</a>.
        </p>
        <div className="upload-zone">
          <label className="form-group">
            <span style={{ display: 'block', marginBottom: '0.5rem' }}>Select questionnaire CSV</span>
            <input
              ref={questionnaireInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => { setQuestionnaireFile(e.target.files?.[0] ?? null); setQuestionnairePreview(null); }}
            />
          </label>
          <p>{questionnaireFile ? questionnaireFile.name : 'No file selected'}</p>
        </div>
        {questionnaireError && <div className="alert alert-error">{questionnaireError}</div>}

        {questionnairePreview && (
          <div className="alert" style={{ background: 'rgba(29,155,240,0.12)', border: '1px solid #1d9bf0', color: '#e7e9ea', marginBottom: '1rem' }}>
            {questionnairePreview.counts.total} row(s): <strong>{questionnairePreview.counts.update}</strong> will update
            an existing member, <strong>{questionnairePreview.counts.review}</strong> need review,{' '}
            <strong>{questionnairePreview.counts.skip}</strong> are empty and will be skipped.
          </div>
        )}

        {questionnaireResult && (
          <div className="alert alert-success">
            Import complete. Updated: <strong>{questionnaireResult.updated}</strong>, sent to review:{' '}
            <strong>{questionnaireResult.unmatched}</strong>, skipped: {questionnaireResult.skipped}, total rows:{' '}
            {questionnaireResult.total}.
            {questionnaireResult.unmatched > 0 && (
              <span> Resolve the unmatched rows in the <a href="/review-queue">Review Queue</a>.</span>
            )}
          </div>
        )}

        <button type="button" className="btn btn-secondary" disabled={!questionnaireFile || questionnairePreviewLoading} onClick={handleQuestionnairePreview}>
          {questionnairePreviewLoading ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <LoadingSpinner size="sm" />
              Previewing…
            </span>
          ) : (
            'Preview'
          )}
        </button>
        <button
          type="button"
          className="btn"
          style={{ marginLeft: '0.5rem' }}
          disabled={!questionnaireFile || questionnaireApplyLoading}
          onClick={handleQuestionnaireApply}
        >
          {questionnaireApplyLoading ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <LoadingSpinner size="sm" />
              Importing…
            </span>
          ) : (
            'Apply import'
          )}
        </button>
      </section>
    </div>
  );
}
