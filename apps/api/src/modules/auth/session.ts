import type { PrismaClient } from '../../db.js';
import {
  SESSION_COOKIE_NAME,
  generateToken,
  hashToken,
  isExpired,
  readCookie,
  sessionExpiry,
  shouldRenew,
} from './tokens.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export interface AuthSession {
  id: string;
  expiresAt: Date;
  /** True when the sliding expiry was extended by this lookup (the cookie should be re-sent). */
  renewed: boolean;
}

export interface SessionResult {
  user: AuthUser;
  session: AuthSession;
}

/** Creates a session and returns the raw token (shown once, to put in the cookie). */
export async function createSession(
  prisma: Pick<PrismaClient, 'session'>,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = sessionExpiry(now);
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, lastUsedAt: now },
  });
  return { token, expiresAt };
}

/** Looks a token up. Expired sessions are deleted and rejected; live ones are renewed at most daily. */
export async function validateSessionToken(
  prisma: PrismaClient,
  token: string,
  now: Date = new Date(),
): Promise<SessionResult | null> {
  const row = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true, createdAt: true } } },
  });
  if (!row) return null;
  if (isExpired(row.expiresAt, now)) {
    await prisma.session.deleteMany({ where: { id: row.id } });
    return null;
  }
  let expiresAt = row.expiresAt;
  let renewed = false;
  if (shouldRenew(row.lastUsedAt, now)) {
    expiresAt = sessionExpiry(now);
    await prisma.session.update({
      where: { id: row.id },
      data: { lastUsedAt: now, expiresAt },
    });
    renewed = true;
  }
  return { user: row.user, session: { id: row.id, expiresAt, renewed } };
}

/**
 * Resolves the session from a raw `Cookie` header. Shared by the HTTP hook and by the
 * WebSocket upgrade (KB-016), so both authenticate in exactly the same way.
 */
export async function getSessionFromCookieHeader(
  prisma: PrismaClient,
  cookieHeader: string | undefined,
  now: Date = new Date(),
): Promise<SessionResult | null> {
  const token = readCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!token) return null;
  return validateSessionToken(prisma, token, now);
}

export async function deleteSession(prisma: PrismaClient, sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}
