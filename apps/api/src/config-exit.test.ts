import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfigOrExit } from './config.js';

describe('loadConfigOrExit', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints the problems (without values) and exits with code 1 on invalid configuration', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      loadConfigOrExit({ DATABASE_URL: 'mysql://u:hunter2@h/d', SESSION_SECRET: 'short-value' }),
    ).toThrow('process.exit called');

    expect(exit).toHaveBeenCalledWith(1);
    const output = error.mock.calls.flat().join('\n');
    expect(output).toContain('DATABASE_URL');
    expect(output).toContain('SESSION_SECRET');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('short-value');
  });

  it('returns the config and does not exit when valid', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const config = loadConfigOrExit({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      SESSION_SECRET: 'x'.repeat(32),
    });
    expect(config.PORT).toBe(3000);
    expect(exit).not.toHaveBeenCalled();
  });
});
