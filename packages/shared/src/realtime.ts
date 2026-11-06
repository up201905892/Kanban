import { z } from 'zod';

/** Message types of the y-websocket wire protocol (first varint of every binary message). */
export const WS_MESSAGE = {
  sync: 0,
  awareness: 1,
  auth: 2,
  queryAwareness: 3,
  /** Custom: a JSON board event pushed by the server (KB-018). Clients never send it. */
  boardEvent: 4,
} as const;

/** Application close codes (the 4000 range is free for applications). */
export const WS_CLOSE = {
  /** No valid session. */
  unauthenticated: 4401,
  /** Not a member of the room's workspace, or the room does not exist (indistinguishable). */
  forbidden: 4403,
  /** The room name is not valid. */
  invalidRoom: 4400,
  /** Standard: message too big. */
  messageTooBig: 1009,
} as const;

/** Largest accepted WebSocket message, in bytes. */
export const WS_MAX_MESSAGE_BYTES = 1024 * 1024;
/** Server ping interval. */
export const WS_HEARTBEAT_MS = 30_000;

export const ROOM_TYPES = ['board', 'card-description'] as const;
export const roomTypeSchema = z.enum(ROOM_TYPES);
export type RoomType = z.infer<typeof roomTypeSchema>;

const uuidSchema = z.uuid();

export const roomRefSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('board'), id: uuidSchema }),
  z.strictObject({ type: z.literal('card-description'), id: uuidSchema }),
]);
export type RoomRef = z.infer<typeof roomRefSchema>;

/** Path parameter of `/ws/:room`. */
export const roomParamsSchema = z.strictObject({ room: z.string().min(1).max(100) });

export const roomName = (ref: RoomRef): string =>
  ref.type === 'board' ? `board:${ref.id}` : `card:${ref.id}:description`;

const BOARD_ROOM = /^board:([^:]+)$/;
const CARD_ROOM = /^card:([^:]+):description$/;

/** Parses `board:<uuid>` or `card:<uuid>:description`; anything else is `null`. */
export function parseRoomName(name: string): RoomRef | null {
  const board = BOARD_ROOM.exec(name);
  if (board?.[1] && uuidSchema.safeParse(board[1]).success) {
    return { type: 'board', id: board[1].toLowerCase() };
  }
  const card = CARD_ROOM.exec(name);
  if (card?.[1] && uuidSchema.safeParse(card[1]).success) {
    return { type: 'card-description', id: card[1].toLowerCase() };
  }
  return null;
}

/**
 * Payload of the custom board-event message (`WS_MESSAGE.boardEvent`): UTF-8 JSON after the type
 * varint and a varString. The event catalogue is defined by KB-018.
 */
export const boardEventMessageSchema = z.strictObject({
  type: z.string().min(1).max(64),
  data: z.record(z.string(), z.unknown()),
});
export type BoardEventMessage = z.infer<typeof boardEventMessageSchema>;
