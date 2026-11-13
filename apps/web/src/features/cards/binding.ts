import type * as Y from 'yjs';

/** Origin of the changes this textarea makes to the document, so its own observer skips them. */
export const LOCAL_ORIGIN = Symbol('textarea');

/**
 * Turns a change of the textarea value into the smallest delete and insert on the `Y.Text`
 * (common prefix and suffix are kept). Concurrent edits elsewhere in the text then merge by CRDT.
 */
export function applyTextChange(text: Y.Text, next: string): void {
  const prev = text.toString();
  if (prev === next) return;
  let start = 0;
  const shortest = Math.min(prev.length, next.length);
  while (start < shortest && prev[start] === next[start]) start += 1;
  let end = 0;
  while (end < shortest - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) {
    end += 1;
  }
  const removed = prev.length - start - end;
  const inserted = next.slice(start, next.length - end);
  text.doc?.transact(() => {
    if (removed > 0) text.delete(start, removed);
    if (inserted.length > 0) text.insert(start, inserted);
  }, LOCAL_ORIGIN);
}

interface DeltaOp {
  insert?: string | object;
  delete?: number;
  retain?: number;
}

/**
 * Where a caret at `position` (before the change) is after a remote change described by `delta`:
 * text inserted before the caret pushes it, text deleted before it pulls it back.
 */
export function transformPosition(delta: readonly DeltaOp[], position: number): number {
  let index = 0;
  let shift = 0;
  for (const op of delta) {
    if (op.retain !== undefined) {
      index += op.retain;
    } else if (typeof op.insert === 'string') {
      if (index < position) shift += op.insert.length;
    } else if (op.delete !== undefined) {
      if (index < position) shift -= Math.min(op.delete, position - index);
      index += op.delete;
    }
    if (index >= position && op.insert === undefined) break;
  }
  return Math.max(0, position + shift);
}
