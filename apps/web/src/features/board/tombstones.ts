import type { BoardResponse } from '@kanban/shared';
import type { QueryClient } from '@tanstack/react-query';
import { isApiError, request } from '../../lib/api';

/** Deleted cards and columns cannot be restored in v1.0, so the most recent ids are enough. */
export const MAX_TOMBSTONES = 1000;

/** The ids of recently deleted entities, oldest first, bounded. */
export class IdSet {
  private readonly ids = new Set<string>();

  constructor(private readonly limit = MAX_TOMBSTONES) {}

  add(id: string): void {
    // Re-adding refreshes the id so the oldest one is the one that is dropped.
    this.ids.delete(id);
    this.ids.add(id);
    while (this.ids.size > this.limit) {
      const oldest = this.ids.values().next();
      if (oldest.done) break;
      this.ids.delete(oldest.value);
    }
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  get size(): number {
    return this.ids.size;
  }
}

/** Deletion records for the live board cache (KB-039): "delete wins" (ADR 0001). */
export interface Tombstones {
  cards: IdSet;
  columns: IdSet;
}

export const createTombstones = (limit = MAX_TOMBSTONES): Tombstones => ({
  cards: new IdSet(limit),
  columns: new IdSet(limit),
});

/**
 * Board data without tombstoned cards and columns. Returns the same object when nothing has to go,
 * so a refetch that started before a deletion cannot bring the entity back.
 */
export function filterTombstoned(board: BoardResponse, tombstones: Tombstones): BoardResponse {
  const hit =
    board.columns.some((c) => tombstones.columns.has(c.id)) ||
    board.cards.some((c) => tombstones.cards.has(c.id) || tombstones.columns.has(c.columnId));
  if (!hit) return board;
  return {
    ...board,
    columns: board.columns.filter((c) => !tombstones.columns.has(c.id)),
    cards: board.cards.filter(
      (c) => !tombstones.cards.has(c.id) && !tombstones.columns.has(c.columnId),
    ),
  };
}

// One record per query client (= per session in the browser); the registry is not used by reducers.
const registry = new WeakMap<QueryClient, Tombstones>();

export function tombstonesOf(queryClient: QueryClient): Tombstones {
  let found = registry.get(queryClient);
  if (!found) {
    found = createTombstones();
    registry.set(queryClient, found);
  }
  return found;
}

const isBoardKey = (key: readonly unknown[]) => key[0] === 'projects' && key[2] === 'board';

/** Records a deleted card and removes its tile from every cached board. */
export function tombstoneCard(queryClient: QueryClient, cardId: string): void {
  const tombstones = tombstonesOf(queryClient);
  tombstones.cards.add(cardId);
  for (const [key, board] of queryClient.getQueriesData<BoardResponse>({
    predicate: (query) => isBoardKey(query.queryKey),
  })) {
    if (board?.cards.some((c) => c.id === cardId)) {
      queryClient.setQueryData<BoardResponse>(key, filterTombstoned(board, tombstones));
    }
  }
}

/**
 * Runs a request about one card; a `404` means the card is gone, so it is tombstoned and its tile
 * removed (the caller's own error handling, and its announcement, still run). With `confirm`, a
 * second read of the card first checks that it is the card that is missing and not, for example,
 * the destination column of a move.
 */
export async function tombstoneOn404<T>(
  queryClient: QueryClient,
  cardId: string,
  run: () => Promise<T>,
  confirm = false,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      let gone = true;
      if (confirm) {
        try {
          await request(`/api/cards/${cardId}`);
          gone = false;
        } catch (check) {
          gone = isApiError(check) && check.status === 404;
        }
      }
      if (gone) tombstoneCard(queryClient, cardId);
    }
    throw error;
  }
}

/** Records a deleted column. */
export function tombstoneColumn(queryClient: QueryClient, columnId: string): void {
  tombstonesOf(queryClient).columns.add(columnId);
}
