import { describe, expect, it } from 'vitest';
import { roomsClosedBy } from './access-events.js';

const A = '0198d0a0-0000-7000-8000-000000000001';
const B = '0198d0a0-0000-7000-8000-000000000002';
const C = '0198d0a0-0000-7000-8000-000000000003';

describe('roomsClosedBy', () => {
  it('a workspace closes every room of its connections (no list)', () => {
    expect(roomsClosedBy({ type: 'workspace', workspaceId: A })).toBeNull();
  });

  it('a project closes its board room and its cards rooms', () => {
    expect(roomsClosedBy({ type: 'project', workspaceId: A, boardId: B, cardIds: [C] })).toEqual([
      `board:${B}`,
      `card:${C}:description`,
    ]);
  });

  it('a card closes only its description room', () => {
    expect(roomsClosedBy({ type: 'card', cardId: C })).toEqual([`card:${C}:description`]);
  });
});
