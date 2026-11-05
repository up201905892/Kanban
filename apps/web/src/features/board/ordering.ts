import {
  compareByPosition,
  keyBetween,
  type BoardResponse,
  type Column,
  type UpdateColumnRequest,
} from '@kanban/shared';

/** Columns in display order (the API already sorts them; this keeps optimistic edits sorted). */
export const sortColumns = (columns: readonly Column[]): Column[] =>
  [...columns].sort(compareByPosition);

/** A local key between two neighbours, used only until the server's final key arrives. */
function hintKey(previous: string | undefined, next: string | undefined): string | null {
  try {
    return keyBetween(previous ?? null, next ?? null);
  } catch {
    return null;
  }
}

/**
 * Places column `id` after/before the named neighbours, mirroring what the server will do (ADR 0001
 * section 3), so the optimistic UI shows the move at once.
 */
export function placeColumn(
  columns: readonly Column[],
  id: string,
  afterId: string | null | undefined,
  beforeId: string | null | undefined,
): Column[] {
  const moving = columns.find((c) => c.id === id);
  if (!moving) return [...columns];
  const others = sortColumns(columns.filter((c) => c.id !== id));
  const afterIndex = afterId ? others.findIndex((c) => c.id === afterId) : -1;
  const beforeIndex = beforeId ? others.findIndex((c) => c.id === beforeId) : -1;
  let index = others.length;
  if (afterIndex !== -1) index = afterIndex + 1;
  else if (beforeIndex !== -1) index = beforeIndex;
  const position = hintKey(others[index - 1]?.position, others[index]?.position);
  const placed = { ...moving, position: position ?? moving.position };
  const result = [...others];
  result.splice(index, 0, placed);
  return result;
}

/** Applies an update to the cached board the way the server will. */
export function applyColumnUpdate(
  board: BoardResponse,
  id: string,
  patch: UpdateColumnRequest,
): BoardResponse {
  let columns = board.columns.map((c) => {
    if (patch.isDone === true && c.id !== id) return { ...c, isDone: false };
    if (c.id !== id) return c;
    return {
      ...c,
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.isDone === true && { isDone: true }),
    };
  });
  if (patch.afterColumnId !== undefined || patch.beforeColumnId !== undefined) {
    columns = placeColumn(columns, id, patch.afterColumnId, patch.beforeColumnId);
  }
  return { ...board, columns };
}
