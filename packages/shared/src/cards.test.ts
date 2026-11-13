import { describe, expect, it } from 'vitest';
import {
  CARD_DESCRIPTION_MAX_LENGTH,
  CARD_TITLE_MAX_LENGTH,
  activityEventDataSchema,
  cardReference,
  cardSchema,
  createCardRequestSchema,
  deleteColumnQuerySchema,
  moveCardRequestSchema,
  updateCardRequestSchema,
} from './cards.js';

const id = '0192f000-0000-7000-8000-000000000001';

describe('card requests', () => {
  it('trims the title and accepts the boundary lengths', () => {
    expect(createCardRequestSchema.parse({ title: '  Hi  ' }).title).toBe('Hi');
    expect(
      createCardRequestSchema.safeParse({ title: 'x'.repeat(CARD_TITLE_MAX_LENGTH) }).success,
    ).toBe(true);
    expect(
      createCardRequestSchema.safeParse({
        title: 't',
        description: 'x'.repeat(CARD_DESCRIPTION_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });

  it.each([
    [{ title: '' }],
    [{ title: '   ' }],
    [{ title: 'x'.repeat(CARD_TITLE_MAX_LENGTH + 1) }],
    [{ title: 't', description: 'x'.repeat(CARD_DESCRIPTION_MAX_LENGTH + 1) }],
    [{ title: 't', id: 'not-a-uuid' }],
    [{ title: 't', unknown: 1 }],
    [{}],
  ])('rejects invalid create body %j', (body) => {
    expect(createCardRequestSchema.safeParse(body).success).toBe(false);
  });

  it('accepts neighbours, including null for "no neighbour"', () => {
    const parsed = createCardRequestSchema.parse({
      title: 't',
      afterCardId: null,
      beforeCardId: id,
    });
    expect(parsed.afterCardId).toBeNull();
    expect(parsed.beforeCardId).toBe(id);
  });

  it('requires at least one known field to update', () => {
    expect(updateCardRequestSchema.safeParse({}).success).toBe(false);
    expect(updateCardRequestSchema.safeParse({ title: 'x', version: 2 }).success).toBe(false);
    // One write path for the description: the Yjs document (KB-019).
    expect(updateCardRequestSchema.safeParse({ description: '' }).success).toBe(false);
    expect(updateCardRequestSchema.safeParse({ title: 'x', description: 'y' }).success).toBe(false);
    expect(updateCardRequestSchema.safeParse({ title: 'x' }).success).toBe(true);
  });

  it('validates the delete-column query', () => {
    expect(deleteColumnQuerySchema.safeParse({}).success).toBe(true);
    expect(deleteColumnQuerySchema.safeParse({ moveCardsTo: id }).success).toBe(true);
    expect(deleteColumnQuerySchema.safeParse({ moveCardsTo: 'x' }).success).toBe(false);
    expect(deleteColumnQuerySchema.safeParse({ other: id }).success).toBe(false);
  });
});

describe('cardSchema', () => {
  it('parses a full card', () => {
    const card = {
      id,
      columnId: id,
      boardId: id,
      number: 1,
      title: 'T',
      position: 'a0',
      version: 1,
      assigneeId: null,
      priority: 'none',
      estimate: null,
      description: '',
      createdById: id,
      createdAt: '2026-11-05T10:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z',
    };
    expect(cardSchema.parse(card)).toEqual(card);
  });
});

describe('card field updates', () => {
  it('accepts valid assignee, priority and estimate values, including null to clear', () => {
    for (const body of [
      { assigneeId: id },
      { assigneeId: null },
      { priority: 'high' },
      { estimate: 0 },
      { estimate: 100 },
      { estimate: null },
      { assigneeId: id, priority: 'low', estimate: 8 },
    ]) {
      expect(updateCardRequestSchema.safeParse(body).success).toBe(true);
    }
  });

  it('rejects out-of-range, fractional and unknown values', () => {
    for (const body of [
      { estimate: -1 },
      { estimate: 101 },
      { estimate: 1.5 },
      { estimate: '3' },
      { priority: 'critical' },
      { assigneeId: 'x' },
    ]) {
      expect(updateCardRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('moveCardRequestSchema', () => {
  it('needs a column; neighbours are optional and nullable', () => {
    expect(moveCardRequestSchema.safeParse({ columnId: id }).success).toBe(true);
    expect(
      moveCardRequestSchema.safeParse({ columnId: id, afterCardId: null, beforeCardId: id })
        .success,
    ).toBe(true);
  });

  it('rejects a missing column, bad ids and unknown fields', () => {
    expect(moveCardRequestSchema.safeParse({}).success).toBe(false);
    expect(moveCardRequestSchema.safeParse({ columnId: 'x' }).success).toBe(false);
    expect(moveCardRequestSchema.safeParse({ columnId: id, afterCardId: 'x' }).success).toBe(false);
    expect(moveCardRequestSchema.safeParse({ columnId: id, position: 'a0' }).success).toBe(false);
  });
});

describe('cardReference', () => {
  it('joins the project key and the number', () => {
    expect(cardReference('KB', 12)).toBe('KB-12');
  });
});

describe('activityEventDataSchema', () => {
  it('accepts each event type with its own data shape', () => {
    const column = { columnId: id, columnName: 'To do' };
    for (const event of [
      { type: 'created', data: { title: 'T', column } },
      { type: 'title_changed', data: { from: 'A', to: 'B' } },
      { type: 'description_changed', data: { from: 0, to: 12 } },
      { type: 'deleted', data: { title: 'T' } },
      { type: 'column_deleted_moved', data: { from: column, to: column } },
      { type: 'moved', data: { fromColumnId: id, toColumnId: id } },
      { type: 'assignee_changed', data: { from: null, to: id } },
      { type: 'priority_changed', data: { from: 'none', to: 'urgent' } },
      { type: 'estimate_changed', data: { from: null, to: 5 } },
    ]) {
      expect(activityEventDataSchema.safeParse(event).success).toBe(true);
    }
  });

  it('rejects an unknown type or the wrong data for a type', () => {
    expect(activityEventDataSchema.safeParse({ type: 'moved', data: {} }).success).toBe(false);
    expect(
      activityEventDataSchema.safeParse({
        type: 'description_changed',
        data: { from: 'a', to: 'b' },
      }).success,
    ).toBe(false);
    expect(
      activityEventDataSchema.safeParse({ type: 'title_changed', data: { from: 'a' } }).success,
    ).toBe(false);
  });
});
