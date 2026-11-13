import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WS_MESSAGE, presenceColorOf } from '@kanban/shared';

/** A valid awareness state of someone else, as the server would relay it. */
export const remoteState = (
  userId: string,
  name: string,
  extra: { activeCardId?: string | null; editing?: boolean; caret?: object | null } = {},
) => ({
  userId,
  name,
  color: presenceColorOf(userId),
  activeCardId: extra.activeCardId ?? null,
  editing: extra.editing ?? false,
  caret: extra.caret ?? null,
});

/** The wire frame the server sends for awareness: type 1, then the update as a byte array. */
export function awarenessFrame(
  entries: { clientId: number; state: object | null; clock?: number }[],
): ArrayBuffer {
  const inner = encoding.createEncoder();
  encoding.writeVarUint(inner, entries.length);
  for (const entry of entries) {
    encoding.writeVarUint(inner, entry.clientId);
    encoding.writeVarUint(inner, entry.clock ?? 1);
    encoding.writeVarString(inner, JSON.stringify(entry.state));
  }
  const frame = encoding.createEncoder();
  encoding.writeVarUint(frame, WS_MESSAGE.awareness);
  encoding.writeVarUint8Array(frame, encoding.toUint8Array(inner));
  const bytes = encoding.toUint8Array(frame);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** The awareness states a client sent over a fake socket, last state per client ID. */
export function sentAwareness(sent: Uint8Array[]): Map<number, unknown> {
  const states = new Map<number, unknown>();
  for (const message of sent) {
    const decoder = decoding.createDecoder(message);
    if (decoding.readVarUint(decoder) !== WS_MESSAGE.awareness) continue;
    const update = decoding.createDecoder(decoding.readVarUint8Array(decoder));
    const count = decoding.readVarUint(update);
    for (let i = 0; i < count; i += 1) {
      const clientId = decoding.readVarUint(update);
      decoding.readVarUint(update);
      states.set(clientId, JSON.parse(decoding.readVarString(update)));
    }
  }
  return states;
}
