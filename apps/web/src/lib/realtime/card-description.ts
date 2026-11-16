import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { DESCRIPTION_TEXT_NAME, WS_MESSAGE } from '@kanban/shared';
import { awarenessPayload, createAwarenessSync, type AwarenessSync } from './awareness-sync';
import { createManagedSocket, type ManagedSocket } from './connection';

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
  /** Awareness (carets) on the same socket; `null` when the current user is not known. */
  readonly presence: AwarenessSync | null;
  /** Called after `synced` or `status` changed. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Closes the socket for good and drops the document. */
  destroy(): void;
}

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
export function connectCardDescription(
  cardId: string,
  self: { id: string; name: string } | null = null,
): DescriptionConnection {
  const doc = new Y.Doc();
  const text = doc.getText(DESCRIPTION_TEXT_NAME);
  // Remote carets (KB-020): awareness on this same socket.
  const presence = self ? createAwarenessSync(new Awareness(doc), self) : null;
  presence?.setLocal({ activeCardId: cardId });
  const listeners = new Set<() => void>();
  let stopped = false;
  /** Destroyed by the view while changes were still unconfirmed: it finishes in the background. */
  let retired = false;
  let fatal = false;
  let open = false;
  let lost = false;
  let synced = false;
  let dirty = false;
  let ackInFlight = false;
  let ackAgain = false;

  const statusNow = (): DescriptionStatus => {
    if (fatal) return 'unavailable';
    if (!open) return synced || lost ? 'reconnecting' : 'connecting';
    if (!synced) return 'connecting';
    return dirty ? 'syncing' : 'saved';
  };
  let status = statusNow();
  /** Closes the socket for good and drops the document. */
  const finish = () => {
    if (stopped) return;
    stopped = true;
    managed.close();
    doc.destroy();
  };
  const refresh = () => {
    if (retired && (!dirty || fatal)) {
      finish();
      return;
    }
    // Unconfirmed changes count as "pending" in the board header while the socket is down.
    managed.source.setUnsynced(dirty && !fatal);
    const next = statusNow();
    if (next === status) return;
    status = next;
    for (const listener of [...listeners]) listener();
  };
  const notifySynced = () => {
    for (const listener of [...listeners]) listener();
  };

  const send = (message: Uint8Array) => {
    const socket = managed.current();
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
    const awarenessUpdate = presence ? awarenessPayload(bytes) : null;
    if (awarenessUpdate) {
      presence?.receive(awarenessUpdate);
      return;
    }
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

  // Reconnecting, the backoff and the `online` retry belong to the shared connection module.
  const managed: ManagedSocket = createManagedSocket({
    url: socketUrl(cardId),
    onOpen: (ws) => {
      open = true;
      lost = false;
      ackInFlight = false;
      ackAgain = false;
      requestAck();
      if (!retired) {
        presence?.attach((message) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(message as Uint8Array<ArrayBuffer>);
        });
      }
      refresh();
    },
    onMessage: (_ws, data) => {
      try {
        handle(data);
      } catch {
        // A malformed message is skipped; the server closes the socket when it is ours that is bad.
      }
    },
    onClose: (_ws, closed) => {
      open = false;
      presence?.detach();
      if (stopped) return;
      if (closed.fatal) fatal = true;
      else lost = true;
      refresh();
    },
  });
  refresh();

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
    presence,
    destroy() {
      presence?.destroy();
      listeners.clear();
      if (dirty && !fatal && !stopped) {
        // Closing the card while changes are still on their way (for example offline) must not
        // lose them: the connection stays in the background until the server confirmed them.
        retired = true;
        return;
      }
      finish();
    },
  };
}
