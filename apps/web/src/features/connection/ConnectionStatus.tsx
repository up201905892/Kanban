import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useMutationState, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { useAnnounce } from '../../components';
import { connectionStore } from '../../lib/realtime/connection';
import { currentUserKey } from '../auth/api';
import { loginPathFor } from '../auth/safe-next';
import { getSessionNotice, setSessionNotice } from '../auth/session-notice';
import { STATUS_LABEL, pendingText, sessionExpiredMessage } from './messages';

/** Number of mutations waiting (paused) because there is no network or an earlier one is running. */
function usePausedMutations(): number {
  return useMutationState({
    filters: { status: 'pending' },
    select: (mutation) => mutation.state.isPaused,
  }).filter(Boolean).length;
}

/**
 * The connection status of the board header (KB-021): one status derived from every real-time
 * socket ("Connected", "Reconnecting…", "Offline"), announced politely when it changes, plus the
 * number of changes waiting to sync. It also guards the page: closing the tab with unsynced work
 * asks for confirmation, and a session that expired while offline sends the person to the log-in
 * page with an explicit message instead of silently dropping what was pending.
 */
export function ConnectionStatus() {
  const announce = useAnnounce();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const snapshot = useSyncExternalStore(connectionStore.subscribe, connectionStore.getSnapshot);
  const paused = usePausedMutations();
  const { status, sessionExpired } = snapshot;
  const pending = paused + snapshot.pendingSources;
  const unsaved = paused + snapshot.unsyncedSources;

  // Polite announcement on every change (not for the initial "Connecting…", which is not news).
  const previous = useRef(status);
  const everConnected = useRef(false);
  useEffect(() => {
    if (status === 'connected') {
      if (everConnected.current && previous.current !== 'connected')
        announce(STATUS_LABEL.connected);
      everConnected.current = true;
    } else if (status !== 'connecting' && previous.current !== status) {
      announce(STATUS_LABEL[status]);
    }
    previous.current = status;
  }, [status, announce]);

  // Warn before leaving with work that has not reached the server.
  const unsavedNow = useRef(unsaved);
  useEffect(() => {
    unsavedNow.current = unsaved;
  });
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (unsavedNow.current === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  // 4401 on a reconnect: the session is gone. Say how much was lost, then go to the log-in page.
  const handled = useRef(false);
  useEffect(() => {
    if (!sessionExpired || handled.current) return;
    handled.current = true;
    const message = sessionExpiredMessage(unsavedNow.current);
    announce(message, 'assertive');
    const here = `${location.pathname}${location.search}${location.hash}`;
    // A rejected replay may have said it first, with the real count (the cache is cleared since).
    if (unsavedNow.current > 0 || getSessionNotice() === null) setSessionNotice(message);
    queryClient.clear();
    queryClient.setQueryData(currentUserKey, null);
    void navigate(loginPathFor(here), { replace: true });
  }, [sessionExpired, announce, queryClient, navigate, location]);

  return (
    <div className="connection-status" data-status={status}>
      <span data-testid="connection-status">{STATUS_LABEL[status]}</span>
      {pending > 0 && (status === 'offline' || status === 'reconnecting') && (
        <span data-testid="pending-changes">{pendingText(pending)}</span>
      )}
    </div>
  );
}
