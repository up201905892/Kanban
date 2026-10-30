import { describe, expect, it } from 'vitest';
import { loginRequestSchema, signupRequestSchema, userSchema } from './auth.js';

const valid = { email: 'Ana@Example.com ', name: ' Ana ', password: '1234567890' };

describe('signupRequestSchema', () => {
  it('trims and lowercases the email and trims the name', () => {
    const r = signupRequestSchema.parse(valid);
    expect(r.email).toBe('ana@example.com');
    expect(r.name).toBe('Ana');
  });

  it('enforces the password length boundaries (10 to 128)', () => {
    expect(signupRequestSchema.safeParse({ ...valid, password: 'x'.repeat(9) }).success).toBe(
      false,
    );
    expect(signupRequestSchema.safeParse({ ...valid, password: 'x'.repeat(10) }).success).toBe(
      true,
    );
    expect(signupRequestSchema.safeParse({ ...valid, password: 'x'.repeat(128) }).success).toBe(
      true,
    );
    expect(signupRequestSchema.safeParse({ ...valid, password: 'x'.repeat(129) }).success).toBe(
      false,
    );
  });

  it('rejects invalid emails, empty names and unknown fields', () => {
    expect(signupRequestSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
    expect(signupRequestSchema.safeParse({ ...valid, name: '  ' }).success).toBe(false);
    expect(signupRequestSchema.safeParse({ ...valid, role: 'admin' }).success).toBe(false);
  });
});

describe('loginRequestSchema', () => {
  it('accepts any non-empty password up to 128 characters', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x', extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('userSchema', () => {
  it('strips a password hash if one slips in', () => {
    const user = userSchema.parse({
      id: '5f0b7f0e-8a3c-4d6a-9d52-1d3c2f0a4b11',
      email: 'a@b.co',
      name: 'A',
      createdAt: new Date().toISOString(),
      passwordHash: 'secret',
    });
    expect(user).not.toHaveProperty('passwordHash');
  });
});
