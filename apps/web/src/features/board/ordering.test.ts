import { describe, expect, it } from 'vitest';
import type { BoardResponse, Column } from '@kanban/shared';
import { applyColumnUpdate, placeColumn, sortColumns } from './ordering';

const col = (id: string, position: string, isDone = false): Column => ({
  id,
  boardId: 'b',
  name: id.toUpperCase(),
  position,
  isDone,
});
const board = (): BoardResponse => ({
  board: { id: 'b', projectId: 'p' },
  columns: [col('a', 'a0'), col('b', 'a1'), col('c', 'a2', true)],
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
