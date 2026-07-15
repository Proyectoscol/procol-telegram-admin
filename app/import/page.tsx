'use client';

import { useState, useRef } from 'react';
import { upload } from '@vercel/blob/client';
import { LoadingSpinner } from '@/components/Loading';

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    chatId?: number;
    chatName?: string;
    messagesInserted: number;
    messagesSkipped: number;
    reactionsInserted: number;
    reactionsSkipped: number;
    usersUpserted: number;
    errors?: string[];
    messageErrors?: number;
    reactionErrors?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const [membersFile, setMembersFile] = useState<File | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersResult, setMembersResult] = useState<{
    added: number;
    updated: number;
    total: number;
    groupId?: string | null;
    errors?: string[];
    errorCount?: number;
  } | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const membersInputRef = useRef<HTMLInputElement>(null);

  const [membersPremiumFile, setMembersPremiumFile] = useState<File | null>(null);
  const [membersPremiumLoading, setMembersPremiumLoading] = useState(false);
  const [membersPremiumResult, setMembersPremiumResult] = useState<{
    updated: number;
    total: number;
    durationMs?: number;
    errors?: string[];
    errorCount?: number;
  } | null>(null);
  const [membersPremiumError, setMembersPremiumError] = useState<string | null>(null);
  const membersPremiumInputRef = useRef<HTMLInputElement>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file.');
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      // Upload directly to Vercel Blob to bypass the 4.5MB function payload limit
      const suffix = Math.random().toString(36).slice(2, 8);
      const blob = await upload(`ingest-${suffix}-${file.name}`, file, {
        access: 'public',
        handleUploadUrl: '/api/ingest/upload-url',
        multipart: true,
      });
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blobUrl: blob.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setResult(data);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

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

  const handleMembersSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!membersFile) {
      setMembersError('Please select a file.');
      return;
    }
    setMembersError(null);
    setMembersResult(null);
    setMembersLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', membersFile);
      const res = await fetch('/api/import/members', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setMembersResult(data);
      setMembersFile(null);
      if (membersInputRef.current) membersInputRef.current.value = '';
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setMembersLoading(false);
    }
  };

  const handleMembersPremiumSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!membersPremiumFile) {
      setMembersPremiumError('Please select a file.');
      return;
    }
    setMembersPremiumError(null);
    setMembersPremiumResult(null);
    setMembersPremiumLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', membersPremiumFile);
      const res = await fetch('/api/import/members-premium', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setMembersPremiumResult(data);
      setMembersPremiumFile(null);
      if (membersPremiumInputRef.current) membersPremiumInputRef.current.value = '';
    } catch (err) {
      setMembersPremiumError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setMembersPremiumLoading(false);
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
        <strong>Chat export</strong> (messages and reactions), <strong>User info</strong> (profile data), <strong>User info + profile photos</strong> (ZIP), <strong>Group members</strong> (weekly snapshot), and <strong>Group Members Premium</strong> (weekly snapshot to set is_premium).
      </p>

      <section className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Chat export (messages &amp; reactions)</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Upload <code style={{ background: '#2f3336', padding: '0.2rem 0.4rem', borderRadius: 4 }}>result.json</code> from Telegram. New messages and reactions are stored; existing ones are skipped. Feed the system daily or weekly.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="upload-zone">
            <label className="form-group">
              <span style={{ display: 'block', marginBottom: '0.5rem' }}>Select file</span>
              <input
                ref={inputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <p>{file ? file.name : 'No file selected'}</p>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          {result && (
            <>
              <div className="alert alert-success">
                Import complete.
                {(result.chatName != null || result.chatId != null) && (
                  <span> Imported into: <strong>{result.chatName ?? 'Chat'} (id: {result.chatId})</strong>. </span>
                )}
                Messages inserted: {result.messagesInserted}, skipped: {result.messagesSkipped}.
                Reactions inserted: {result.reactionsInserted}, skipped: {result.reactionsSkipped}.
                Users upserted: {result.usersUpserted}.
              </div>
              {(result.messageErrors !== undefined && result.messageErrors > 0) || (result.reactionErrors !== undefined && result.reactionErrors > 0) ? (
                <div className="alert" style={{ background: 'rgba(255, 165, 0, 0.15)', border: '1px solid #f90', color: '#f90' }}>
                  Some items were skipped due to errors: {result.messageErrors ?? 0} message(s), {result.reactionErrors ?? 0} reaction(s).
                  {result.errors && result.errors.length > 0 && (
                    <details style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
                      <summary>First errors</summary>
                      <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                        {result.errors.slice(0, 10).map((e, i) => (
                          <li key={i} style={{ marginBottom: '0.25rem' }}>{e}</li>
                        ))}
                        {result.errors.length > 10 && <li>… and {result.errors.length - 10} more</li>}
                      </ul>
                    </details>
                  )}
                </div>
              ) : null}
            </>
          )}
          <button type="submit" className="btn" disabled={!file || loading}>
            {loading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <LoadingSpinner size="sm" />
                Uploading…
              </span>
            ) : (
              'Upload and import'
            )}
          </button>
        </form>
      </section>

      <section className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Group members (weekly snapshot)</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Upload the <code style={{ background: '#2f3336', padding: '0.2rem 0.4rem', borderRadius: 4 }}>members.csv</code> from the Telegram scraper weekly. Expected columns: <code>username</code>, <code>user id</code>, <code>name</code>, <code>group id</code>. All users previously in the group are marked as former members; only those in this file are marked as active members (<strong>is_current_member = true</strong>).
        </p>
        <form onSubmit={handleMembersSubmit}>
          <div className="upload-zone">
            <label className="form-group">
              <span style={{ display: 'block', marginBottom: '0.5rem' }}>Select members CSV</span>
              <input
                ref={membersInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setMembersFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <p>{membersFile ? membersFile.name : 'No file selected'}</p>
          </div>
          {membersError && <div className="alert alert-error">{membersError}</div>}
          {membersResult && (
            <>
              <div className="alert alert-success">
                Members import complete. New members added: <strong>{membersResult.added}</strong>, existing updated: <strong>{membersResult.updated}</strong>, total processed: <strong>{membersResult.total}</strong>.
                {membersResult.groupId && <span> Group ID: {membersResult.groupId}.</span>}
              </div>
              {membersResult.errorCount != null && membersResult.errorCount > 0 && (
                <div className="alert" style={{ background: 'rgba(255, 165, 0, 0.15)', border: '1px solid #f90', color: '#f90' }}>
                  {membersResult.errorCount} row(s) had errors.
                  {membersResult.errors && membersResult.errors.length > 0 && (
                    <details style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
                      <summary>First errors</summary>
                      <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                        {membersResult.errors.slice(0, 10).map((e, i) => (
                          <li key={i} style={{ marginBottom: '0.25rem' }}>{e}</li>
                        ))}
                        {membersResult.errors.length > 10 && <li>… and {membersResult.errors.length - 10} more</li>}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </>
          )}
          <button type="submit" className="btn" disabled={!membersFile || membersLoading}>
            {membersLoading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <LoadingSpinner size="sm" />
                Uploading…
              </span>
            ) : (
              'Upload and update members'
            )}
          </button>
        </form>
      </section>

      <section className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Group Members Premium (weekly snapshot)</h2>
        <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Upload the same <code style={{ background: '#2f3336', padding: '0.2rem 0.4rem', borderRadius: 4 }}>members.csv</code> format from the <strong>Premium group</strong>. Users that match by user ID are marked as premium (<strong>is_premium = true</strong>, <strong>premium_since</strong> set if not already). Only existing users are updated; no new users are created.
        </p>
        <form onSubmit={handleMembersPremiumSubmit}>
          <div className="upload-zone">
            <label className="form-group">
              <span style={{ display: 'block', marginBottom: '0.5rem' }}>Select Premium members CSV</span>
              <input
                ref={membersPremiumInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setMembersPremiumFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <p>{membersPremiumFile ? membersPremiumFile.name : 'No file selected'}</p>
          </div>
          {membersPremiumError && <div className="alert alert-error">{membersPremiumError}</div>}
          {membersPremiumResult && (
            <>
              <div className="alert alert-success">
                Premium members import complete. Users marked as premium: <strong>{membersPremiumResult.updated}</strong>, total rows in file: <strong>{membersPremiumResult.total}</strong>.
              </div>
              {membersPremiumResult.errorCount != null && membersPremiumResult.errorCount > 0 && (
                <div className="alert" style={{ background: 'rgba(255, 165, 0, 0.15)', border: '1px solid #f90', color: '#f90' }}>
                  {membersPremiumResult.errorCount} row(s) had parse errors.
                  {membersPremiumResult.errors && membersPremiumResult.errors.length > 0 && (
                    <details style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
                      <summary>First errors</summary>
                      <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                        {membersPremiumResult.errors.slice(0, 10).map((e, i) => (
                          <li key={i} style={{ marginBottom: '0.25rem' }}>{e}</li>
                        ))}
                        {membersPremiumResult.errors.length > 10 && <li>… and {membersPremiumResult.errors.length - 10} more</li>}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </>
          )}
          <button type="submit" className="btn" disabled={!membersPremiumFile || membersPremiumLoading}>
            {membersPremiumLoading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <LoadingSpinner size="sm" />
                Uploading…
              </span>
            ) : (
              'Upload and update premium members'
            )}
          </button>
        </form>
      </section>

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
