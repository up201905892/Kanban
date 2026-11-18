import type { PrismaClient } from '../../db.js';

/**
 * Returns the ids (among `sessionIds`) that no longer exist or have expired. One query for all ids,
 * however many sockets are open; each distinct id is looked up once.
 */
export async function findEndedSessions(
  prisma: Pick<PrismaClient, 'session'>,
  sessionIds: Iterable<string>,
  now: Date = new Date(),
): Promise<Set<string>> {
  const ids = [...new Set(sessionIds)];
  if (ids.length === 0) return new Set();
  const live = await prisma.session.findMany({
    where: { id: { in: ids }, expiresAt: { gt: now } },
    select: { id: true },
  });
  const liveIds = new Set(live.map((s) => s.id));
  return new Set(ids.filter((id) => !liveIds.has(id)));
}
