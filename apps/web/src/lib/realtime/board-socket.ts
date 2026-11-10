import { WS_CLOSE, WS_MESSAGE, boardEventSchema, type BoardEvent } from '@kanban/shared';

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
}

const FATAL_CLOSE_CODES: number[] = [
  WS_CLOSE.unauthenticated,
  WS_CLOSE.forbidden,
  WS_CLOSE.invalidRoom,
];
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 10_000;

const socketUrl = (boardId: string): string => {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/ws/board:${boardId}`;
};

/**
 * Connects to the `board:<id>` room and reports its events. Reconnects with exponential backoff
 * (the full offline behaviour is KB-021); gives up when the server says the user may not be there.
 * Returns the function that closes the connection for good.
 */
export function connectBoardSocket({ boardId, onEvent, onConnected }: BoardSocketOptions) {
  let socket: WebSocket | null = null;
  let timer: number | undefined;
  let attempt = 0;
  let stopped = false;

  const connect = () => {
    if (stopped) return;
    const ws = new WebSocket(socketUrl(boardId));
    ws.binaryType = 'arraybuffer';
    socket = ws;
    ws.addEventListener('open', () => {
      attempt = 0;
      onConnected();
    });
    ws.addEventListener('message', (message: MessageEvent) => {
      // `binaryType` is "arraybuffer": text frames (never sent by the server) are skipped.
      if (typeof message.data === 'string') return;
      const event = parseBoardMessage(message.data as ArrayBuffer);
      if (event && event.boardId === boardId) onEvent(event);
    });
    ws.addEventListener('close', (closed: CloseEvent) => {
      if (socket === ws) socket = null;
      if (stopped || FATAL_CLOSE_CODES.includes(closed.code)) return;
      const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt);
      attempt += 1;
      timer = window.setTimeout(connect, delay);
    });
  };
  connect();

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    socket?.close();
  };
}
