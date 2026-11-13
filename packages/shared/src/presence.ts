import { z } from 'zod';

/** Colours for people on a board; each is readable as a border/background with dark text. */
export const PRESENCE_COLORS = [
  '#f4a6a6',
  '#f6c98f',
  '#e8dc83',
  '#a8dba0',
  '#8fd6d0',
  '#9ec5f0',
  '#c1b0f0',
  '#efa8d8',
] as const;

/** A stable colour per person: the same user gets the same colour in every tab and for everyone. */
export function presenceColorOf(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length] as string;
}

/** Largest number of awareness states one connection may own (one per open tab/editor). */
export const MAX_AWARENESS_STATES_PER_CONNECTION = 4;

/**
 * The awareness state of one client (R1), in both the board room and the card description room.
 * `userId`, `name` and `color` are overwritten by the server from the session. `caret` is a Yjs
 * relative position in JSON form (`Y.relativePositionToJSON`), used only in the card room.
 */
export const awarenessStateSchema = z.object({
  userId: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  activeCardId: z.uuid().nullable(),
  editing: z.boolean(),
  caret: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type AwarenessState = z.infer<typeof awarenessStateSchema>;
