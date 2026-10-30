import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'kanban_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A session is renewed (expiry pushed out) at most once per this interval. */
export const SESSION_RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 32 random bytes, base64url-encoded (43 characters). Only its hash is stored. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 of the token, hex-encoded. The token has 256 bits of entropy, so no salt is needed. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const sessionExpiry = (now: Date): Date => new Date(now.getTime() + SESSION_TTL_MS);

export const isExpired = (expiresAt: Date, now: Date): boolean =>
  expiresAt.getTime() <= now.getTime();

/** Sliding expiry: renew when the session was last renewed at least a day ago. */
export const shouldRenew = (lastUsedAt: Date, now: Date): boolean =>
  now.getTime() - lastUsedAt.getTime() >= SESSION_RENEW_INTERVAL_MS;

export interface CookieOptions {
  httpOnly: true;
  sameSite: 'Lax';
  path: '/';
  secure: boolean;
}

export const sessionCookieOptions = (nodeEnv: string | undefined): CookieOptions => ({
  httpOnly: true,
  sameSite: 'Lax',
  path: '/',
  secure: nodeEnv === 'production',
});

/** Serialises a `Set-Cookie` value. Tokens are base64url, so no encoding is needed. */
export function serializeSessionCookie(
  token: string,
  expiresAt: Date,
  nodeEnv: string | undefined,
): string {
  const o = sessionCookieOptions(nodeEnv);
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    `Path=${o.path}`,
    `Expires=${expiresAt.toUTCString()}`,
    'HttpOnly',
    `SameSite=${o.sameSite}`,
    ...(o.secure ? ['Secure'] : []),
  ].join('; ');
}

export function serializeClearedSessionCookie(nodeEnv: string | undefined): string {
  const o = sessionCookieOptions(nodeEnv);
  return [
    `${SESSION_COOKIE_NAME}=`,
    `Path=${o.path}`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    `SameSite=${o.sameSite}`,
    ...(o.secure ? ['Secure'] : []),
  ].join('; ');
}

/** Extracts one cookie value from a `Cookie` request header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
