import { describe, expect, it } from 'vitest';
import { normalizeArgs } from './e2e-args.mjs';

describe('normalizeArgs', () => {
  it('returns no arguments unchanged', () => {
    expect(normalizeArgs([])).toEqual([]);
  });
  it('keeps arguments typed without a leading --', () => {
    expect(normalizeArgs(['e2e/a.spec.ts', '--list'])).toEqual(['e2e/a.spec.ts', '--list']);
  });
  it('drops one leading --', () => {
    expect(normalizeArgs(['--', 'e2e/a.spec.ts', '--repeat-each=2'])).toEqual([
      'e2e/a.spec.ts',
      '--repeat-each=2',
    ]);
  });
  it('drops only the first --', () => {
    expect(normalizeArgs(['--', '--', 'x'])).toEqual(['--', 'x']);
  });
});
