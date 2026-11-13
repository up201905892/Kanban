import { describe, expect, it } from 'vitest';
import { boardEventMessageSchema, parseRoomName, roomName } from './realtime.js';

const ID = '3f2b8c1e-5d4a-4b7e-9a6c-1d2e3f4a5b6c';

describe('parseRoomName', () => {
  it('parses board and card description rooms', () => {
    expect(parseRoomName(`board:${ID}`)).toEqual({ type: 'board', id: ID });
    expect(parseRoomName(`card:${ID}:description`)).toEqual({ type: 'card-description', id: ID });
  });

  it('round-trips through roomName', () => {
    for (const ref of [
      { type: 'board', id: ID },
      { type: 'card-description', id: ID },
    ] as const) {
      expect(parseRoomName(roomName(ref))).toEqual(ref);
    }
  });

  it.each([
    '',
    'board',
    'board:',
    'board:not-a-uuid',
    `board:${ID}:extra`,
    `card:${ID}`,
    `card:${ID}:title`,
    `card:${ID}:description:x`,
    `room:${ID}`,
    ` board:${ID}`,
    `board:${ID}\n`,
    `BOARD:${ID}`,
  ])('rejects %j', (name) => {
    expect(parseRoomName(name)).toBeNull();
  });
});

describe('boardEventMessageSchema', () => {
  it('accepts a typed event and rejects extra keys or an empty type', () => {
    expect(boardEventMessageSchema.safeParse({ type: 'card.moved', data: {} }).success).toBe(true);
    expect(boardEventMessageSchema.safeParse({ type: '', data: {} }).success).toBe(false);
    expect(boardEventMessageSchema.safeParse({ type: 'x', data: {}, extra: 1 }).success).toBe(
      false,
    );
  });
});
