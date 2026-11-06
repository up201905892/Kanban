import { keyBetween, keysBetween, needsRebalance } from '@kanban/shared';

export interface Sibling {
  id: string;
  position: string;
}

/**
 * The key for an item placed after `afterId` and/or before `beforeId` among `siblings` (already
 * ordered, without the item itself). Follows ADR 0001 section 3: stale or unknown neighbours fall
 * back to the one that still exists, and with none the item goes to the end.
 */
export function keyForPlacement(
  siblings: readonly Sibling[],
  afterId: string | null | undefined,
  beforeId: string | null | undefined,
): string {
  const afterIndex = afterId ? siblings.findIndex((s) => s.id === afterId) : -1;
  const beforeIndex = beforeId ? siblings.findIndex((s) => s.id === beforeId) : -1;
  const after = siblings[afterIndex];
  const before = siblings[beforeIndex];

  if (after && before && after.position < before.position) {
    return keyBetween(after.position, before.position);
  }
  if (after) {
    const next = siblings[afterIndex + 1];
    return keyBetween(
      after.position,
      next && next.position > after.position ? next.position : null,
    );
  }
  if (before) {
    const previous = siblings[beforeIndex - 1];
    return keyBetween(
      previous && previous.position < before.position ? previous.position : null,
      before.position,
    );
  }
  const last = siblings[siblings.length - 1];
  return keyBetween(last ? last.position : null, null);
}

/**
 * Like `keyForPlacement`, but when the key outgrows the limit it first respaces every sibling
 * (ADR 0001 section 4). `respace` persists the new keys; it is called at most once.
 */
export async function placeWithRebalance(
  siblings: Sibling[],
  afterId: string | null | undefined,
  beforeId: string | null | undefined,
  respace: (updates: Sibling[]) => Promise<void>,
): Promise<string> {
  const key = keyForPlacement(siblings, afterId, beforeId);
  if (!needsRebalance(key)) return key;
  const keys = keysBetween(null, null, siblings.length);
  const respaced = siblings.map((s, i) => ({ id: s.id, position: keys[i] as string }));
  await respace(respaced);
  return keyForPlacement(respaced, afterId, beforeId);
}
