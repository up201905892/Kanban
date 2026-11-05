import { z } from 'zod';

export const COLUMN_NAME_MIN_LENGTH = 1;
export const COLUMN_NAME_MAX_LENGTH = 50;

/** Names of the columns every new project starts with; the last one is the Done column. */
export const DEFAULT_COLUMNS = [
  { name: 'To do', isDone: false },
  { name: 'In progress', isDone: false },
  { name: 'Done', isDone: true },
] as const;

export const columnNameSchema = z
  .string()
  .trim()
  .min(COLUMN_NAME_MIN_LENGTH, 'Name is required')
  .max(COLUMN_NAME_MAX_LENGTH, `Name must be at most ${COLUMN_NAME_MAX_LENGTH} characters`);

export const projectBoardParamsSchema = z.strictObject({ pid: z.uuid() });
export const boardParamsSchema = z.strictObject({ bid: z.uuid() });
export const columnParamsSchema = z.strictObject({ id: z.uuid() });

export const boardSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
});
export type Board = z.infer<typeof boardSchema>;

export const columnSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  name: z.string(),
  /** Fractional-index key (ADR 0001); clients order by it with `compareByPosition`. */
  position: z.string(),
  isDone: z.boolean(),
});
export type Column = z.infer<typeof columnSchema>;

export const boardResponseSchema = z.object({
  board: boardSchema,
  /** Ordered by (position, id). */
  columns: z.array(columnSchema),
});
export type BoardResponse = z.infer<typeof boardResponseSchema>;

/**
 * Where a column goes, named by its neighbours (ADR 0001 section 3). The server computes the final
 * key; `null` means "no neighbour on that side".
 */
const neighbourFields = {
  afterColumnId: z.uuid().nullable().optional(),
  beforeColumnId: z.uuid().nullable().optional(),
};

export const createColumnRequestSchema = z.strictObject({
  /** Client-generated id (A6): repeating the create returns the existing column. */
  id: z.uuid().optional(),
  name: columnNameSchema,
  ...neighbourFields,
});
export type CreateColumnRequest = z.infer<typeof createColumnRequestSchema>;

export const updateColumnRequestSchema = z
  .strictObject({
    name: columnNameSchema.optional(),
    isDone: z.boolean().optional(),
    ...neighbourFields,
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'Send at least one field to change',
  });
export type UpdateColumnRequest = z.infer<typeof updateColumnRequestSchema>;

export const columnResponseSchema = z.object({ column: columnSchema });
export type ColumnResponse = z.infer<typeof columnResponseSchema>;

export type MoveDirection = 'left' | 'right';

export interface ColumnNeighbours {
  afterColumnId: string | null;
  beforeColumnId: string | null;
}

/**
 * The neighbours that move column `id` one place left or right in `orderedIds`, or `null` when it
 * is already at that edge (or unknown).
 */
export function moveNeighbours(
  orderedIds: readonly string[],
  id: string,
  direction: MoveDirection,
): ColumnNeighbours | null {
  const index = orderedIds.indexOf(id);
  if (index === -1) return null;
  if (direction === 'left') {
    if (index === 0) return null;
    return {
      afterColumnId: orderedIds[index - 2] ?? null,
      beforeColumnId: orderedIds[index - 1] ?? null,
    };
  }
  if (index === orderedIds.length - 1) return null;
  return {
    afterColumnId: orderedIds[index + 1] ?? null,
    beforeColumnId: orderedIds[index + 2] ?? null,
  };
}
