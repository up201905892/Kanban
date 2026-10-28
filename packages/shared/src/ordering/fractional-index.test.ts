import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InvalidKeyError,
  MAX_KEY_LENGTH,
  compareByPosition,
  isValidKey,
  keyBetween,
  keysBetween,
  needsRebalance,
} from './index.js';

describe('isValidKey', () => {
  it('accepts well-formed keys', () => {
    for (const k of ['a0', 'a1', 'a0V', 'Zz', 'b00', 'zzzzzzzzzzzzzzzzzzzzzzzzzzz1']) {
      expect(isValidKey(k)).toBe(true);
    }
  });

  it('rejects malformed keys', () => {
    const smallest = `A${'0'.repeat(26)}`;
    for (const k of ['', 'a', 'b0', 'a00', 'a10', '0', 'a0-', 'é0', smallest, 'a 1']) {
      expect(isValidKey(k)).toBe(false);
    }
    expect(isValidKey(null)).toBe(false);
    expect(isValidKey(42)).toBe(false);
  });
});

describe('keyBetween', () => {
  it('returns the first key for an empty list', () => {
    expect(keyBetween(null, null)).toBe('a0');
  });

  it('appends after and prepends before', () => {
    expect(keyBetween('a0', null) > 'a0').toBe(true);
    expect(keyBetween(null, 'a0') < 'a0').toBe(true);
  });

  it('returns a key strictly between two neighbours', () => {
    const k = keyBetween('a0', 'a1');
    expect(k > 'a0' && k < 'a1').toBe(true);
    expect(isValidKey(k)).toBe(true);
  });

  it('works across integer-length boundaries', () => {
    const k = keyBetween('az', 'b00');
    expect(k > 'az' && k < 'b00').toBe(true);
    const j = keyBetween('Zz', 'a0');
    expect(j > 'Zz' && j < 'a0').toBe(true);
  });

  it('throws on invalid keys', () => {
    expect(() => keyBetween('a00', null)).toThrow(InvalidKeyError);
    expect(() => keyBetween(null, '')).toThrow(InvalidKeyError);
    expect(() => keyBetween('b0', 'a0x')).toThrow(InvalidKeyError);
  });

  it('throws when a >= b', () => {
    expect(() => keyBetween('a1', 'a1')).toThrow(InvalidKeyError);
    expect(() => keyBetween('a2', 'a1')).toThrow(InvalidKeyError);
  });
});

describe('keysBetween', () => {
  it('returns empty for n = 0 and one key for n = 1', () => {
    expect(keysBetween(null, null, 0)).toEqual([]);
    expect(keysBetween('a0', 'a1', 1)).toHaveLength(1);
  });

  it('rejects a negative or non-integer n', () => {
    expect(() => keysBetween(null, null, -1)).toThrow(RangeError);
    expect(() => keysBetween(null, null, 1.5)).toThrow(RangeError);
  });

  it('throws on invalid keys and a >= b', () => {
    expect(() => keysBetween('a1', 'a0', 5)).toThrow(InvalidKeyError);
    expect(() => keysBetween('bad key', null, 5)).toThrow(InvalidKeyError);
  });

  it.each([
    [null, null],
    ['a0', null],
    [null, 'a0'],
    ['a0', 'a1'],
    ['a0', 'a0V'],
  ] as const)('returns 100 strictly increasing keys between %s and %s', (a, b) => {
    const keys = keysBetween(a, b, 100);
    expect(keys).toHaveLength(100);
    for (let i = 0; i < keys.length; i++) {
      expect(isValidKey(keys[i])).toBe(true);
      if (i > 0) expect((keys[i] as string) > (keys[i - 1] as string)).toBe(true);
    }
    if (a !== null) expect((keys[0] as string) > a).toBe(true);
    if (b !== null) expect((keys[99] as string) < b).toBe(true);
  });

  it('keeps 100 evenly spread keys short', () => {
    const keys = keysBetween(null, null, 100);
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThanOrEqual(4);
  });
});

describe('property: random insert sequences', () => {
  it('sorting by key reproduces the expected list order', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 200 }), (picks) => {
        const list: { id: number; position: string }[] = [];
        picks.forEach((pick, id) => {
          const index = pick % (list.length + 1);
          const before = index > 0 ? (list[index - 1] as { position: string }).position : null;
          const after = index < list.length ? (list[index] as { position: string }).position : null;
          const position = keyBetween(before, after);
          expect(isValidKey(position)).toBe(true);
          list.splice(index, 0, { id, position });
        });
        for (let i = 1; i < list.length; i++) {
          expect(
            (list[i] as { position: string }).position >
              (list[i - 1] as { position: string }).position,
          ).toBe(true);
        }
        const shuffledThenSorted = [...list]
          .reverse()
          .sort((x, y) =>
            compareByPosition({ ...x, id: String(x.id) }, { ...y, id: String(y.id) }),
          );
        expect(shuffledThenSorted.map((x) => x.id)).toEqual(list.map((x) => x.id));
      }),
      { numRuns: 200 },
    );
  });

  it('keysBetween(n) is strictly increasing between random neighbours', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 2, maxLength: 20 }),
        fc.integer({ min: 0, max: 120 }),
        (picks, n) => {
          const list: string[] = [];
          for (const pick of picks) {
            const i = pick % (list.length + 1);
            list.splice(i, 0, keyBetween(list[i - 1] ?? null, list[i] ?? null));
          }
          const i = picks[0]! % (list.length + 1);
          const a = list[i - 1] ?? null;
          const b = list[i] ?? null;
          const keys = keysBetween(a, b, n);
          expect(keys).toHaveLength(n);
          const all = [a, ...keys, b].filter((k): k is string => k !== null);
          for (let j = 1; j < all.length; j++)
            expect((all[j] as string) > (all[j - 1] as string)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('compareByPosition', () => {
  it('orders by position then by id', () => {
    expect(compareByPosition({ position: 'a0', id: 'x' }, { position: 'a1', id: 'a' })).toBe(-1);
    expect(compareByPosition({ position: 'a1', id: 'a' }, { position: 'a0', id: 'x' })).toBe(1);
    expect(compareByPosition({ position: 'a0', id: 'a' }, { position: 'a0', id: 'b' })).toBe(-1);
    expect(compareByPosition({ position: 'a0', id: 'b' }, { position: 'a0', id: 'a' })).toBe(1);
    expect(compareByPosition({ position: 'a0', id: 'a' }, { position: 'a0', id: 'a' })).toBe(0);
  });

  it('uses code-unit order, so upper case sorts before lower case', () => {
    expect(compareByPosition({ position: 'aZ', id: '1' }, { position: 'aa', id: '1' })).toBe(-1);
  });
});

describe('key growth (numbers recorded in ADR 0001)', () => {
  it('appending 10,000 keys at the end stays short', () => {
    let key = keyBetween(null, null);
    let max = key.length;
    for (let i = 0; i < 10_000; i++) {
      key = keyBetween(key, null);
      max = Math.max(max, key.length);
    }
    expect(max).toBeLessThanOrEqual(MAX_KEY_LENGTH);
    expect(key.length).toBe(4);
  });

  it('inserting 10,000 keys at the same position grows, and needsRebalance flags it', () => {
    const lower = keyBetween(null, null);
    let upper = keyBetween(lower, null);
    let first = 0;
    for (let i = 1; i <= 10_000; i++) {
      upper = keyBetween(lower, upper);
      if (first === 0 && needsRebalance(upper)) first = i;
    }
    expect(isValidKey(upper)).toBe(true);
    expect(upper.length).toBe(1669);
    expect(first).toBe(289);
    expect(first).toBeGreaterThan(0);
    expect(needsRebalance('a0')).toBe(false);
  });
});
