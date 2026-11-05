import { describe, expect, it } from 'vitest';
import {
  COLUMN_NAME_MAX_LENGTH,
  createColumnRequestSchema,
  moveNeighbours,
  updateColumnRequestSchema,
} from './board.js';

const ids = ['a', 'b', 'c', 'd'];

describe('moveNeighbours', () => {
  it('moves left between the two columns before it', () => {
    expect(moveNeighbours(ids, 'c', 'left')).toEqual({ afterColumnId: 'a', beforeColumnId: 'b' });
  });

  it('moves left to the very start when it is second', () => {
    expect(moveNeighbours(ids, 'b', 'left')).toEqual({ afterColumnId: null, beforeColumnId: 'a' });
  });

  it('moves right between the two columns after it', () => {
    expect(moveNeighbours(ids, 'b', 'right')).toEqual({ afterColumnId: 'c', beforeColumnId: 'd' });
  });

  it('moves right to the very end when it is second to last', () => {
    expect(moveNeighbours(ids, 'c', 'right')).toEqual({ afterColumnId: 'd', beforeColumnId: null });
  });

  it('returns null at the edges', () => {
    expect(moveNeighbours(ids, 'a', 'left')).toBeNull();
    expect(moveNeighbours(ids, 'd', 'right')).toBeNull();
  });

  it('returns null for an unknown id and for a single column', () => {
    expect(moveNeighbours(ids, 'zzz', 'left')).toBeNull();
    expect(moveNeighbours(['a'], 'a', 'right')).toBeNull();
  });
});

describe('column request schemas', () => {
  it('trims names and enforces 1 to 50 characters', () => {
    expect(createColumnRequestSchema.parse({ name: '  Review ' }).name).toBe('Review');
    expect(createColumnRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(
      createColumnRequestSchema.safeParse({ name: 'x'.repeat(COLUMN_NAME_MAX_LENGTH) }).success,
    ).toBe(true);
    expect(
      createColumnRequestSchema.safeParse({ name: 'x'.repeat(COLUMN_NAME_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it('rejects unknown fields and an empty update', () => {
    expect(createColumnRequestSchema.safeParse({ name: 'A', isDone: true }).success).toBe(false);
    expect(updateColumnRequestSchema.safeParse({}).success).toBe(false);
    expect(updateColumnRequestSchema.safeParse({ isDone: false }).success).toBe(true);
  });
});
