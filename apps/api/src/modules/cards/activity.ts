import {
  ErrorCode,
  activityEntrySchema,
  activityEventDataSchema,
  type ActivityEntry,
  type ActivityEventData,
  type ActivityListQuery,
  type ActivityListResponse,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError, notFound } from '../../lib/app-error.js';
import { authorize } from '../authz/index.js';
import type { Tx } from '../boards/lock.js';

/** `createdAt|id`, the position after which the next (older) page starts. */
const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [date, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = date === undefined ? new Date(NaN) : new Date(date);
  if (Number.isNaN(createdAt.getTime()) || id === undefined || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'The cursor is not valid');
  }
  return { createdAt, id };
}

/** Newest first, stable under ties on `createdAt` (ordered by `(createdAt, id)` descending). */
export async function listCardActivity(
  prisma: PrismaClient,
  user: { id: string },
  cardId: string,
  query: ActivityListQuery,
): Promise<ActivityListResponse> {
  await authorize(prisma, user, { type: 'card', id: cardId }, 'workspace:read');
  const card = await prisma.card.findFirst({ where: { id: cardId, deletedAt: null } });
  if (!card) throw notFound();
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  const rows = await prisma.activityEvent.findMany({
    where: {
      cardId,
      ...(after && {
        OR: [
          { createdAt: { lt: after.createdAt } },
          { createdAt: after.createdAt, id: { lt: after.id } },
        ],
      }),
    },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });
  const pageRows = rows.slice(0, query.limit);
  const events: ActivityEntry[] = pageRows.map((row) =>
    activityEntrySchema.parse({
      id: row.id,
      cardId: row.cardId,
      actorId: row.actorId,
      createdAt: row.createdAt.toISOString(),
      type: row.type,
      data: row.data,
      actor: row.actor,
    }),
  );
  const last = pageRows.at(-1);
  return {
    events,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/**
 * Writes one activity event inside the caller's transaction (G5), so the history can never disagree
 * with the change. The payload is validated against the shared discriminated union first.
 */
export async function recordActivity(
  tx: Pick<Tx, 'activityEvent'>,
  cardId: string,
  actorId: string,
  event: ActivityEventData,
): Promise<void> {
  const parsed = activityEventDataSchema.parse(event);
  await tx.activityEvent.create({
    data: { cardId, actorId, type: parsed.type, data: parsed.data },
  });
}
