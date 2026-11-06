import { describe, expect, it } from 'vitest';
import { MAX_KEY_LENGTH } from '@kanban/shared';
import { keyForPlacement, placeWithRebalance } from './position.js';

const siblings = [
  { id: 'a', position: 'a0' },
  { id: 'b', position: 'a1' },
  { id: 'c', position: 'a2' },
];

describe('keyForPlacement', () => {
  it('goes to the end with no neighbours or on an empty list', () => {
    expect(keyForPlacement(siblings, undefined, undefined) > 'a2').toBe(true);
    expect(keyForPlacement([], null, null)).toBe('a0');
  });

  it('goes between two neighbours', () => {
    const key = keyForPlacement(siblings, 'a', 'b');
    expect(key > 'a0' && key < 'a1').toBe(true);
  });

  it('goes to the start before the first column', () => {
    expect(keyForPlacement(siblings, null, 'a') < 'a0').toBe(true);
  });

  it('uses the remaining neighbour when the other one is stale', () => {
    const key = keyForPlacement(siblings, 'gone', 'b');
    expect(key > 'a0' && key < 'a1').toBe(true);
    const after = keyForPlacement(siblings, 'b', 'gone');
    expect(after > 'a1' && after < 'a2').toBe(true);
  });

  it('ignores a reversed pair and places after the first neighbour', () => {
    const key = keyForPlacement(siblings, 'b', 'a');
    expect(key > 'a1' && key < 'a2').toBe(true);
  });
});

describe('placeWithRebalance', () => {
  it('does not respace short keys', async () => {
    let called = false;
    await placeWithRebalance(siblings, 'a', 'b', async () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  it('respaces the siblings when a key grows too long', async () => {
    let low = 'a0';
    const high = 'a1';
    // Insert repeatedly just after x until the key outgrows the limit.
    while (low.length <= MAX_KEY_LENGTH) {
      low = keyForPlacement(
        [
          { id: 'x', position: 'a0' },
          { id: 'n', position: low },
          { id: 'y', position: high },
        ],
        'x',
        'n',
      );
    }
    const tooLong = [
      { id: 'x', position: 'a0' },
      { id: 'y', position: low },
    ];
    let updates: { id: string; position: string }[] = [];
    const key = await placeWithRebalance(tooLong, 'x', 'y', async (u) => {
      updates = u;
    });
    expect(updates.map((u) => u.id)).toEqual(['x', 'y']);
    expect(key.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
    expect(key > (updates[0]?.position ?? '') && key < (updates[1]?.position ?? '')).toBe(true);
  });
});
