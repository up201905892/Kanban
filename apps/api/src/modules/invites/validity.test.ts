import { describe, expect, it } from 'vitest';
import { inviteStatus, isInviteValid, type InviteState } from './validity.js';

const now = new Date('2026-11-02T12:00:00.000Z');
const base: InviteState = {
  expiresAt: new Date('2026-11-09T12:00:00.000Z'),
  revokedAt: null,
  maxUses: null,
  uses: 0,
};

describe('inviteStatus', () => {
  it('is valid before expiry, not revoked and with uses left', () => {
    expect(inviteStatus(base, now)).toBe('valid');
    expect(inviteStatus({ ...base, maxUses: 2, uses: 1 }, now)).toBe('valid');
    expect(isInviteValid(base, now)).toBe(true);
  });

  it('is expired at and after the expiry instant', () => {
    expect(inviteStatus({ ...base, expiresAt: now }, now)).toBe('expired');
    expect(inviteStatus({ ...base, expiresAt: new Date(now.getTime() - 1) }, now)).toBe('expired');
    expect(inviteStatus({ ...base, expiresAt: new Date(now.getTime() + 1) }, now)).toBe('valid');
  });

  it('is revoked when revokedAt is set, even if otherwise valid', () => {
    expect(inviteStatus({ ...base, revokedAt: new Date(now) }, now)).toBe('revoked');
    expect(isInviteValid({ ...base, revokedAt: new Date(now) }, now)).toBe(false);
  });

  it('is exhausted when uses reach maxUses', () => {
    expect(inviteStatus({ ...base, maxUses: 1, uses: 1 }, now)).toBe('exhausted');
    expect(inviteStatus({ ...base, maxUses: 3, uses: 5 }, now)).toBe('exhausted');
  });

  it('never exhausts when maxUses is null', () => {
    expect(inviteStatus({ ...base, uses: 100000 }, now)).toBe('valid');
  });
});
