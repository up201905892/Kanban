/**
 * Ids of the mutations this tab sent recently. Every state-changing request carries one in the
 * `X-Client-Mutation-Id` header and the server copies it into the board events it causes, so the
 * tab can recognise (and skip) the echo of its own changes (KB-018).
 */
const MAX_REMEMBERED = 200;
const own = new Set<string>();

/** A fresh id, remembered as ours. */
export function newMutationId(): string {
  const id = crypto.randomUUID();
  own.add(id);
  // Sets iterate in insertion order: forget the oldest.
  if (own.size > MAX_REMEMBERED) {
    const oldest = own.values().next().value;
    if (oldest !== undefined) own.delete(oldest);
  }
  return id;
}

export const isOwnMutation = (id: string | undefined): boolean => id !== undefined && own.has(id);

/** Test helper. */
export function forgetMutationIds(): void {
  own.clear();
}
