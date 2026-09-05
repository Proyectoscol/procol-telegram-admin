'use client';

import { useState, useRef, useSyncExternalStore } from 'react';
import { LoadingSpinner } from '@/components/Loading';
import { ExportCsvModal, type ExportColumn } from '@/components/ExportCsvModal';
import { startProfileSync, subscribeProfileSync, getProfileSyncState } from '@/lib/telegram-scraper/profileSyncClient';

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
  const [questionnaireMode, setQuestionnaireMode] = useState<'file' | 'text'>('file');
  const [questionnaireFile, setQuestionnaireFile] = useState<File | null>(null);
  const [questionnaireText, setQuestionnaireText] = useState('');
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
    if (questionnaireMode === 'file' && !questionnaireFile) {
      setQuestionnaireError('Please select a CSV file.');
      return;
    }
    if (questionnaireMode === 'text' && !questionnaireText.trim()) {
      setQuestionnaireError('Paste a welcome message first.');
      return;
    }
    setQuestionnaireError(null);
    setQuestionnairePreview(null);
    setQuestionnaireResult(null);
    setQuestionnairePreviewLoading(true);
    try {
      let res: Response;
      if (questionnaireMode === 'file') {
        const formData = new FormData();
        formData.append('file', questionnaireFile as File);
        res = await fetch('/api/import/questionnaire/preview', { method: 'POST', body: formData });
      } else {
        res = await fetch('/api/import/questionnaire/text/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: questionnaireText }),
        });
      }
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
    if (questionnaireMode === 'file' && !questionnaireFile) return;
    if (questionnaireMode === 'text' && !questionnaireText.trim()) return;
    setQuestionnaireError(null);
    setQuestionnaireApplyLoading(true);
    try {
      let res: Response;
      if (questionnaireMode === 'file') {
        const formData = new FormData();
        formData.append('file', questionnaireFile as File);
        res = await fetch('/api/import/questionnaire', { method: 'POST', body: formData });
      } else {
        res = await fetch('/api/import/questionnaire/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: questionnaireText }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setQuestionnaireResult(data);
      setQuestionnairePreview(null);
      setQuestionnaireFile(null);
      setQuestionnaireText('');
      if (questionnaireInputRef.current) questionnaireInputRef.current.value = '';
    } catch (err) {
      setQuestionnaireError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setQuestionnaireApplyLoading(false);
    }
  };

  const [teachableFile, setTeachableFile] = useState<File | null>(null);
  const [teachablePreviewLoading, setTeachablePreviewLoading] = useState(false);
  const [teachableApplyLoading, setTeachableApplyLoading] = useState(false);
  const [teachablePreview, setTeachablePreview] = useState<{
    counts: { total: number; update: number; review: number; skip: number };
  } | null>(null);
  const [teachableResult, setTeachableResult] = useState<{
    totalPeople: number;
    totalCourseRows: number;
    updated: number;
    unmatched: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const [teachableError, setTeachableError] = useState<string | null>(null);
  const teachableInputRef = useRef<HTMLInputElement>(null);

  const handleTeachablePreview = async () => {
    if (!teachableFile) {
      setTeachableError('Please select a CSV file.');
      return;
    }
    setTeachableError(null);
    setTeachablePreview(null);
    setTeachableResult(null);
    setTeachablePreviewLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', teachableFile);
      const res = await fetch('/api/import/teachable/preview', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setTeachablePreview(data);
    } catch (err) {
      setTeachableError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setTeachablePreviewLoading(false);
    }
  };

  const handleTeachableApply = async () => {
    if (!teachableFile) return;
    setTeachableError(null);
    setTeachableApplyLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', teachableFile);
      const res = await fetch('/api/import/teachable', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setTeachableResult(data);
      setTeachablePreview(null);
      setTeachableFile(null);
      if (teachableInputRef.current) teachableInputRef.current.value = '';
    } catch (err) {
      setTeachableError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setTeachableApplyLoading(false);
    }
  };

  const [intakeMode, setIntakeMode] = useState<'file' | 'text'>('file');
  const [intakeFiles, setIntakeFiles] = useState<File[]>([]);
  const [intakeText, setIntakeText] = useState('');
  const [intakePreviewLoading, setIntakePreviewLoading] = useState(false);
  const [intakeApplyLoading, setIntakeApplyLoading] = useState(false);
  const [intakePreview, setIntakePreview] = useState<{
    counts: { total: number; update: number; review: number; skip: number };
    rows: { fileName: string; status: string; matchedUserName?: string; reason?: string; parseWarnings: string[]; parseError?: string }[];
  } | null>(null);
  const [intakeResult, setIntakeResult] = useState<{
    totalFiles: number;
    updated: number;
    unmatched: number;
    skipped: number;
    errors: string[];
    nameMismatches: string[];
    parseWarnings: string[];
  } | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const intakeInputRef = useRef<HTMLInputElement>(null);

  const handleIntakePreview = async () => {
    if (intakeMode === 'file' && intakeFiles.length === 0) {
      setIntakeError('Please select one or more PDF exports.');
      return;
    }
    if (intakeMode === 'text' && !intakeText.trim()) {
      setIntakeError('Paste the respondent’s answers first.');
      return;
    }
    setIntakeError(null);
    setIntakePreview(null);
    setIntakeResult(null);
    setIntakePreviewLoading(true);
    try {
      let res: Response;
      if (intakeMode === 'file') {
        const formData = new FormData();
        intakeFiles.forEach((f) => formData.append('files', f));
        res = await fetch('/api/import/custom-plan-intake/preview', { method: 'POST', body: formData });
      } else {
        res = await fetch('/api/import/custom-plan-intake/text/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: intakeText }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setIntakePreview(data);
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setIntakePreviewLoading(false);
    }
  };

  const handleIntakeApply = async () => {
    if (intakeMode === 'file' && intakeFiles.length === 0) return;
    if (intakeMode === 'text' && !intakeText.trim()) return;
    setIntakeError(null);
    setIntakeApplyLoading(true);
    try {
      let res: Response;
      if (intakeMode === 'file') {
        const formData = new FormData();
        intakeFiles.forEach((f) => formData.append('files', f));
        res = await fetch('/api/import/custom-plan-intake', { method: 'POST', body: formData });
      } else {
        res = await fetch('/api/import/custom-plan-intake/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: intakeText }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setIntakeResult(data);
      setIntakePreview(null);
      setIntakeFiles([]);
      setIntakeText('');
      if (intakeInputRef.current) intakeInputRef.current.value = '';
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIntakeApplyLoading(false);
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

  const profileSyncState = useSyncExternalStore(subscribeProfileSync, getProfileSyncState, getProfileSyncState);
  const { syncing: profileSyncing, result: profileSyncResult, error: profileSyncError } = profileSyncState;
  const handleProfileSync = () => { startProfileSync(); };

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

  return (
    <div>
      <h1>Import data</h1>
      <p style={{ color: '#8b98a5', marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
        <strong>Update members</strong>, <strong>Sync chats</strong>, and <strong>Sync profiles</strong> (automated Telegram sync).
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
          Upload the questionnaire CSV export (one column per question), or paste a member&apos;s welcome
          message/intro as plain text if that&apos;s the format you have it in — AI reads the message and fills in
          whatever it can (age, location, goals, business, why they joined). Either way, be sure the text includes
          the member&apos;s <strong>Telegram @handle or email</strong> somewhere so it can be matched to their
          contact. Matched the same way as the CRM list import; unmatched entries go to the{' '}
          <a href="/review-queue">Review Queue</a>.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            type="button"
            className={questionnaireMode === 'file' ? 'btn' : 'btn btn-secondary'}
            onClick={() => { setQuestionnaireMode('file'); setQuestionnairePreview(null); setQuestionnaireError(null); }}
          >
            Upload CSV
          </button>
          <button
            type="button"
            className={questionnaireMode === 'text' ? 'btn' : 'btn btn-secondary'}
            onClick={() => { setQuestionnaireMode('text'); setQuestionnairePreview(null); setQuestionnaireError(null); }}
          >
            Paste text (AI)
          </button>
        </div>

        {questionnaireMode === 'file' ? (
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
        ) : (
          <div className="form-group">
            <label>Welcome message text</label>
            <textarea
              value={questionnaireText}
              onChange={(e) => { setQuestionnaireText(e.target.value); setQuestionnairePreview(null); }}
              placeholder={'Hey guys Im Chiel! Im from the Netherlands and I am a video editor for Tiktok and Instagram...\n\n@chielmeester'}
              style={{ minHeight: 160, fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}
            />
            <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginTop: '0.35rem' }}>
              To import several people at once, separate each message with a line containing only <code>---</code>.
            </p>
          </div>
        )}
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

        <button
          type="button"
          className="btn btn-secondary"
          disabled={(questionnaireMode === 'file' ? !questionnaireFile : !questionnaireText.trim()) || questionnairePreviewLoading}
          onClick={handleQuestionnairePreview}
        >
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
          disabled={(questionnaireMode === 'file' ? !questionnaireFile : !questionnaireText.trim()) || questionnaireApplyLoading}
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

      <section className="card">
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Teachable course progress</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Upload the Teachable progress export (email, name, joined, course, percent_complete, delta,
          completed_at — one row per course, so a member enrolled in several courses has several rows). Rows are
          grouped by person before matching, matched by email first and then by an unambiguous exact name, and only
          applied when the match is certain. Anyone that can&apos;t be matched with confidence goes to the{' '}
          <a href="/review-queue">Review Queue</a> instead of being guessed — nothing is auto-assigned. There, AI-ranked
          candidate suggestions (for name mismatches the exact-match rules can&apos;t catch) show up alongside the
          usual search — still requires your click to confirm. Re-upload the same file any time to keep percent
          complete and completion dates current.
        </p>
        <div className="upload-zone">
          <label className="form-group">
            <span style={{ display: 'block', marginBottom: '0.5rem' }}>Select Teachable CSV</span>
            <input
              ref={teachableInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => { setTeachableFile(e.target.files?.[0] ?? null); setTeachablePreview(null); }}
            />
          </label>
          <p>{teachableFile ? teachableFile.name : 'No file selected'}</p>
        </div>
        {teachableError && <div className="alert alert-error">{teachableError}</div>}

        {teachablePreview && (
          <div className="alert" style={{ background: 'rgba(29,155,240,0.12)', border: '1px solid #1d9bf0', color: '#e7e9ea', marginBottom: '1rem' }}>
            {teachablePreview.counts.total} member(s) in this file: <strong>{teachablePreview.counts.update}</strong> will
            update an existing member, <strong>{teachablePreview.counts.review}</strong> need review,{' '}
            <strong>{teachablePreview.counts.skip}</strong> are empty and will be skipped.
          </div>
        )}

        {teachableResult && (
          <div className="alert alert-success">
            Import complete. Updated: <strong>{teachableResult.updated}</strong> member(s) across{' '}
            {teachableResult.totalCourseRows} course row(s), sent to review: <strong>{teachableResult.unmatched}</strong>,
            skipped: {teachableResult.skipped}, total people: {teachableResult.totalPeople}.
            {teachableResult.unmatched > 0 && (
              <span> Resolve the unmatched rows in the <a href="/review-queue">Review Queue</a>.</span>
            )}
          </div>
        )}

        <button type="button" className="btn btn-secondary" disabled={!teachableFile || teachablePreviewLoading} onClick={handleTeachablePreview}>
          {teachablePreviewLoading ? (
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
          disabled={!teachableFile || teachableApplyLoading}
          onClick={handleTeachableApply}
        >
          {teachableApplyLoading ? (
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
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Custom Plan Intake Form</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Upload the &quot;NM Custom Plan Intake Form&quot; PDF response(s) exactly as downloaded from Google Forms —
          no manual conversion needed, the app reads the PDF directly. One file is one respondent; select as many as
          you have to import them in a single batch. Or, if you have the answers as plain text instead of a PDF
          (e.g. someone DM&apos;d their answers), paste the text and AI extracts whichever fields the message
          answers. Either way, be sure the text includes the respondent&apos;s{' '}
          <strong>Telegram @handle or email</strong> so it can be matched to their contact. Matched by Telegram
          username first (typo-tolerant — a small edit distance still counts as a match), falling back to email if
          the username doesn&apos;t match confidently. Never auto-creates a member or overwrites an existing name —
          unmatched or ambiguous rows go to the <a href="/review-queue">Review Queue</a>.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            type="button"
            className={intakeMode === 'file' ? 'btn' : 'btn btn-secondary'}
            onClick={() => { setIntakeMode('file'); setIntakePreview(null); setIntakeError(null); }}
          >
            Upload PDF(s)
          </button>
          <button
            type="button"
            className={intakeMode === 'text' ? 'btn' : 'btn btn-secondary'}
            onClick={() => { setIntakeMode('text'); setIntakePreview(null); setIntakeError(null); }}
          >
            Paste text (AI)
          </button>
        </div>

        {intakeMode === 'file' ? (
          <div className="upload-zone">
            <label className="form-group">
              <span style={{ display: 'block', marginBottom: '0.5rem' }}>Select PDF export(s)</span>
              <input
                ref={intakeInputRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                onChange={(e) => { setIntakeFiles(Array.from(e.target.files ?? [])); setIntakePreview(null); }}
              />
            </label>
            <p>{intakeFiles.length > 0 ? `${intakeFiles.length} file(s) selected` : 'No files selected'}</p>
          </div>
        ) : (
          <div className="form-group">
            <label>Respondent&apos;s answers (text)</label>
            <textarea
              value={intakeText}
              onChange={(e) => { setIntakeText(e.target.value); setIntakePreview(null); }}
              placeholder={'Hey bro welcome! Please take a few minutes to answer the questions below...\n\n1. Email?\n2. Age and birthday?\n...\n\n@theirhandle'}
              style={{ minHeight: 200, fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}
            />
            <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginTop: '0.35rem' }}>
              To import several respondents at once, separate each one&apos;s answers with a line containing only{' '}
              <code>---</code>.
            </p>
          </div>
        )}
        {intakeError && <div className="alert alert-error">{intakeError}</div>}

        {intakePreview && (
          <div style={{ marginBottom: '1rem' }}>
            <div className="alert" style={{ background: 'rgba(29,155,240,0.12)', border: '1px solid #1d9bf0', color: '#e7e9ea' }}>
              {intakePreview.counts.total} file(s): <strong>{intakePreview.counts.update}</strong> will update an
              existing member, <strong>{intakePreview.counts.review}</strong> need review,{' '}
              <strong>{intakePreview.counts.skip}</strong> could not be parsed or matched to any identifier and will
              be skipped.
            </div>
            <ul style={{ margin: '0.5rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.8125rem' }}>
              {intakePreview.rows.map((r) => (
                <li key={r.fileName} style={{ marginBottom: '0.25rem', color: '#8b98a5' }}>
                  <strong style={{ color: '#e7e9ea' }}>{r.fileName}</strong>: {r.status}
                  {r.matchedUserName ? ` — ${r.matchedUserName}` : ''}
                  {r.reason ? ` (${r.reason})` : ''}
                  {r.parseError ? ` — parse error: ${r.parseError}` : ''}
                  {r.parseWarnings.length > 0 && ` — ${r.parseWarnings.length} warning(s)`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {intakeResult && (
          <div className="alert alert-success">
            Import complete. Updated: <strong>{intakeResult.updated}</strong>, sent to review:{' '}
            <strong>{intakeResult.unmatched}</strong>, skipped: {intakeResult.skipped}, total files:{' '}
            {intakeResult.totalFiles}.
            {intakeResult.unmatched > 0 && (
              <span> Resolve the unmatched rows in the <a href="/review-queue">Review Queue</a>.</span>
            )}
            {intakeResult.nameMismatches.length > 0 && (
              <details style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
                <summary>{intakeResult.nameMismatches.length} name mismatch(es) (existing name kept, not overwritten)</summary>
                <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                  {intakeResult.nameMismatches.map((m, i) => (
                    <li key={i} style={{ marginBottom: '0.25rem' }}>{m}</li>
                  ))}
                </ul>
              </details>
            )}
            {intakeResult.parseWarnings.length > 0 && (
              <details style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
                <summary>{intakeResult.parseWarnings.length} parser warning(s)</summary>
                <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                  {intakeResult.parseWarnings.map((w, i) => (
                    <li key={i} style={{ marginBottom: '0.25rem' }}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            {intakeResult.errors.length > 0 && (
              <details style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
                <summary>{intakeResult.errors.length} error(s)</summary>
                <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                  {intakeResult.errors.map((e, i) => (
                    <li key={i} style={{ marginBottom: '0.25rem' }}>{e}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <button
          type="button"
          className="btn btn-secondary"
          disabled={(intakeMode === 'file' ? intakeFiles.length === 0 : !intakeText.trim()) || intakePreviewLoading}
          onClick={handleIntakePreview}
        >
          {intakePreviewLoading ? (
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
          disabled={(intakeMode === 'file' ? intakeFiles.length === 0 : !intakeText.trim()) || intakeApplyLoading}
          onClick={handleIntakeApply}
        >
          {intakeApplyLoading ? (
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
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Sync profiles (Telegram)</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Pulls each current Main/Premium member&apos;s bio, verified/premium/fake/bot status, online status, and every
          profile photo they&apos;ve ever set, directly from Telegram — replacing the manual &quot;User info + profile
          photos (ZIP)&quot; upload below. Profile lookups are rate-limited by Telegram more aggressively than messages, so
          this processes a batch at a time (oldest/never-synced first) and keeps going on its own until nothing&apos;s left
          to sync — feel free to navigate to another page, it keeps running in the background.
        </p>
        <button type="button" className="btn" onClick={handleProfileSync} disabled={profileSyncing}>
          {profileSyncing ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <LoadingSpinner size="sm" />
              Syncing…
            </span>
          ) : (
            'Sync profiles'
          )}
        </button>
        {profileSyncError && <div className="alert alert-error" style={{ marginTop: '1rem' }}>{profileSyncError}</div>}
        {profileSyncResult && (
          <div className="alert alert-success" style={{ marginTop: '1rem' }}>
            {profileSyncResult.usersProcessed === 0 && !profileSyncResult.hasMore ? (
              <div>Nothing to sync right now — every tracked member was synced in the last 24 hours.</div>
            ) : (
              <div>
                Synced {profileSyncResult.usersProcessed} profile{profileSyncResult.usersProcessed === 1 ? '' : 's'}, downloaded {profileSyncResult.photosDownloaded} new photo{profileSyncResult.photosDownloaded === 1 ? '' : 's'}.
                {profileSyncResult.usersFailed > 0 && <span> {profileSyncResult.usersFailed} failed.</span>}
                {profileSyncResult.floodWaitSeconds != null && (
                  <span style={{ color: '#f90' }}> Telegram asked us to slow down — wait about {Math.ceil(profileSyncResult.floodWaitSeconds / 60)} min before clicking again.</span>
                )}
              </div>
            )}
            {profileSyncResult.errors.length > 0 && (
              <details style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
                <summary>First errors</summary>
                <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                  {profileSyncResult.errors.slice(0, 10).map((e, i) => (
                    <li key={i} style={{ marginBottom: '0.25rem' }}>{e}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
