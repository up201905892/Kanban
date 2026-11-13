import * as Y from 'yjs';

/**
 * A caret shared as a Yjs relative position: it points at a character rather than an index, so it
 * stays on that character while other people insert or delete text around it.
 */
export function caretToJSON(text: Y.Text, index: number): Record<string, unknown> {
  return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, index)) as Record<
    string,
    unknown
  >;
}

/** The current index of a shared caret in `text`, or `null` when it no longer resolves. */
export function resolveCaret(text: Y.Text, caret: unknown): number | null {
  if (typeof caret !== 'object' || caret === null) return null;
  const doc = text.doc;
  if (!doc) return null;
  try {
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(caret),
      doc,
    );
    if (!absolute || absolute.type !== text) return null;
    return Math.min(absolute.index, text.length);
  } catch {
    return null;
  }
}
