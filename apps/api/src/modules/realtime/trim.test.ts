import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DESCRIPTION_TEXT_NAME } from '@kanban/shared';
import { TRIM_ORIGIN, trimDescription, type Room } from './rooms.js';

function fakeRoom(content: string, type = 'card-description'): { room: Room; doc: Y.Doc } {
  const doc = new Y.Doc();
  doc.getText(DESCRIPTION_TEXT_NAME).insert(0, content);
  return { room: { doc, ref: { type, id: 'c1' } } as unknown as Room, doc };
}

describe('trimDescription (KB-040, tester)', () => {
  it('cuts to exactly 20,000 and is idempotent, with the server origin', () => {
    const { room, doc } = fakeRoom('a'.repeat(30_000));
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    trimDescription(room);
    expect(doc.getText(DESCRIPTION_TEXT_NAME).length).toBe(20_000);
    trimDescription(room);
    expect(origins).toEqual([TRIM_ORIGIN]);
  });

  it('does not split a surrogate pair at the boundary', () => {
    const { room, doc } = fakeRoom('a'.repeat(19_999) + '\u{1F600}' + 'b');
    trimDescription(room);
    expect(doc.getText(DESCRIPTION_TEXT_NAME).toString()).toBe('a'.repeat(19_999));
  });

  it('ignores other room types and texts at the limit', () => {
    const board = fakeRoom('a'.repeat(30_000), 'board');
    trimDescription(board.room);
    expect(board.doc.getText(DESCRIPTION_TEXT_NAME).length).toBe(30_000);
    const exact = fakeRoom('a'.repeat(20_000));
    trimDescription(exact.room);
    expect(exact.doc.getText(DESCRIPTION_TEXT_NAME).length).toBe(20_000);
  });
});
