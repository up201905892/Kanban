import { activityEventDataSchema, type ActivityEventData } from '@kanban/shared';
import type { Tx } from '../boards/lock.js';

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
