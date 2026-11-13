import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  WS_CLOSE,
  WS_MESSAGE,
  can,
  roomName,
  type BoardEventMessage,
  type Role,
  type RoomRef,
} from '@kanban/shared';
import { sanitizeAwarenessUpdate } from './presence.js';

/** The socket surface the rooms need (satisfied by `ws`'s WebSocket and by test doubles). */
export interface RoomSocket {
  readonly readyState: number;
  send(data: Uint8Array, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
}

const WS_OPEN = 1;

/**
 * Persistence hook (implemented by KB-017). `load` fills a freshly created document before the
 * first client is served; `store` runs when the last client leaves, before the document is dropped.
 */
export interface RoomPersistence {
  load(room: RoomRef, doc: Y.Doc): Promise<void>;
  store(room: RoomRef, doc: Y.Doc): Promise<void>;
  /** Writes every batch still waiting in memory (graceful shutdown). */
  flush?(): Promise<void>;
}

export const noPersistence: RoomPersistence = {
  load: async () => {},
  store: async () => {},
};

export interface Connection {
  readonly socket: RoomSocket;
  readonly userId: string;
  readonly workspaceId: string;
  /** Display name from the session, written into this connection's awareness states. */
  readonly name: string;
  /** Mutable: re-authorized when the user's role changes. */
  role: Role;
  /** Awareness client IDs this connection controls, removed when it leaves. */
  readonly awarenessIds: Set<number>;
  room: Room | null;
}

export interface Room {
  readonly ref: RoomRef;
  readonly name: string;
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly conns: Set<Connection>;
  /** Resolves once persistence has loaded the document. */
  ready: Promise<void>;
  closing: boolean;
}

/** Board rooms carry awareness and server-pushed events only; clients never write their document. */
export function isReadOnly(room: Room, conn: Connection): boolean {
  return room.ref.type === 'board' || !can(conn.role, 'card:edit');
}

function send(conn: Connection, message: Uint8Array): void {
  if (conn.socket.readyState !== WS_OPEN) return;
  conn.socket.send(message, (err) => {
    if (err) conn.socket.close();
  });
}

function broadcast(room: Room, message: Uint8Array, except?: Connection): void {
  for (const conn of room.conns) if (conn !== except) send(conn, message);
}

/** One in-memory document and awareness per room, created on first use and dropped after the last client. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly storing = new Set<Promise<void>>();
  private shuttingDown = false;

  constructor(private readonly persistence: RoomPersistence = noPersistence) {}

  get size(): number {
    return this.rooms.size;
  }

  has(name: string): boolean {
    return this.rooms.has(name);
  }

  /** The loaded document of a room, for tests and for server-side writers. */
  doc(name: string): Y.Doc | undefined {
    return this.rooms.get(name)?.doc;
  }

  connectionsOf(userId: string, workspaceId: string): Connection[] {
    const found: Connection[] = [];
    for (const room of this.rooms.values()) {
      for (const conn of room.conns) {
        if (conn.userId === userId && conn.workspaceId === workspaceId) found.push(conn);
      }
    }
    return found;
  }

  private getOrCreate(ref: RoomRef): Room {
    const name = roomName(ref);
    const existing = this.rooms.get(name);
    if (existing && !existing.closing) return existing;
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    // The server has no presence of its own.
    awareness.setLocalState(null);
    const room: Room = {
      ref,
      name,
      doc,
      awareness,
      conns: new Set(),
      ready: Promise.resolve(),
      closing: false,
    };
    room.ready = this.persistence.load(ref, doc);
    // The cleanup on a failed load must not itself raise an unhandled rejection.
    room.ready.catch(() => {
      this.drop(room);
    });

    doc.on('update', (update: Uint8Array) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, WS_MESSAGE.sync);
      syncProtocol.writeUpdate(encoder, update);
      broadcast(room, encoding.toUint8Array(encoder));
    });

    awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changed = [...added, ...updated, ...removed];
        if (origin && typeof origin === 'object' && 'awarenessIds' in origin) {
          const conn = origin as Connection;
          for (const id of added) conn.awarenessIds.add(id);
          for (const id of removed) conn.awarenessIds.delete(id);
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, WS_MESSAGE.awareness);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
        );
        broadcast(room, encoding.toUint8Array(encoder));
      },
    );

    this.rooms.set(name, room);
    return room;
  }

  private drop(room: Room): void {
    if (this.rooms.get(room.name) === room) this.rooms.delete(room.name);
    room.closing = true;
    room.awareness.destroy();
    room.doc.destroy();
  }

  /**
   * Adds an authorized connection and sends the opening handshake (sync step 1 and the current
   * awareness states). Returns false when the room could not be loaded (the socket is closed).
   */
  async join(ref: RoomRef, conn: Connection): Promise<boolean> {
    if (this.shuttingDown) {
      conn.socket.close(WS_CLOSE.serviceRestart, 'Server shutting down');
      return false;
    }
    const room = this.getOrCreate(ref);
    room.conns.add(conn);
    conn.room = room;
    try {
      await room.ready;
    } catch {
      room.conns.delete(conn);
      conn.room = null;
      conn.socket.close(1011, 'Room unavailable');
      return false;
    }
    if (conn.socket.readyState !== WS_OPEN || room.closing) {
      await this.leave(conn);
      return false;
    }
    const step1 = encoding.createEncoder();
    encoding.writeVarUint(step1, WS_MESSAGE.sync);
    syncProtocol.writeSyncStep1(step1, room.doc);
    send(conn, encoding.toUint8Array(step1));

    const states = room.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, WS_MESSAGE.awareness);
      encoding.writeVarUint8Array(
        aw,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      );
      send(conn, encoding.toUint8Array(aw));
    }
    return true;
  }

  /** Handles one binary message from an authorized connection. Throws on a malformed message. */
  handleMessage(conn: Connection, data: Uint8Array): void {
    const room = conn.room;
    if (!room || room.closing || this.shuttingDown) return;
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case WS_MESSAGE.sync: {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, WS_MESSAGE.sync);
        const subType = decoding.readVarUint(decoder);
        if (subType === syncProtocol.messageYjsSyncStep1) {
          syncProtocol.readSyncStep1(decoder, reply, room.doc);
        } else if (isReadOnly(room, conn)) {
          // Viewers (and every client of a board room) may not write: discard (R3).
          return;
        } else if (subType === syncProtocol.messageYjsSyncStep2) {
          syncProtocol.readSyncStep2(decoder, room.doc, conn);
        } else if (subType === syncProtocol.messageYjsUpdate) {
          syncProtocol.readUpdate(decoder, room.doc, conn);
        } else {
          throw new Error('Unknown sync message');
        }
        // A reply longer than the type varint carries a step 2.
        if (encoding.length(reply) > 1) send(conn, encoding.toUint8Array(reply));
        break;
      }
      case WS_MESSAGE.awareness: {
        // Allowed for every role, viewers included. Identity fields come from the session (R1).
        const clean = sanitizeAwarenessUpdate(decoding.readVarUint8Array(decoder), {
          userId: conn.userId,
          name: conn.name,
          ownIds: conn.awarenessIds,
          existingIds: new Set(room.awareness.getStates().keys()),
        });
        if (clean) awarenessProtocol.applyAwarenessUpdate(room.awareness, clean, conn);
        break;
      }
      case WS_MESSAGE.queryAwareness: {
        const states = [...room.awareness.getStates().keys()];
        if (states.length === 0) break;
        const aw = encoding.createEncoder();
        encoding.writeVarUint(aw, WS_MESSAGE.awareness);
        encoding.writeVarUint8Array(
          aw,
          awarenessProtocol.encodeAwarenessUpdate(room.awareness, states),
        );
        send(conn, encoding.toUint8Array(aw));
        break;
      }
      default:
        // Auth, board events and unknown types are never accepted from clients: ignored.
        break;
    }
  }

  /** Removes a connection and its awareness states; unloads the room after the last client. */
  async leave(conn: Connection): Promise<void> {
    const room = conn.room;
    if (!room) return;
    conn.room = null;
    room.conns.delete(conn);
    if (conn.awarenessIds.size > 0 && !room.closing) {
      awarenessProtocol.removeAwarenessStates(room.awareness, [...conn.awarenessIds], null);
    }
    conn.awarenessIds.clear();
    if (room.conns.size > 0 || room.closing) return;
    const stored = (async () => {
      try {
        await room.ready;
        await this.persistence.store(room.ref, room.doc);
      } catch {
        // Persistence errors are logged by the hook's owner; the room is dropped either way.
      }
    })();
    this.storing.add(stored);
    try {
      await stored;
    } finally {
      this.storing.delete(stored);
    }
    // Someone who joined while storing keeps the room alive.
    if (room.conns.size === 0 && !room.closing) this.drop(room);
  }

  /** Pushes a JSON board event (custom message type) to every connection of a board room. */
  broadcastBoardEvent(boardId: string, event: BoardEventMessage): void {
    const room = this.rooms.get(roomName({ type: 'board', id: boardId }));
    if (!room || room.closing) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE.boardEvent);
    encoding.writeVarString(encoder, JSON.stringify(event));
    broadcast(room, encoding.toUint8Array(encoder));
  }

  /**
   * Graceful shutdown: stop accepting joins and document writes, write the pending batches, then
   * close every socket with 1012 (service restart, clients reconnect) and wait for the rooms to
   * be stored. Safe to call more than once.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    try {
      await this.persistence.flush?.();
    } catch {
      // Logged by the persistence layer; the rooms are stored (and retried) below.
    }
    const conns = [...this.rooms.values()].flatMap((r) => [...r.conns]);
    for (const conn of conns) {
      conn.socket.close(WS_CLOSE.serviceRestart, 'Server shutting down');
      await this.leave(conn);
    }
    await Promise.all([...this.storing]);
  }
}
