import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { DESCRIPTION_TEXT_NAME, WS_CLOSE, WS_MESSAGE } from '@kanban/shared';

export type DescriptionStatus =
  /** Not connected yet, or connected but the first sync has not arrived. */
  | 'connecting'
  /** Everything typed here has reached the server. */
  | 'saved'
  /** Local changes are on their way to the server. */
  | 'syncing'
  /** The connection was lost; local changes are kept and sent after reconnecting (KB-021). */
  | 'reconnecting'
  /** The server refused the connection for good (no session, no access). */
  | 'unavailable';

export interface DescriptionConnection {
  readonly doc: Y.Doc;
  readonly text: Y.Text;
  /** True once the server state has been received at least once. */
  readonly synced: boolean;
  readonly status: DescriptionStatus;
  /** Called after `synced` or `status` changed. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Closes the socket for good and drops the document. */
  destroy(): void;
}

const FATAL_CLOSE_CODES: number[] = [
  WS_CLOSE.unauthenticated,
  WS_CLOSE.forbidden,
  WS_CLOSE.invalidRoom,
];
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 10_000;

/** Origin of changes that came from the server, so they are never sent back. */
const REMOTE = Symbol('remote');

const socketUrl = (cardId: string): string => {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/ws/card:${cardId}:description`;
};

/**
 * Connects a Yjs document to the `card:<id>:description` room (y-websocket wire protocol, spoken
 * directly with y-protocols). "Saved" is exact rather than guessed: after sending its changes the
 * client sends sync step 1 as well; the server answers in order, so its step 2 reply means every
 * earlier update has been applied. Reconnects with backoff (the full offline UX is KB-021).
 */
export function connectCardDescription(cardId: string): DescriptionConnection {
  const doc = new Y.Doc();
  const text = doc.getText(DESCRIPTION_TEXT_NAME);
  const listeners = new Set<() => void>();
  let socket: WebSocket | null = null;
  let timer: number | undefined;
  let attempt = 0;
  let stopped = false;
  let fatal = false;
  let open = false;
  let synced = false;
  let dirty = false;
  let ackInFlight = false;
  let ackAgain = false;

  const statusNow = (): DescriptionStatus => {
    if (fatal) return 'unavailable';
    if (!open) return synced || attempt > 0 ? 'reconnecting' : 'connecting';
    if (!synced) return 'connecting';
    return dirty ? 'syncing' : 'saved';
  };
  let status = statusNow();
  const refresh = () => {
    const next = statusNow();
    if (next === status) return;
    status = next;
    for (const listener of [...listeners]) listener();
  };
  const notifySynced = () => {
    for (const listener of [...listeners]) listener();
  };

  const send = (message: Uint8Array) => {
    if (socket && open) socket.send(message as Uint8Array<ArrayBuffer>);
  };

  /** Asks the server to confirm everything sent so far (one question at a time). */
  const requestAck = () => {
    if (!open) return;
    if (ackInFlight) {
      ackAgain = true;
      return;
    }
    ackInFlight = true;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE.sync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(encoding.toUint8Array(encoder));
  };

  const onAck = () => {
    ackInFlight = false;
    if (ackAgain) {
      ackAgain = false;
      requestAck();
    } else {
      dirty = false;
    }
  };

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    dirty = true;
    if (open) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, WS_MESSAGE.sync);
      syncProtocol.writeUpdate(encoder, update);
      send(encoding.toUint8Array(encoder));
      requestAck();
    }
    refresh();
  });

  const handle = (data: ArrayBuffer) => {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    if (decoding.readVarUint(decoder) !== WS_MESSAGE.sync) return;
    const subType = decoding.readVarUint(decoding.createDecoder(bytes.subarray(1)));
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, WS_MESSAGE.sync);
    syncProtocol.readSyncMessage(decoder, reply, doc, REMOTE);
    if (encoding.length(reply) > 1) send(encoding.toUint8Array(reply));
    if (subType === syncProtocol.messageYjsSyncStep1 && dirty) {
      // The reply above carries what the server misses (also changes made while offline).
      requestAck();
    } else if (subType === syncProtocol.messageYjsSyncStep2) {
      const first = !synced;
      synced = true;
      if (ackInFlight) onAck();
      if (first) notifySynced();
    }
    refresh();
  };

  const connect = () => {
    if (stopped) return;
    const ws = new WebSocket(socketUrl(cardId));
    ws.binaryType = 'arraybuffer';
    socket = ws;
    ws.addEventListener('open', () => {
      attempt = 0;
      open = true;
      ackInFlight = false;
      ackAgain = false;
      requestAck();
      refresh();
    });
    ws.addEventListener('message', (message: MessageEvent) => {
      if (typeof message.data === 'string') return;
      try {
        handle(message.data as ArrayBuffer);
      } catch {
        // A malformed message is skipped; the server closes the socket when it is ours that is bad.
      }
    });
    ws.addEventListener('close', (closed: CloseEvent) => {
      if (socket === ws) socket = null;
      open = false;
      if (stopped) return;
      if (FATAL_CLOSE_CODES.includes(closed.code)) {
        fatal = true;
      } else {
        const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt);
        attempt += 1;
        timer = window.setTimeout(connect, delay);
      }
      refresh();
    });
  };
  connect();

  return {
    doc,
    text,
    get synced() {
      return synced;
    },
    get status() {
      return status;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
      listeners.clear();
      doc.destroy();
    },
  };
}
