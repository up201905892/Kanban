export interface InviteState {
  expiresAt: Date;
  revokedAt: Date | null;
  maxUses: number | null;
  uses: number;
}

export type InviteStatus = 'valid' | 'revoked' | 'expired' | 'exhausted';

/** Why an invite can or cannot be used right now. Revocation wins over expiry, expiry over use. */
export function inviteStatus(invite: InviteState, now: Date): InviteStatus {
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return 'exhausted';
  return 'valid';
}

export const isInviteValid = (invite: InviteState, now: Date): boolean =>
  inviteStatus(invite, now) === 'valid';
