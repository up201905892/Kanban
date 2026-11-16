import { WS_MESSAGE, boardEventSchema, type BoardEvent } from '@kanban/shared';
import { awarenessPayload, type AwarenessSync } from './awareness-sync';
import { createManagedSocket } from './connection';

/** Reads a lib0 variable-length unsigned integer; returns the value and the next offset. */
function readVarUint(bytes: Uint8Array, offset: number): [number, number] | null {
  let value = 0;
  let shift = 0;
  let index = offset;
  while (index < bytes.length) {
    const byte = bytes[index] as number;
    index += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [value, index];
    shift += 7;
    if (shift > 35) return null;
  }
  return null;
}

/**
 * Decodes one binary message of the board room. Only the custom board-event message (type 4) is of
 * interest; sync and awareness messages and anything malformed give `null`.
 */
export function parseBoardMessage(data: ArrayBuffer | Uint8Array): BoardEvent | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const type = readVarUint(bytes, 0);
  if (!type || type[0] !== WS_MESSAGE.boardEvent) return null;
  const length = readVarUint(bytes, type[1]);
  if (!length) return null;
  const [size, start] = length;
  if (start + size > bytes.length) return null;
  try {
    const message = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + size))) as {
      data?: unknown;
    };
    const parsed = boardEventSchema.safeParse(message.data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface BoardSocketOptions {
  boardId: string;
  onEvent: (event: BoardEvent) => void;
  /** Called on every (re)connection: events may have been missed before it. */
  onConnected: () => void;
  /** Presence on the same socket (KB-020): awareness messages are exchanged through it. */
  presence?: AwarenessSync | undefined;
}

const socketUrl = (boardId: string): string => {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/ws/board:${boardId}`;
};

/**
 * Connects to the `board:<id>` room and reports its events. The socket is kept open by the shared
 * connection module (backoff, retry on `online`, give-up on 4400/4401/4403; KB-021). Returns the
 * function that closes the connection for good.
 */
export function connectBoardSocket({
  boardId,
  onEvent,
  onConnected,
  presence,
}: BoardSocketOptions) {
  const managed = createManagedSocket({
    url: socketUrl(boardId),
    onOpen: (ws) => {
      presence?.attach((message) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(message as Uint8Array<ArrayBuffer>);
      });
      onConnected();
    },
    onMessage: (_ws, data) => {
      const bytes = new Uint8Array(data);
      if (presence) {
        const payload = awarenessPayload(bytes);
        if (payload) {
          presence.receive(payload);
          return;
        }
      }
      const event = parseBoardMessage(bytes);
      if (event && event.boardId === boardId) onEvent(event);
    },
    onClose: () => presence?.detach(),
  });
  return () => managed.close();
}
