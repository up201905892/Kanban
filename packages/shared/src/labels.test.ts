import { describe, expect, it } from 'vitest';
import {
  CARD_LABELS_MAX,
  LABEL_COLORS,
  LABEL_NAME_MAX_LENGTH,
  createLabelRequestSchema,
  diffLabelIds,
  labelColorSchema,
  labelNameKey,
  setCardLabelsRequestSchema,
  updateLabelRequestSchema,
} from './labels.js';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('label palette', () => {
  it('has exactly 8 tokens', () => {
    expect(LABEL_COLORS).toHaveLength(8);
  });

  it.each(LABEL_COLORS)('accepts %s', (color) => {
    expect(labelColorSchema.safeParse(color).success).toBe(true);
  });

  it.each(['', 'Red', '#ff0000', 'pink', 'rgb(0,0,0)'])('rejects %j', (color) => {
    expect(labelColorSchema.safeParse(color).success).toBe(false);
  });
});

describe('label names', () => {
  it('trims and enforces 1 to 30 characters', () => {
    expect(createLabelRequestSchema.parse({ name: '  Bug ', color: 'red' }).name).toBe('Bug');
    expect(createLabelRequestSchema.safeParse({ name: '   ', color: 'red' }).success).toBe(false);
    const max = 'a'.repeat(LABEL_NAME_MAX_LENGTH);
    expect(createLabelRequestSchema.safeParse({ name: max, color: 'red' }).success).toBe(true);
    expect(createLabelRequestSchema.safeParse({ name: `${max}a`, color: 'red' }).success).toBe(
      false,
    );
  });

  it('rejects unknown fields and an invalid colour', () => {
    expect(createLabelRequestSchema.safeParse({ name: 'x', color: 'red', extra: 1 }).success).toBe(
      false,
    );
    expect(createLabelRequestSchema.safeParse({ name: 'x', color: 'pink' }).success).toBe(false);
  });

  it('compares names without regard to case or surrounding spaces', () => {
    expect(labelNameKey(' Bug ')).toBe(labelNameKey('bUG'));
  });

  it('needs at least one field to update', () => {
    expect(updateLabelRequestSchema.safeParse({}).success).toBe(false);
    expect(updateLabelRequestSchema.safeParse({ color: 'blue' }).success).toBe(true);
  });
});

describe('setCardLabelsRequestSchema', () => {
  it('accepts an empty list and up to 10 ids', () => {
    expect(setCardLabelsRequestSchema.safeParse({ labelIds: [] }).success).toBe(true);
    const ids = Array.from({ length: CARD_LABELS_MAX }, (_, i) => id(i + 1));
    expect(setCardLabelsRequestSchema.safeParse({ labelIds: ids }).success).toBe(true);
  });

  it('rejects 11 ids, duplicates and non-uuids', () => {
    const ids = Array.from({ length: CARD_LABELS_MAX + 1 }, (_, i) => id(i + 1));
    expect(setCardLabelsRequestSchema.safeParse({ labelIds: ids }).success).toBe(false);
    expect(setCardLabelsRequestSchema.safeParse({ labelIds: [id(1), id(1)] }).success).toBe(false);
    expect(setCardLabelsRequestSchema.safeParse({ labelIds: ['nope'] }).success).toBe(false);
  });
});

describe('diffLabelIds', () => {
  it('lists what to add and remove', () => {
    expect(diffLabelIds(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
  });

  it('is empty for the same set in another order', () => {
    expect(diffLabelIds(['a', 'b'], ['b', 'a'])).toEqual({ added: [], removed: [] });
  });
});
