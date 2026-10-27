/** Builds the id / aria wiring shared by TextField, TextArea and Select. */
export function fieldIds(id: string, hint?: string, error?: string) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return { hintId, errorId, describedBy };
}
