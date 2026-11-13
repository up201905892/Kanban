import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import {
  MAX_AWARENESS_STATES_PER_CONNECTION,
  awarenessStateSchema,
  presenceColorOf,
} from '@kanban/shared';

/** Who is sending an awareness update, and which awareness states already exist in the room. */
export interface AwarenessSender {
  userId: string;
  name: string;
  /** Awareness client IDs this connection already controls. */
  ownIds: ReadonlySet<number>;
  /** Client IDs that currently have a state in the room. */
  existingIds: ReadonlySet<number>;
}

/**
 * Rewrites a client's awareness update before it is applied (R1, no identity spoofing):
 * - every state is validated against `awarenessStateSchema`; invalid ones are dropped;
 * - `userId`, `name` and `color` are replaced with the session's values;
 * - a client can only create states with new IDs, update or remove its own, never those of someone
 *   else, and cannot own more than `MAX_AWARENESS_STATES_PER_CONNECTION` states.
 * Returns `null` when nothing is left to apply. Throws on bytes that are not an awareness update.
 */
export function sanitizeAwarenessUpdate(
  update: Uint8Array,
  sender: AwarenessSender,
): Uint8Array | null {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const kept: { clientId: number; clock: number; state: string }[] = [];
  let owned = sender.ownIds.size;
  for (let i = 0; i < count; i += 1) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const raw = decoding.readVarString(decoder);
    const own = sender.ownIds.has(clientId);
    if (!own && sender.existingIds.has(clientId)) continue; // someone else's state
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null) {
      // Removing the state is allowed for the client's own states only.
      if (own) kept.push({ clientId, clock, state: 'null' });
      continue;
    }
    const result = awarenessStateSchema.safeParse(parsed);
    if (!result.success) continue;
    if (!own) {
      if (owned >= MAX_AWARENESS_STATES_PER_CONNECTION) continue;
      owned += 1;
    }
    kept.push({
      clientId,
      clock,
      state: JSON.stringify({
        ...result.data,
        userId: sender.userId,
        name: sender.name,
        color: presenceColorOf(sender.userId),
      }),
    });
  }
  if (kept.length === 0) return null;
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, kept.length);
  for (const entry of kept) {
    encoding.writeVarUint(encoder, entry.clientId);
    encoding.writeVarUint(encoder, entry.clock);
    encoding.writeVarString(encoder, entry.state);
  }
  return encoding.toUint8Array(encoder);
}
