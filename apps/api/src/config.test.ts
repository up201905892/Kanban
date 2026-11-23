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

describe('production settings (KB-031)', () => {
  const production = { ...valid, NODE_ENV: 'production' };

  it('rejects a production WEB_ORIGIN that is not https (Secure cookies)', () => {
    expect(problems({ ...production, WEB_ORIGIN: 'http://kanban.example.com' })).toContain(
      'WEB_ORIGIN: must be an https URL in production',
    );
    expect(problems({ ...production, WEB_ORIGIN: 'http://10.0.0.5:8080' })).toContain('WEB_ORIGIN');
  });

  it('accepts https, and http only on loopback (to try the image locally)', () => {
    expect(() =>
      loadConfig({ ...production, WEB_ORIGIN: 'https://kanban.example.com' }),
    ).not.toThrow();
    expect(() => loadConfig({ ...production, WEB_ORIGIN: 'http://localhost:8080' })).not.toThrow();
    expect(() => loadConfig({ ...production, WEB_ORIGIN: 'http://127.0.0.1:8080' })).not.toThrow();
  });

  it('does not require https outside production', () => {
    expect(() => loadConfig({ ...valid, WEB_ORIGIN: 'http://kanban.example.com' })).not.toThrow();
  });
});

describe('TRUST_PROXY', () => {
  it('defaults to off (0)', () => {
    expect(loadConfig(valid).TRUST_PROXY).toBe(0);
    expect(loadConfig({ ...valid, TRUST_PROXY: '' }).TRUST_PROXY).toBe(0);
  });

  it('accepts a non-negative integer hop count', () => {
    expect(loadConfig({ ...valid, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadConfig({ ...valid, TRUST_PROXY: '0' }).TRUST_PROXY).toBe(0);
    expect(loadConfig({ ...valid, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
  });

  it.each(['-1', '1.5', 'true', 'abc', ' 1', '1e1', '99'])('rejects %j', (value) => {
    expect(problems({ ...valid, TRUST_PROXY: value })).toContain('TRUST_PROXY');
  });
});

describe('WEB_DIST_DIR', () => {
  it('is optional', () => {
    expect(loadConfig(valid).WEB_DIST_DIR).toBeUndefined();
    expect(loadConfig({ ...valid, WEB_DIST_DIR: '/app/web' }).WEB_DIST_DIR).toBe('/app/web');
  });
});
