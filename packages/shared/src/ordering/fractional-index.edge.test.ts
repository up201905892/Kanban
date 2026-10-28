import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isValidKey, keyBetween, keysBetween } from './index.js';

describe('edge cases added by the tester', () => {
  it('prepending 10,000 times keeps keys valid, strictly decreasing and short', () => {
    let key = keyBetween(null, null);
    for (let i = 0; i < 10_000; i++) {
      const next = keyBetween(null, key);
      expect(isValidKey(next)).toBe(true);
      expect(next < key).toBe(true);
      key = next;
    }
    expect(key.length).toBeLessThanOrEqual(6);
  });

  it('inserting at random gaps after random deletions stays ordered', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(), fc.boolean()), { minLength: 1, maxLength: 300 }),
        (ops) => {
          const list: string[] = [];
          for (const [pick, del] of ops) {
            if (del && list.length > 0) {
              list.splice(pick % list.length, 1);
              continue;
            }
            const i = pick % (list.length + 1);
            const k = keyBetween(list[i - 1] ?? null, list[i] ?? null);
            expect(isValidKey(k)).toBe(true);
            list.splice(i, 0, k);
          }
          for (let j = 1; j < list.length; j++) expect(list[j]! > list[j - 1]!).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('keysBetween with a fractional lower and upper bound stays within bounds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 150 }), (n) => {
        const a = keyBetween('a0', 'a1');
        const keys = keysBetween(a, 'a1', n);
        const all = [a, ...keys, 'a1'];
        for (let j = 1; j < all.length; j++) expect(all[j]! > all[j - 1]!).toBe(true);
      }),
    );
  });
});
