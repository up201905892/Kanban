import { WS_CLOSE } from '@kanban/shared';

/**
 * The one connection-state module (KB-021). Every real-time socket of the page (the board room and
 * the open card's description room) is opened through `createManagedSocket`, which owns the
 * reconnect schedule, and reports into a `ConnectionStore`. The board header derives one status
 * from all of them, so a lost connection is shown and announced once.
 */

export const RETRY_MIN_MS = 1000;
export const RETRY_MAX_MS = 30_000;
/** Each delay is spread by up to this fraction either way, so clients do not reconnect in lockstep. */
export const RETRY_JITTER = 0.25;

/**
 * Delay before reconnect attempt number `attempt` (0 = the first retry): 1 s, 2 s, 4 s ... up to
 * 30 s, each spread by plus or minus 25 % and never above 30 s. `random` is in [0, 1).
 */
export function backoffDelay(attempt: number, random: number = Math.random()): number {
  const base = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.max(0, attempt));
  const factor = 1 - RETRY_JITTER + random * 2 * RETRY_JITTER;
  return Math.round(Math.min(RETRY_MAX_MS, base * factor));
}

/** Close codes after which retrying is pointless (no session, no access, bad room). */
export const FATAL_CLOSE_CODES: readonly number[] = [
  WS_CLOSE.unauthenticated,
  WS_CLOSE.forbidden,
  WS_CLOSE.invalidRoom,
];

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';
/** `closed` means refused for good: the source no longer counts towards the status. */
type SourceState = 'connecting' | 'open' | 'down' | 'closed';

export interface ConnectionSnapshot {
  status: ConnectionStatus;
  /** Sources holding changes the server has not confirmed (true even while connected). */
  unsyncedSources: number;
  /** Unconfirmed sources that are cut off right now: they are "pending changes" for the header. */
  pendingSources: number;
  /** A socket was refused with 4401: the session is gone. */
  sessionExpired: boolean;
}

export interface ConnectionSource {
  setState(state: SourceState): void;
  setUnsynced(unsynced: boolean): void;
  remove(): void;
}

interface SourceRecord {
  state: SourceState;
  unsynced: boolean;
}

/** What a source wants to hear from the browser's `online` / `offline` events. */
export interface NetworkHandlers {
  online: () => void;
  offline: () => void;
}

export interface ConnectionStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConnectionSnapshot;
  register(handlers: NetworkHandlers): ConnectionSource;
  expireSession(): void;
}

/** Creates a store; the page uses the shared `connectionStore`, tests may build their own. */
export function createConnectionStore(): ConnectionStore {
  const sources = new Map<symbol, SourceRecord>();
  const retriers = new Map<symbol, NetworkHandlers>();
  const listeners = new Set<() => void>();
  let online = typeof navigator === 'undefined' ? true : navigator.onLine;
  let sessionExpired = false;
  let installed = false;

  const compute = (): ConnectionSnapshot => {
    const live = [...sources.values()].filter((s) => s.state !== 'closed');
    let status: ConnectionStatus;
    if (!online) status = 'offline';
    else if (live.some((s) => s.state === 'down')) status = 'reconnecting';
    else if (live.length === 0 || live.some((s) => s.state === 'connecting')) status = 'connecting';
    else status = 'connected';
    const unsynced = live.filter((s) => s.unsynced);
    return {
      status,
      unsyncedSources: unsynced.length,
      pendingSources: unsynced.filter((s) => !online || s.state !== 'open').length,
      sessionExpired,
    };
  };
  let snapshot = compute();
  const update = () => {
    const next = compute();
    if (
      next.status === snapshot.status &&
      next.unsyncedSources === snapshot.unsyncedSources &&
      next.pendingSources === snapshot.pendingSources &&
      next.sessionExpired === snapshot.sessionExpired
    ) {
      return;
    }
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const goOnline = () => {
    online = true;
    // The browser says the network is back: do not wait for the backoff timers.
    for (const handlers of [...retriers.values()]) handlers.online();
    update();
  };
  const goOffline = () => {
    online = false;
    for (const handlers of [...retriers.values()]) handlers.offline();
    update();
  };
  const install = () => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    online = navigator.onLine;
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
  };
  const uninstall = () => {
    if (!installed || sources.size > 0) return;
    installed = false;
    window.removeEventListener('online', goOnline);
    window.removeEventListener('offline', goOffline);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    register(handlers) {
      install();
      // A new page session (nothing connected before) starts without the old expiry.
      if (sources.size === 0) sessionExpired = false;
      const id = Symbol('source');
      sources.set(id, { state: 'connecting', unsynced: false });
      retriers.set(id, handlers);
      update();
      return {
        setState(state) {
          const record = sources.get(id);
          if (record && record.state !== state) {
            record.state = state;
            update();
          }
        },
        setUnsynced(unsynced) {
          const record = sources.get(id);
          if (record && record.unsynced !== unsynced) {
            record.unsynced = unsynced;
            update();
          }
        },
        remove() {
          sources.delete(id);
          retriers.delete(id);
          uninstall();
          update();
        },
      };
    },
    expireSession() {
      if (sessionExpired) return;
      sessionExpired = true;
      update();
    },
  };
}

export const connectionStore: ConnectionStore = createConnectionStore();

export interface ManagedSocketOptions {
  url: string;
  /** Called with every socket as soon as it is created, before it opens. */
  onOpen: (socket: WebSocket) => void;
  onMessage: (socket: WebSocket, data: ArrayBuffer) => void;
  /** `fatal` is true when the server refused the connection for good (no further retries). */
  onClose: (socket: WebSocket, closed: { code: number; fatal: boolean }) => void;
  store?: ConnectionStore;
  random?: () => number;
}

export interface ManagedSocket {
  readonly source: ConnectionSource;
  /** The socket while it is open, otherwise null. */
  current(): WebSocket | null;
  /** Closes for good: no more retries. */
  close(): void;
}

/**
 * Opens a WebSocket and keeps it open: reconnects with `backoffDelay` after any non-fatal close
 * (1012 "restarting" included) and immediately when the browser fires `online`. Gives up after
 * 4400/4401/4403; a 4401 also marks the session as expired in the store.
 */
export function createManagedSocket(options: ManagedSocketOptions): ManagedSocket {
  const store = options.store ?? connectionStore;
  const random = options.random ?? Math.random;
  let socket: WebSocket | null = null;
  let timer: number | undefined;
  let attempt = 0;
  let stopped = false;

  const connect = () => {
    window.clearTimeout(timer);
    timer = undefined;
    if (stopped) return;
    const ws = new WebSocket(options.url);
    ws.binaryType = 'arraybuffer';
    socket = ws;
    ws.addEventListener('open', () => {
      if (socket !== ws) return;
      attempt = 0;
      source.setState('open');
      options.onOpen(ws);
    });
    ws.addEventListener('message', (message: MessageEvent) => {
      // A socket that was replaced (see `online` below) is ignored.
      if (socket !== ws) return;
      // `binaryType` is "arraybuffer": text frames (never sent by the server) are skipped.
      if (typeof message.data === 'string') return;
      options.onMessage(ws, message.data as ArrayBuffer);
    });
    ws.addEventListener('close', (closed: CloseEvent) => {
      if (stopped) {
        options.onClose(ws, { code: closed.code, fatal: false });
        return;
      }
      if (socket !== ws) return;
      socket = null;
      const fatal = FATAL_CLOSE_CODES.includes(closed.code);
      if (fatal) {
        source.setState('closed');
        if (closed.code === WS_CLOSE.unauthenticated) store.expireSession();
      } else {
        source.setState('down');
        timer = window.setTimeout(connect, backoffDelay(attempt, random()));
        attempt += 1;
      }
      options.onClose(ws, { code: closed.code, fatal });
    });
  };

  // While the browser is offline an "open" socket may be dead without ever saying so (laptop
  // sleep, emulated offline). After `online` such a socket is replaced instead of trusted.
  let wentOffline = false;
  const source = store.register({
    offline: () => {
      wentOffline = true;
    },
    online: () => {
      if (stopped) return;
      const stale = socket;
      if (timer !== undefined) {
        // A retry is waiting: do it now.
        connect();
      } else if (stale && wentOffline) {
        socket = null;
        stale.close();
        source.setState('down');
        options.onClose(stale, { code: 1006, fatal: false });
        connect();
      }
      wentOffline = false;
    },
  });
  connect();

  return {
    source,
    current: () => (socket && socket.readyState === WebSocket.OPEN ? socket : null),
    close() {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
      source.remove();
    },
  };
}
