import { CARD_DESCRIPTION_MAX_LENGTH } from '@kanban/shared';

export const TRIM_ANNOUNCEMENT =
  'The description reached the 20,000 character limit; the end was removed.';

interface DeltaOp {
  insert?: unknown;
  delete?: number;
  retain?: number;
}

/**
 * True when a remote change looks like the server trim of KB-040 and it removed text this client
 * inserted: it only deletes from the end, leaves the text at the limit (one character less when the
 * cut avoided splitting a surrogate pair) and the deleted items include some of this client's.
 * An ordinary remote deletion that happens to end exactly there is indistinguishable and is
 * announced too; that is rare and harmless.
 */
export function isTrimOfOwnText(
  delta: readonly DeltaOp[],
  newLength: number,
  deletedOwnText: boolean,
): boolean {
  if (!deletedOwnText) return false;
  if (newLength > CARD_DESCRIPTION_MAX_LENGTH || newLength < CARD_DESCRIPTION_MAX_LENGTH - 1) {
    return false;
  }
  if (delta.some((op) => op.insert !== undefined)) return false;
  const last = delta[delta.length - 1];
  if (!last || typeof last.delete !== 'number') return false;
  // Everything before the final delete is a plain retain (or nothing, for a text cut to zero).
  return delta.slice(0, -1).every((op) => typeof op.retain === 'number' && op.delete === undefined);
}
