/**
 * Client-side driver for the "Sync profiles" button — lives outside any React
 * component (a module-level singleton) so the auto-continue loop keeps
 * running across navigation: switching to another page in the app just
 * unmounts the Import page's component tree, it doesn't touch this module or
 * cancel the in-flight fetch chain. The Import page subscribes to it via
 * useSyncExternalStore so whichever page is mounted when it updates reflects
 * the latest progress.
 */

export interface ProfileSyncResult {
  usersProcessed: number;
  usersFailed: number;
  photosDownloaded: number;
  hasMore: boolean;
  floodWaitSeconds?: number;
  durationMs: number;
  errors: string[];
}

export interface ProfileSyncState {
  syncing: boolean;
  result: ProfileSyncResult | null;
  error: string | null;
}

type Listener = () => void;

let state: ProfileSyncState = { syncing: false, result: null, error: null };
const listeners = new Set<Listener>();
let running = false;

function setState(patch: Partial<ProfileSyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeProfileSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getProfileSyncState(): ProfileSyncState {
  return state;
}

/**
 * Kicks off "Sync profiles" and keeps calling it again on its own while the
 * API reports more to sync, instead of requiring a manual click per batch.
 * Stops when there's nothing left, on error, or when Telegram asks us to
 * slow down (floodWaitSeconds) — that case still needs a manual re-click
 * after the wait, so we don't hammer Telegram's rate limit unattended.
 */
export async function startProfileSync(): Promise<void> {
  if (running) return;
  running = true;
  setState({ syncing: true, error: null });
  try {
    for (;;) {
      const res = await fetch('/api/telegram-scraper/sync-profiles', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setState({ result: data });
      if (!data.hasMore || data.floodWaitSeconds != null) break;
    }
  } catch (err) {
    setState({ error: err instanceof Error ? err.message : 'Sync failed' });
  } finally {
    running = false;
    setState({ syncing: false });
  }
}
