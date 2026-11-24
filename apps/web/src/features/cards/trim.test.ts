import { describe, expect, it } from 'vitest';
import { isTrimOfOwnText } from './trim';

describe('isTrimOfOwnText', () => {
  const tail = [{ retain: 20_000 }, { delete: 5_000 }];

  it('is true for a tail deletion that leaves the limit and removed own text', () => {
    expect(isTrimOfOwnText(tail, 20_000, true)).toBe(true);
    expect(isTrimOfOwnText([{ retain: 19_999 }, { delete: 3 }], 19_999, true)).toBe(true);
  });

  it('is false when the deleted text belonged to other people', () => {
    expect(isTrimOfOwnText(tail, 20_000, false)).toBe(false);
  });

  it('is false for other changes', () => {
    expect(isTrimOfOwnText([{ retain: 10 }, { delete: 5 }], 10, true)).toBe(false);
    expect(
      isTrimOfOwnText([{ insert: 'a' }, { retain: 20_000 }, { delete: 1 }], 20_000, true),
    ).toBe(false);
    expect(isTrimOfOwnText([{ retain: 20_000 }], 20_000, true)).toBe(false);
  });
});
