import type { ReadyResponse } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';

/** Returns whether the database answers a trivial query. */
export async function checkDatabase(prisma: PrismaClient | undefined): Promise<ReadyResponse> {
  try {
    if (!prisma) throw new Error('database not configured');
    await prisma.$queryRaw`SELECT 1`;
    return { db: 'ok' };
  } catch {
    return { db: 'unavailable' };
  }
}
