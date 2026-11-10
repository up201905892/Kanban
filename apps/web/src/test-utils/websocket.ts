import type { BoardEvent } from '@kanban/shared';

const varUint = (n: number): number[] => {
  const out: number[] = [];
  let value = n;
  while (value > 0x7f) {
    out.push(0x80 | (value & 0x7f));
    value = Math.floor(value / 128);
  }
  out.push(value);
  return out;
};

/** The server's wire format for a board event: type 4, then a varString with `{ type, data }`. */
export function encodeBoardEvent(event: BoardEvent): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify({ type: event.type, data: event }));
  const bytes = new Uint8Array([...varUint(4), ...varUint(text.length), ...text]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

type Listener = (event: never) => void;

/** A WebSocket that never touches the network; tests drive it with `open()`, `receive()` and `close()`. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances = [];
  }
  /** The most recent socket. */
  static get last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error('No WebSocket was created');
    return socket;
  }

  binaryType = 'blob';
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  private emit(type: string, event: object): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }

  open(): void {
    this.emit('open', {});
  }

  receive(event: BoardEvent): void {
    this.emit('message', { data: encodeBoardEvent(event) });
  }

  receiveRaw(data: ArrayBuffer): void {
    this.emit('message', { data });
  }

  close(code = 1000): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', { code });
  }
}
