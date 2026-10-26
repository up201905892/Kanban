import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const valid = {
  DATABASE_URL: 'postgresql://kanban:kanban@localhost:5432/kanban',
  SESSION_SECRET: 'x'.repeat(32),
};

function problems(env: Record<string, string | undefined>): string {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as ConfigError).message;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('accepts a valid environment and applies defaults', () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({ PORT: 3000, NODE_ENV: 'development' });
    expect(config.WEB_ORIGIN).toBe('http://localhost:5173');
  });

  it('coerces PORT and accepts explicit values', () => {
    const config = loadConfig({
      ...valid,
      PORT: '4000',
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://app.example.com',
    });
    expect(config.PORT).toBe(4000);
    expect(config.NODE_ENV).toBe('production');
  });

  it('rejects a missing DATABASE_URL, naming the variable', () => {
    const message = problems({ SESSION_SECRET: valid.SESSION_SECRET });
    expect(message).toContain('DATABASE_URL');
  });

  it('rejects a short SESSION_SECRET without leaking its value', () => {
    const secret = 'short-secret-value';
    const message = problems({ ...valid, SESSION_SECRET: secret });
    expect(message).toContain('SESSION_SECRET');
    expect(message).not.toContain(secret);
  });

  it('accepts a 32-character secret and rejects 31', () => {
    expect(() => loadConfig({ ...valid, SESSION_SECRET: 'a'.repeat(32) })).not.toThrow();
    expect(problems({ ...valid, SESSION_SECRET: 'a'.repeat(31) })).toContain('SESSION_SECRET');
  });

  it('rejects an invalid PORT, WEB_ORIGIN and NODE_ENV', () => {
    expect(problems({ ...valid, PORT: 'abc' })).toContain('PORT');
    expect(problems({ ...valid, PORT: '70000' })).toContain('PORT');
    expect(problems({ ...valid, WEB_ORIGIN: 'not a url' })).toContain('WEB_ORIGIN');
    expect(problems({ ...valid, NODE_ENV: 'staging' })).toContain('NODE_ENV');
  });

  it('does not leak a non-postgres DATABASE_URL value', () => {
    const message = problems({ ...valid, DATABASE_URL: 'mysql://user:hunter2@host/db' });
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('hunter2');
  });
});
