import { describe, expect, it } from 'vitest';
import {
  createInviteRequestSchema,
  inviteLink,
  memberParamsSchema,
  updateMemberRequestSchema,
} from './invites.js';

describe('createInviteRequestSchema', () => {
  it('accepts member and viewer, with or without maxUses', () => {
    expect(createInviteRequestSchema.safeParse({ role: 'member', expiresInDays: 7 }).success).toBe(
      true,
    );
    expect(
      createInviteRequestSchema.safeParse({ role: 'viewer', expiresInDays: 30, maxUses: 5 })
        .success,
    ).toBe(true);
  });

  it('never allows an owner invite', () => {
    expect(createInviteRequestSchema.safeParse({ role: 'owner', expiresInDays: 7 }).success).toBe(
      false,
    );
  });

  it.each([0, 31, 1.5, -1, '7'])('rejects expiresInDays %s', (expiresInDays) => {
    expect(createInviteRequestSchema.safeParse({ role: 'member', expiresInDays }).success).toBe(
      false,
    );
  });

  it.each([0, -1, 1.5, 1001])('rejects maxUses %s', (maxUses) => {
    expect(
      createInviteRequestSchema.safeParse({ role: 'member', expiresInDays: 7, maxUses }).success,
    ).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(
      createInviteRequestSchema.safeParse({ role: 'member', expiresInDays: 7, uses: 5 }).success,
    ).toBe(false);
  });
});

describe('members schemas', () => {
  it('accepts any of the three roles for a role change', () => {
    for (const role of ['owner', 'member', 'viewer'])
      expect(updateMemberRequestSchema.safeParse({ role }).success).toBe(true);
    expect(updateMemberRequestSchema.safeParse({ role: 'admin' }).success).toBe(false);
  });

  it('requires UUIDs in member params', () => {
    expect(memberParamsSchema.safeParse({ wid: 'x', userId: 'y' }).success).toBe(false);
  });
});

describe('inviteLink', () => {
  it('joins origin and token without a double slash', () => {
    expect(inviteLink('http://localhost:5173/', 'abc')).toBe('http://localhost:5173/invite/abc');
    expect(inviteLink('http://localhost:5173', 'abc')).toBe('http://localhost:5173/invite/abc');
  });
});
