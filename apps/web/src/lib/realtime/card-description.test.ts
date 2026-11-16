import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WS_MESSAGE } from '@kanban/shared';
import { FakeWebSocket } from '../../test-utils/websocket';
import { connectCardDescription } from './card-description';
import { connectionStore } from './connection';

afterEach(() => {
  vi.useRealTimers();
});

/** What the server answers to a sync step 1: its state as sync step 2. */
function step2(): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, WS_MESSAGE.sync);
  syncProtocol.writeSyncStep2(encoder, new Y.Doc());
  const bytes = encoding.toUint8Array(encoder);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('description connection (KB-021)', () => {
  it('keeps offline edits and reports them as pending until the server confirms them', () => {
    vi.useFakeTimers();
    const connection = connectCardDescription('card-1');
    const socket = FakeWebSocket.last;
    socket.open();
    socket.receiveRaw(step2());
    expect(connection.status).toBe('saved');

    socket.close(1006);
    expect(connection.status).toBe('reconnecting');
    connection.text.insert(0, 'typed offline');
    expect(connection.text.toString()).toBe('typed offline');
    expect(connectionStore.getSnapshot()).toMatchObject({ unsyncedSources: 1, pendingSources: 1 });

    vi.advanceTimersByTime(1500);
    const again = FakeWebSocket.last;
    expect(again).not.toBe(socket);
    again.open();
    // The unsent edit goes out with the reconnect, followed by a question that confirms it.
    expect(again.sent.length).toBeGreaterThan(0);
    expect(connection.status).toBe('syncing');
    again.receiveRaw(step2());
    expect(connection.status).toBe('saved');
    expect(connectionStore.getSnapshot().unsyncedSources).toBe(0);
    connection.destroy();
  });

  it('closes at once when destroyed with nothing unconfirmed', () => {
    const connection = connectCardDescription('card-2');
    const socket = FakeWebSocket.last;
    socket.open();
    socket.receiveRaw(step2());
    connection.destroy();
    expect(socket.closed).toBe(true);
  });

  it('keeps syncing in the background when destroyed with unconfirmed changes, then closes', () => {
    vi.useFakeTimers();
    const connection = connectCardDescription('card-3');
    const socket = FakeWebSocket.last;
    socket.open();
    socket.receiveRaw(step2());
    socket.close(1006);
    connection.text.insert(0, 'do not lose me');
    connection.destroy(); // the card dialog was closed while offline
    expect(connectionStore.getSnapshot().unsyncedSources).toBe(1);

    vi.advanceTimersByTime(1500);
    const again = FakeWebSocket.last;
    expect(again).not.toBe(socket);
    again.open();
    expect(again.closed).toBe(false);
    again.receiveRaw(step2());
    expect(again.closed).toBe(true);
    expect(connectionStore.getSnapshot().unsyncedSources).toBe(0);
  });
});
