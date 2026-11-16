import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RETRY_MAX_MS,
  RETRY_MIN_MS,
  backoffDelay,
  createConnectionStore,
  createManagedSocket,
} from './connection';
import { FakeWebSocket } from '../../test-utils/websocket';

afterEach(() => {
  vi.useRealTimers();
  window.dispatchEvent(new Event('online'));
});

describe('backoffDelay', () => {
  it('doubles from 1 s and stops at 30 s (middle of the jitter range)', () => {
    const schedule = [0, 1, 2, 3, 4, 5, 6, 10].map((attempt) => backoffDelay(attempt, 0.5));
    expect(schedule).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('spreads each delay by 25 % either way and never exceeds 30 s', () => {
    expect(backoffDelay(0, 0)).toBe(750);
    expect(backoffDelay(0, 0.999)).toBe(1250);
    expect(backoffDelay(3, 0)).toBe(6000);
    expect(backoffDelay(3, 1)).toBe(10_000);
    for (const random of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(backoffDelay(20, random)).toBeLessThanOrEqual(RETRY_MAX_MS);
      expect(backoffDelay(20, random)).toBeGreaterThanOrEqual(RETRY_MAX_MS * 0.75);
    }
  });

  it('treats a negative attempt like the first one', () => {
    expect(backoffDelay(-3, 0.5)).toBe(RETRY_MIN_MS);
  });
});

describe('connection store', () => {
  const idle = { online: () => {}, offline: () => {} };

  it('derives one status from every source', () => {
    const store = createConnectionStore();
    expect(store.getSnapshot().status).toBe('connecting');
    const board = store.register(idle);
    const card = store.register(idle);
    expect(store.getSnapshot().status).toBe('connecting');
    board.setState('open');
    expect(store.getSnapshot().status).toBe('connecting');
    card.setState('open');
    expect(store.getSnapshot().status).toBe('connected');
    card.setState('down');
    expect(store.getSnapshot().status).toBe('reconnecting');
    // A source refused for good stops counting.
    card.setState('closed');
    expect(store.getSnapshot().status).toBe('connected');
    board.remove();
    card.remove();
  });

  it('is offline while the browser is, whatever the sockets say', () => {
    const store = createConnectionStore();
    const source = store.register(idle);
    source.setState('open');
    window.dispatchEvent(new Event('offline'));
    expect(store.getSnapshot().status).toBe('offline');
    window.dispatchEvent(new Event('online'));
    expect(store.getSnapshot().status).toBe('connected');
    source.remove();
  });

  it('counts unconfirmed changes as pending only while cut off', () => {
    const store = createConnectionStore();
    const source = store.register(idle);
    source.setState('open');
    source.setUnsynced(true);
    expect(store.getSnapshot()).toMatchObject({ unsyncedSources: 1, pendingSources: 0 });
    source.setState('down');
    expect(store.getSnapshot()).toMatchObject({ unsyncedSources: 1, pendingSources: 1 });
    source.setUnsynced(false);
    expect(store.getSnapshot()).toMatchObject({ unsyncedSources: 0, pendingSources: 0 });
    source.remove();
  });

  it('keeps the snapshot object while nothing changed and tells subscribers otherwise', () => {
    const store = createConnectionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const source = store.register(idle);
    const first = store.getSnapshot();
    source.setState('connecting');
    expect(store.getSnapshot()).toBe(first);
    source.setState('open');
    expect(store.getSnapshot()).not.toBe(first);
    expect(listener).toHaveBeenCalled();
    source.remove();
  });

  it('forgets an old expiry when a new page session starts', () => {
    const store = createConnectionStore();
    const first = store.register(idle);
    store.expireSession();
    expect(store.getSnapshot().sessionExpired).toBe(true);
    first.remove();
    const second = store.register(idle);
    expect(store.getSnapshot().sessionExpired).toBe(false);
    second.remove();
  });
});

describe('managed socket', () => {
  function start() {
    const store = createConnectionStore();
    const closes: { code: number; fatal: boolean }[] = [];
    const managed = createManagedSocket({
      url: 'ws://test/room',
      store,
      random: () => 0.5,
      onOpen: () => {},
      onMessage: () => {},
      onClose: (_ws, closed) => closes.push(closed),
    });
    return { store, managed, closes };
  }

  it('reconnects after 1 s, then 2 s, and starts over once open again', () => {
    vi.useFakeTimers();
    const { managed, store } = start();
    FakeWebSocket.last.open();
    FakeWebSocket.last.close(1006);
    expect(store.getSnapshot().status).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.last.close(1006); // never opened: the delay doubles
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    FakeWebSocket.last.open();
    FakeWebSocket.last.close(1006);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(4);
    managed.close();
  });

  it('treats the 1012 "restarting" close as a reconnect', () => {
    vi.useFakeTimers();
    const { managed, closes } = start();
    FakeWebSocket.last.open();
    FakeWebSocket.last.close(1012);
    expect(closes).toEqual([{ code: 1012, fatal: false }]);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    managed.close();
  });

  it('retries immediately on the browser online event', () => {
    vi.useFakeTimers();
    const { managed } = start();
    FakeWebSocket.last.open();
    FakeWebSocket.last.close(1006);
    expect(FakeWebSocket.instances).toHaveLength(1);
    window.dispatchEvent(new Event('online'));
    expect(FakeWebSocket.instances).toHaveLength(2);
    // The pending timer was cancelled: no third socket later.
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    managed.close();
  });

  it.each([4400, 4401, 4403])('gives up after %i', (code) => {
    vi.useFakeTimers();
    const { managed, store, closes } = start();
    FakeWebSocket.last.open();
    FakeWebSocket.last.close(code);
    vi.advanceTimersByTime(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(closes).toEqual([{ code, fatal: true }]);
    expect(store.getSnapshot().sessionExpired).toBe(code === 4401);
    managed.close();
  });

  it('does not reconnect after being closed on purpose', () => {
    vi.useFakeTimers();
    const { managed } = start();
    FakeWebSocket.last.open();
    managed.close();
    vi.advanceTimersByTime(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
