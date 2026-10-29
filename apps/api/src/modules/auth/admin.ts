import { randomBytes } from 'node:crypto';
import { emailSchema } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { hashPassword } from './password.js';

/**
 * Operator password reset (D6, no email in v1.0): sets a random temporary password and
 * deletes every session of the user. Returns the temporary password, or null when the
 * email is unknown. The caller prints it once.
 */
export async function resetPassword(prisma: PrismaClient, email: string): Promise<string | null> {
  const normalized = emailSchema.parse(email);
  const user = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
  if (!user) return null;
  const temporaryPassword = randomBytes(18).toString('base64url');
  const passwordHash = await hashPassword(temporaryPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  return temporaryPassword;
}
