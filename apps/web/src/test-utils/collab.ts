import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WS_MESSAGE } from '@kanban/shared';
import { FakeWebSocket } from './websocket';

/** Origin of the updates that come from a (fake) client. */
const CLIENT = Symbol('client');

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Plays the server side of a card description room on top of a `FakeWebSocket`: it answers the
 * y-websocket sync protocol with a real `Y.Doc`, so the client code runs against genuine CRDT
 * behaviour. `readOnly` discards writes like the server does for viewers.
 */
export class FakeRoom {
  readonly doc = new Y.Doc();
  readOnly = false;

  constructor(
    readonly socket: FakeWebSocket,
    initialText = '',
  ) {
    if (initialText) this.doc.getText('description').insert(0, initialText);
    socket.onSend = (data) => this.handle(data);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === CLIENT) return;
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, WS_MESSAGE.sync);
      syncProtocol.writeUpdate(e, update);
      socket.receiveRaw(toBuffer(encoding.toUint8Array(e)));
    });
  }

  /** The server's opening handshake: sync step 1. */
  greet(): void {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, WS_MESSAGE.sync);
    syncProtocol.writeSyncStep1(e, this.doc);
    this.socket.receiveRaw(toBuffer(encoding.toUint8Array(e)));
  }

  get text(): string {
    return this.doc.getText('description').toString();
  }

  private handle(data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    if (decoding.readVarUint(decoder) !== WS_MESSAGE.sync) return;
    const sub = decoding.readVarUint(decoding.createDecoder(data.subarray(1)));
    if (sub !== syncProtocol.messageYjsSyncStep1 && this.readOnly) return;
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, WS_MESSAGE.sync);
    syncProtocol.readSyncMessage(decoder, reply, this.doc, CLIENT);
    if (encoding.length(reply) > 1) this.socket.receiveRaw(toBuffer(encoding.toUint8Array(reply)));
  }
}

/** The fake socket of the card description room, once the dialog has opened it. */
export function descriptionSocket(): FakeWebSocket | undefined {
  return FakeWebSocket.instances.find((s) => s.url.includes('/ws/card:'));
}

/** Connects a `FakeRoom` to the description socket and opens it, like a server that accepted it. */
export function serveDescription(initialText = ''): FakeRoom {
  const socket = descriptionSocket();
  if (!socket) throw new Error('The card description socket was not created');
  const room = new FakeRoom(socket, initialText);
  socket.open();
  room.greet();
  return room;
}
