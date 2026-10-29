import { ErrorCode, type LoginRequest, type SignupRequest } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password.js';
import { createSession, type AuthUser } from './session.js';

export interface AuthResult {
  user: AuthUser;
  token: string;
  expiresAt: Date;
}

const publicUser = { id: true, email: true, name: true, createdAt: true } as const;

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';

export const emailTaken = (): AppError =>
  new AppError(409, ErrorCode.EMAIL_TAKEN, 'An account with this email already exists');

export const invalidCredentials = (): AppError =>
  new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');

export async function signup(prisma: PrismaClient, input: SignupRequest): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.user.create({
      data: { email: input.email, name: input.name, passwordHash },
      select: publicUser,
    });
    const { token, expiresAt } = await createSession(prisma, user.id);
    return { user, token, expiresAt };
  } catch (err) {
    // The unique index is the source of truth, so concurrent signups cannot both succeed.
    if (isUniqueViolation(err)) throw emailTaken();
    throw err;
  }
}

export async function login(prisma: PrismaClient, input: LoginRequest): Promise<AuthResult> {
  const row = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...publicUser, passwordHash: true },
  });
  if (!row) {
    await verifyAgainstDummy(input.password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(row.passwordHash, input.password))) throw invalidCredentials();
  const user: AuthUser = { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt };
  const { token, expiresAt } = await createSession(prisma, user.id);
  return { user, token, expiresAt };
}
