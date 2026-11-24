import type { BoardEvent, BoardResponse, CardSummary, Column } from '@kanban/shared';
import { applyBoardEvent } from './board-events';
import { createTombstones, filterTombstoned, IdSet } from './tombstones';

const id = (n: number) => `0192f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const BOARD = id(1);

const column = (n: number): Column => ({
  id: id(100 + n),
  boardId: BOARD,
  name: `Column ${n}`,
  position: `a${n}`,
  isDone: false,
});

const card = (n: number, columnId = id(101), version = 1): CardSummary => ({
  id: id(200 + n),
  columnId,
  number: n,
  title: `Card ${n}`,
  position: `a${n}`,
  version,
  assigneeId: null,
  priority: 'none',
  estimate: null,
  sprintId: null,
});

const board = (): BoardResponse => ({
  board: { id: BOARD, projectId: id(3) },
  columns: [column(1), column(2)],
  cards: [card(1), card(2, id(102))],
  sprints: [],
});

const base = { boardId: BOARD, actorId: id(2), at: '2026-11-24T10:00:00.000Z' };
const cardEvent = (
  type: 'card_created' | 'card_updated' | 'card_moved',
  entity: CardSummary,
): BoardEvent => ({ type, ...base, entity, version: entity.version });
const cardDeleted = (c: CardSummary): BoardEvent => ({
  type: 'card_deleted',
  ...base,
  entity: { id: c.id, columnId: c.columnId, number: c.number, title: c.title },
  version: c.version + 1,
});

describe('IdSet', () => {
  it('drops the oldest id past the bound and leaves the others alone', () => {
    const set = new IdSet(3);
    ['a', 'b', 'c', 'd'].forEach((x) => set.add(x));
    expect(set.size).toBe(3);
    expect(set.has('a')).toBe(false);
    expect(['b', 'c', 'd'].every((x) => set.has(x))).toBe(true);
    expect(set.has('unrelated')).toBe(false);
  });

  it('keeps an id that was added again', () => {
    const set = new IdSet(2);
    set.add('a');
    set.add('b');
    set.add('a');
    set.add('c');
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(false);
  });
});

describe('tombstones in applyBoardEvent', () => {
  it('ignores updates, moves and creates of a deleted card and returns the same object', () => {
    const tombstones = createTombstones();
    const start = board();
    const removed = applyBoardEvent(start, cardDeleted(card(2, id(102))), tombstones);
    expect(removed.cards.map((c) => c.number)).toEqual([1]);
    tombstones.cards.add(id(202));
    for (const type of ['card_updated', 'card_moved', 'card_created'] as const) {
      expect(applyBoardEvent(removed, cardEvent(type, card(2, id(101), 9)), tombstones)).toBe(
        removed,
      );
    }
  });

  it('ignores column events for a deleted column', () => {
    const tombstones = createTombstones();
    tombstones.columns.add(id(102));
    const start = board();
    const event: BoardEvent = {
      type: 'column_updated',
      ...base,
      entity: { ...column(2), name: 'Late' },
      version: null,
    };
    expect(applyBoardEvent(start, event, tombstones)).toBe(start);
  });

  it('does not affect ids that are not in the set', () => {
    const tombstones = createTombstones();
    tombstones.cards.add(id(299));
    const start = board();
    const next = applyBoardEvent(start, cardEvent('card_updated', card(1, id(101), 2)), tombstones);
    expect(next.cards[0]?.version).toBe(2);
  });
});

describe('filterTombstoned', () => {
  it('removes tombstoned cards and columns (with their cards)', () => {
    const tombstones = createTombstones();
    tombstones.cards.add(id(201));
    const noCard = filterTombstoned(board(), tombstones);
    expect(noCard.cards.map((c) => c.number)).toEqual([2]);

    tombstones.columns.add(id(102));
    const noColumn = filterTombstoned(board(), tombstones);
    expect(noColumn.columns.map((c) => c.id)).toEqual([id(101)]);
    expect(noColumn.cards).toEqual([]);
  });

  it('returns the same object when nothing is tombstoned', () => {
    const start = board();
    expect(filterTombstoned(start, createTombstones())).toBe(start);
  });
});
