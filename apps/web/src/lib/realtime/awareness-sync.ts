import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import { WS_MESSAGE, presenceColorOf, type AwarenessState } from '@kanban/shared';

/** What a client says about itself; the server overwrites the identity fields from the session. */
export interface LocalPresence {
  activeCardId: string | null;
  editing: boolean;
  caret: Record<string, unknown> | null;
}

export interface AwarenessSync {
  readonly awareness: awarenessProtocol.Awareness;
  /** Merges `patch` into this client's awareness state and shares it. */
  setLocal(patch: Partial<LocalPresence>): void;
  /** The socket opened: share the state again (also after a reconnect). */
  attach(send: (message: Uint8Array) => void): void;
  /** The socket closed: the other people's states are stale, forget them. */
  detach(): void;
  /** Applies the payload of a type-1 (awareness) message, without the type byte. */
  receive(payload: Uint8Array): void;
  /** Tells the others we are gone and stops the timers. */
  destroy(): void;
}

/**
 * Adds awareness (`y-protocols/awareness`) to an existing room socket: there is no second socket.
 * The owner of the socket calls `attach`/`detach` on open/close and passes type-1 messages to
 * `receive`. Remote states disappear after 30 s without news (library timeout) and at once when
 * the socket closes.
 */
export function createAwarenessSync(
  awareness: awarenessProtocol.Awareness,
  self: { id: string; name: string },
): AwarenessSync {
  let send: ((message: Uint8Array) => void) | null = null;
  let destroyed = false;
  const local: LocalPresence = { activeCardId: null, editing: false, caret: null };

  const stateOf = (): AwarenessState => ({
    userId: self.id,
    name: self.name,
    color: presenceColorOf(self.id),
    ...local,
  });

  awareness.on(
    'update',
    (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin !== 'local' || !send) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, WS_MESSAGE.awareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]),
      );
      send(encoding.toUint8Array(encoder));
    },
  );

  awareness.setLocalState(stateOf());

  return {
    awareness,
    setLocal(patch) {
      if (destroyed) return;
      Object.assign(local, patch);
      awareness.setLocalState(stateOf());
    },
    attach(fn) {
      send = fn;
      // A new clock: the server dropped our state when the previous socket closed.
      if (!destroyed) awareness.setLocalState(stateOf());
    },
    detach() {
      send = null;
      const others = [...awareness.getStates().keys()].filter((id) => id !== awareness.clientID);
      if (others.length > 0) awarenessProtocol.removeAwarenessStates(awareness, others, 'close');
    },
    receive(payload) {
      if (destroyed) return;
      awarenessProtocol.applyAwarenessUpdate(awareness, payload, 'remote');
    },
    destroy() {
      if (destroyed) return;
      // Sends the removal while the socket may still be open.
      awareness.setLocalState(null);
      destroyed = true;
      send = null;
      awareness.destroy();
    },
  };
}

/** Reads the payload of an awareness message (type byte already known to be 1). */
export function awarenessPayload(message: Uint8Array): Uint8Array | null {
  try {
    const decoder = decoding.createDecoder(message);
    if (decoding.readVarUint(decoder) !== WS_MESSAGE.awareness) return null;
    return decoding.readVarUint8Array(decoder);
  } catch {
    return null;
  }
}
