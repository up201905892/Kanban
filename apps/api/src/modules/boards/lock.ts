import type { PrismaClient } from '../../db.js';

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Serialises every structural change of one board (column and card moves compute keys from the
 * current siblings, the Done flag must stay exclusive and card writes touch the project counter).
 * Returns false when the board no longer exists.
 */
export async function lockBoard(tx: Tx, boardId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "boards" WHERE "id" = ${boardId}::uuid FOR UPDATE`;
  return rows.length > 0;
}
