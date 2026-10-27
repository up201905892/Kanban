import { describe, expect, it } from 'vitest';
import { ErrorCode, apiErrorSchema } from './errors.js';

describe('apiErrorSchema', () => {
  it('accepts an error with a known code', () => {
    expect(
      apiErrorSchema.safeParse({ error: { code: ErrorCode.NOT_FOUND, message: 'x' } }).success,
    ).toBe(true);
  });

  it('accepts validation details', () => {
    const r = apiErrorSchema.safeParse({
      error: { code: 'VALIDATION_ERROR', message: 'x', details: [{ path: 'a', message: 'b' }] },
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown codes and missing messages', () => {
    expect(apiErrorSchema.safeParse({ error: { code: 'nope', message: 'x' } }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ error: { code: 'NOT_FOUND' } }).success).toBe(false);
  });

  it('uses UPPER_SNAKE_CASE codes', () => {
    for (const code of Object.values(ErrorCode)) expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
  });
});
