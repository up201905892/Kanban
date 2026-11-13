import type { BoardEvent, BoardResponse, Card, CardSummary, Column } from '@kanban/shared';
import { forgetMutationIds, isOwnMutation, newMutationId } from '../../lib/api/mutation-ids';
import { parseBoardMessage } from '../../lib/realtime/board-socket';
import { encodeBoardEvent } from '../../test-utils/websocket';
import { applyBoardEvent, applyCardEvent, remoteChangeOf } from './board-events';

const id = (n: number) => `0192f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const BOARD = id(1);
const ACTOR = id(2);

const column = (n: number, extra: Partial<Column> = {}): Column => ({
  id: id(100 + n),
  boardId: BOARD,
  name: `Column ${n}`,
  position: `a${n}`,
  isDone: false,
  ...extra,
});

const card = (n: number, columnId = id(101), extra: Partial<CardSummary> = {}): CardSummary => ({
  id: id(200 + n),
  columnId,
  number: n,
  title: `Card ${n}`,
  position: `a${n}`,
  version: 1,
  assigneeId: null,
  priority: 'none',
  estimate: null,
  ...extra,
});

const board = (): BoardResponse => ({
  board: { id: BOARD, projectId: id(3) },
  columns: [column(1), column(2), column(3, { isDone: true })],
  cards: [card(1), card(2, id(102))],
});

const base = { boardId: BOARD, actorId: ACTOR, at: '2026-11-10T10:00:00.000Z' };
const cardEvent = (
  type: 'card_created' | 'card_updated' | 'card_moved',
  entity: CardSummary,
): BoardEvent => ({ type, ...base, entity, version: entity.version });

describe('applyBoardEvent: cards', () => {
  it('adds a created card and ignores the same event delivered twice', () => {
    const event = cardEvent('card_created', card(3));
    const once = applyBoardEvent(board(), event);
    expect(once.cards.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(applyBoardEvent(once, event)).toBe(once);
  });

  it('applies a newer update and ignores older or equal versions', () => {
    const start = board();
    const updated = applyBoardEvent(
      start,
      cardEvent('card_updated', card(1, id(101), { title: 'New', version: 3 })),
    );
    expect(updated.cards.find((c) => c.number === 1)?.title).toBe('New');
    // Out of order: version 2 arrives after 3.
    const stale = cardEvent('card_updated', card(1, id(101), { title: 'Old', version: 2 }));
    expect(applyBoardEvent(updated, stale)).toBe(updated);
    const same = cardEvent('card_updated', card(1, id(101), { title: 'Same', version: 3 }));
    expect(applyBoardEvent(updated, same)).toBe(updated);
  });

  it('moves a card to another column with its new position', () => {
    const moved = applyBoardEvent(
      board(),
      cardEvent('card_moved', card(1, id(102), { position: 'a0', version: 2 })),
    );
    expect(moved.cards.find((c) => c.number === 1)).toMatchObject({
      columnId: id(102),
      position: 'a0',
    });
  });

  it('adds an unknown card carried by an update (a missed create)', () => {
    const next = applyBoardEvent(
      board(),
      cardEvent('card_updated', card(9, id(101), { version: 4 })),
    );
    expect(next.cards.some((c) => c.number === 9)).toBe(true);
  });

  it('removes a deleted card once and ignores a stale delete', () => {
    const del = (version: number): BoardEvent => ({
      type: 'card_deleted',
      ...base,
      entity: { id: id(201), columnId: id(101), number: 1, title: 'Card 1' },
      version,
    });
    const start = board();
    expect(applyBoardEvent(start, del(1))).toBe(start);
    const gone = applyBoardEvent(start, del(2));
    expect(gone.cards.map((c) => c.number)).toEqual([2]);
    expect(applyBoardEvent(gone, del(2))).toBe(gone);
  });
});

describe('applyBoardEvent: columns', () => {
  it('adds and renames columns', () => {
    const created: BoardEvent = {
      type: 'column_created',
      ...base,
      entity: column(4),
      version: null,
    };
    const added = applyBoardEvent(board(), created);
    expect(added.columns).toHaveLength(4);
    const renamed = applyBoardEvent(added, {
      type: 'column_updated',
      ...base,
      entity: column(4, { name: 'Renamed' }),
      version: null,
    });
    expect(renamed.columns.find((c) => c.id === id(104))?.name).toBe('Renamed');
    expect(renamed.columns).toHaveLength(4);
  });

  it('keeps the Done column exclusive', () => {
    const next = applyBoardEvent(board(), {
      type: 'column_updated',
      ...base,
      entity: column(1, { isDone: true }),
      version: null,
    });
    expect(next.columns.filter((c) => c.isDone).map((c) => c.id)).toEqual([id(101)]);
  });

  it('removes a deleted column and any card still in it, and ignores a repeat', () => {
    const event: BoardEvent = {
      type: 'column_deleted',
      ...base,
      entity: { id: id(102), name: 'Column 2' },
      version: null,
    };
    const next = applyBoardEvent(board(), event);
    expect(next.columns.map((c) => c.id)).not.toContain(id(102));
    expect(next.cards.map((c) => c.number)).toEqual([1]);
    expect(applyBoardEvent(next, event)).toBe(next);
  });
});

describe('applyCardEvent', () => {
  const full = (extra: Partial<Card> = {}): Card => ({
    ...card(1),
    boardId: BOARD,
    description: 'Kept',
    createdById: ACTOR,
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
    ...extra,
  });

  it('updates the summary fields, keeps the description, ignores stale events', () => {
    const next = applyCardEvent(
      full(),
      cardEvent('card_updated', card(1, id(101), { title: 'T', version: 2 })),
    );
    expect(next).toMatchObject({ title: 'T', version: 2, description: 'Kept' });
    expect(applyCardEvent(next, cardEvent('card_updated', card(1, id(101), { version: 2 })))).toBe(
      next,
    );
  });

  it('ignores events about other cards and deletions', () => {
    const start = full();
    expect(applyCardEvent(start, cardEvent('card_updated', card(2, id(101), { version: 5 })))).toBe(
      start,
    );
  });
});

describe('remoteChangeOf', () => {
  it('reports a move that is newer than the cached card', () => {
    const change = remoteChangeOf(
      board(),
      cardEvent('card_moved', card(1, id(103), { version: 2 })),
    );
    expect(change).toMatchObject({ kind: 'moved', toColumnId: id(103), actorId: ACTOR });
  });

  it('reports nothing for a stale move, an unchanged place or an unknown card', () => {
    expect(
      remoteChangeOf(board(), cardEvent('card_moved', card(1, id(103), { version: 1 }))),
    ).toBeNull();
    expect(
      remoteChangeOf(board(), cardEvent('card_moved', card(1, id(101), { version: 2 }))),
    ).toBeNull();
    expect(
      remoteChangeOf(board(), cardEvent('card_moved', card(7, id(103), { version: 2 }))),
    ).toBeNull();
  });

  it('reports a deletion of a known card only', () => {
    const del = (n: number): BoardEvent => ({
      type: 'card_deleted',
      ...base,
      entity: { id: id(200 + n), columnId: id(101), number: n, title: `Card ${n}` },
      version: 2,
    });
    expect(remoteChangeOf(board(), del(1))).toMatchObject({ kind: 'deleted', number: 1 });
    expect(remoteChangeOf(board(), del(9))).toBeNull();
  });
});

describe('own mutation ids', () => {
  it('recognises ids this tab generated and nothing else', () => {
    forgetMutationIds();
    const mine = newMutationId();
    expect(isOwnMutation(mine)).toBe(true);
    expect(isOwnMutation(id(999))).toBe(false);
    expect(isOwnMutation(undefined)).toBe(false);
  });

  it('forgets the oldest ids after a few hundred', () => {
    forgetMutationIds();
    const first = newMutationId();
    for (let i = 0; i < 250; i += 1) newMutationId();
    expect(isOwnMutation(first)).toBe(false);
  });
});

describe('parseBoardMessage', () => {
  it('decodes a board-event message', () => {
    const event = cardEvent('card_created', card(1));
    expect(parseBoardMessage(encodeBoardEvent(event))).toEqual(event);
  });

  it('ignores sync messages, malformed messages and invalid events', () => {
    expect(parseBoardMessage(new Uint8Array([0, 0, 1, 2]))).toBeNull();
    expect(parseBoardMessage(new Uint8Array([4, 50, 1]))).toBeNull();
    expect(parseBoardMessage(new Uint8Array([]))).toBeNull();
    const garbage = new TextEncoder().encode('{"type":"x","data":{"type":"nope"}}');
    expect(parseBoardMessage(new Uint8Array([4, garbage.length, ...garbage]))).toBeNull();
  });
});
