import { describe, expect, it } from 'vitest';
import type { BoardResponse, CardSummary, Column } from '@kanban/shared';
import {
  applyColumnDelete,
  applyColumnUpdate,
  cardsOf,
  layoutOf,
  neighboursAt,
  placeCard,
  placeColumn,
  sortColumns,
} from './ordering';

const col = (id: string, position: string, isDone = false): Column => ({
  id,
  boardId: 'b',
  name: id.toUpperCase(),
  position,
  isDone,
});
const card = (id: string, columnId: string, position: string, number: number): CardSummary => ({
  id,
  columnId,
  number,
  title: id,
  position,
  version: 1,
  assigneeId: null,
  priority: 'none',
  estimate: null,
});
const board = (): BoardResponse => ({
  board: { id: 'b', projectId: 'p' },
  columns: [col('a', 'a0'), col('b', 'a1'), col('c', 'a2', true)],
  cards: [card('x', 'a', 'a0', 1), card('y', 'a', 'a1', 2), card('z', 'b', 'a0', 3)],
});
const ids = (columns: Column[]) => sortColumns(columns).map((c) => c.id);

describe('placeColumn', () => {
  it('moves between neighbours and keeps the sort order consistent', () => {
    const result = placeColumn(board().columns, 'c', 'a', 'b');
    expect(ids(result)).toEqual(['a', 'c', 'b']);
  });

  it('moves to the start and to the end', () => {
    expect(ids(placeColumn(board().columns, 'c', null, 'a'))).toEqual(['c', 'a', 'b']);
    expect(ids(placeColumn(board().columns, 'a', 'c', null))).toEqual(['b', 'c', 'a']);
  });

  it('ignores an unknown column', () => {
    expect(ids(placeColumn(board().columns, 'zzz', 'a', null))).toEqual(['a', 'b', 'c']);
  });
});

describe('applyColumnUpdate', () => {
  it('renames', () => {
    const next = applyColumnUpdate(board(), 'a', { name: 'Backlog' });
    expect(next.columns.find((c) => c.id === 'a')?.name).toBe('Backlog');
  });

  it('moves the Done flag to exactly one column', () => {
    const next = applyColumnUpdate(board(), 'b', { isDone: true });
    expect(next.columns.filter((c) => c.isDone).map((c) => c.id)).toEqual(['b']);
  });
});

describe('cardsOf', () => {
  it('returns the cards of one column in position order', () => {
    const b = board();
    b.cards.reverse();
    expect(cardsOf(b, 'a').map((c) => c.id)).toEqual(['x', 'y']);
    expect(cardsOf(b, 'c')).toEqual([]);
  });
});

describe('applyColumnDelete', () => {
  it('removes the column and appends its cards to the destination in order', () => {
    const next = applyColumnDelete(board(), 'a', 'b');
    expect(next.columns.map((c) => c.id)).toEqual(['b', 'c']);
    expect(cardsOf(next, 'b').map((c) => c.id)).toEqual(['z', 'x', 'y']);
    expect(next.cards.some((c) => c.columnId === 'a')).toBe(false);
  });

  it('drops the cards when no destination is given', () => {
    const next = applyColumnDelete(board(), 'a', undefined);
    expect(next.cards.map((c) => c.id)).toEqual(['z']);
  });

  it('moves into an empty destination', () => {
    const next = applyColumnDelete(board(), 'a', 'c');
    expect(cardsOf(next, 'c').map((c) => c.id)).toEqual(['x', 'y']);
  });
});

describe('placeCard', () => {
  it('moves a card between two neighbours of another column', () => {
    const next = placeCard(board(), 'z', 'a', 'x', 'y');
    expect(cardsOf(next, 'a').map((c) => c.id)).toEqual(['x', 'z', 'y']);
    expect(cardsOf(next, 'b')).toEqual([]);
  });

  it('reorders inside a column and goes last without neighbours', () => {
    expect(cardsOf(placeCard(board(), 'x', 'a', 'y', null), 'a').map((c) => c.id)).toEqual([
      'y',
      'x',
    ]);
    expect(cardsOf(placeCard(board(), 'x', 'b', null, null), 'b').map((c) => c.id)).toEqual([
      'z',
      'x',
    ]);
    expect(cardsOf(placeCard(board(), 'y', 'a', null, 'x'), 'a').map((c) => c.id)).toEqual([
      'y',
      'x',
    ]);
  });

  it('treats a stale neighbour as missing and uses the other one', () => {
    expect(cardsOf(placeCard(board(), 'z', 'a', 'gone', 'y'), 'a').map((c) => c.id)).toEqual([
      'x',
      'z',
      'y',
    ]);
    expect(cardsOf(placeCard(board(), 'z', 'a', 'x', 'gone'), 'a').map((c) => c.id)).toEqual([
      'x',
      'z',
      'y',
    ]);
  });

  it('ignores an unknown card', () => {
    const b = board();
    expect(placeCard(b, 'nope', 'a', null, null)).toBe(b);
  });
});

describe('neighboursAt and layoutOf', () => {
  it('names the neighbours at an index, null at the edges', () => {
    expect(neighboursAt(['p', 'q', 'r'], 1)).toEqual({ afterCardId: 'p', beforeCardId: 'r' });
    expect(neighboursAt(['p', 'q', 'r'], 0)).toEqual({ afterCardId: null, beforeCardId: 'q' });
    expect(neighboursAt(['p', 'q', 'r'], 2)).toEqual({ afterCardId: 'q', beforeCardId: null });
    expect(neighboursAt(['p'], 0)).toEqual({ afterCardId: null, beforeCardId: null });
  });

  it('lists the card ids of every column in order', () => {
    expect(layoutOf(board())).toEqual({ a: ['x', 'y'], b: ['z'], c: [] });
  });
});
