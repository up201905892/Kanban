import { describe, expect, it } from 'vitest';
import { PRESENCE_COLORS, awarenessStateSchema, presenceColorOf } from './presence.js';

const base = {
  userId: 'u1',
  name: 'Ana',
  color: '#aabbcc',
  activeCardId: null,
  editing: false,
};

describe('awarenessStateSchema', () => {
  it('accepts a state with and without a caret', () => {
    expect(awarenessStateSchema.safeParse(base).success).toBe(true);
    expect(
      awarenessStateSchema.safeParse({
        ...base,
        activeCardId: '8c0e3f4e-4b0a-4a53-9a39-0f5d0c4e8a11',
        editing: true,
        caret: { type: null, tname: 'description', item: null, assoc: 0 },
      }).success,
    ).toBe(true);
  });

  it('rejects wrong types and bad colours', () => {
    expect(awarenessStateSchema.safeParse({ ...base, editing: 'yes' }).success).toBe(false);
    expect(awarenessStateSchema.safeParse({ ...base, color: 'red' }).success).toBe(false);
    expect(awarenessStateSchema.safeParse({ ...base, activeCardId: 'not-a-uuid' }).success).toBe(
      false,
    );
    expect(awarenessStateSchema.safeParse({ name: 'x' }).success).toBe(false);
  });
});

describe('presenceColorOf', () => {
  it('is stable and comes from the palette', () => {
    expect(presenceColorOf('abc')).toBe(presenceColorOf('abc'));
    expect(PRESENCE_COLORS).toContain(presenceColorOf('another-user'));
  });
});
