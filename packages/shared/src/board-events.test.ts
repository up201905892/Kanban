import { describe, expect, it } from 'vitest';
import { boardEventSchema, clientMutationIdSchema } from './board-events.js';

const id = (n: number) => `0192f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const base = { boardId: id(1), actorId: id(2), at: '2026-11-10T10:00:00.000Z' };
const card = {
  id: id(10),
  columnId: id(20),
  number: 7,
  title: 'Card',
  position: 'a0',
  version: 3,
  assigneeId: null,
  priority: 'none',
  estimate: null,
};
const column = { id: id(20), boardId: id(1), name: 'To do', position: 'a0', isDone: false };

describe('boardEventSchema', () => {
  it('accepts every event type', () => {
    const events = [
      { type: 'column_created', ...base, entity: column, version: null },
      { type: 'column_updated', ...base, entity: column, version: null },
      { type: 'column_deleted', ...base, entity: { id: id(20), name: 'To do' }, version: null },
      { type: 'card_created', ...base, entity: card, version: 3 },
      { type: 'card_updated', ...base, entity: card, version: 3, clientMutationId: id(99) },
      { type: 'card_moved', ...base, entity: card, version: 3 },
      {
        type: 'card_deleted',
        ...base,
        entity: { id: id(10), columnId: id(20), number: 7, title: 'Card' },
        version: 4,
      },
    ];
    for (const event of events) expect(boardEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejects unknown types, bad versions and extra fields', () => {
    expect(boardEventSchema.safeParse({ type: 'card.created', ...base }).success).toBe(false);
    expect(
      boardEventSchema.safeParse({ type: 'card_updated', ...base, entity: card, version: 0 })
        .success,
    ).toBe(false);
    expect(
      boardEventSchema.safeParse({ type: 'column_updated', ...base, entity: column, version: 1 })
        .success,
    ).toBe(false);
    expect(
      boardEventSchema.safeParse({
        type: 'card_updated',
        ...base,
        entity: card,
        version: 3,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      boardEventSchema.safeParse({
        type: 'card_updated',
        ...base,
        entity: card,
        version: 3,
        clientMutationId: 'nope',
      }).success,
    ).toBe(false);
  });

  it('validates the client mutation id as a UUID', () => {
    expect(clientMutationIdSchema.safeParse(id(5)).success).toBe(true);
    expect(clientMutationIdSchema.safeParse('abc').success).toBe(false);
  });
});
