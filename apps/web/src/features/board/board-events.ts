import type { BoardEvent, BoardResponse, Card, CardSummary, Column } from '@kanban/shared';
import { sortSprints } from '../sprints/planning';
import type { Tombstones } from './tombstones';

const upsertColumn = (columns: Column[], column: Column): Column[] =>
  columns.some((c) => c.id === column.id)
    ? columns.map((c) => (c.id === column.id ? column : c))
    : [...columns, column];

/** True when a create, update or move event is about a card or column that was deleted. */
export function isTombstoned(event: BoardEvent, tombstones: Tombstones): boolean {
  switch (event.type) {
    case 'column_created':
    case 'column_updated':
      return tombstones.columns.has(event.entity.id);
    case 'card_created':
    case 'card_updated':
    case 'card_moved':
      return tombstones.cards.has(event.entity.id);
    default:
      return false;
  }
}

/**
 * Applies one board event to the cached board. Idempotent and safe against out-of-order delivery:
 * a card event whose `version` is not newer than the cached card's is ignored (and the same board
 * object is returned). Columns are not versioned, so their events are always applied, except for
 * ids in `tombstones` (KB-039): an event for a deleted card or column is ignored ("delete wins").
 */
export function applyBoardEvent(
  board: BoardResponse,
  event: BoardEvent,
  tombstones?: Tombstones,
): BoardResponse {
  if (tombstones && isTombstoned(event, tombstones)) return board;
  switch (event.type) {
    case 'column_created':
    case 'column_updated': {
      const columns = upsertColumn(board.columns, event.entity).map((c) =>
        // The Done column is exclusive.
        event.entity.isDone && c.id !== event.entity.id && c.isDone ? { ...c, isDone: false } : c,
      );
      return { ...board, columns };
    }
    case 'column_deleted':
      if (!board.columns.some((c) => c.id === event.entity.id)) return board;
      return {
        ...board,
        columns: board.columns.filter((c) => c.id !== event.entity.id),
        cards: board.cards.filter((c) => c.columnId !== event.entity.id),
      };
    case 'card_created':
    case 'card_updated':
    case 'card_moved': {
      const cached = board.cards.find((c) => c.id === event.entity.id);
      if (!cached) return { ...board, cards: [...board.cards, event.entity] };
      if (event.version <= cached.version) return board;
      return {
        ...board,
        cards: board.cards.map((c) => (c.id === event.entity.id ? event.entity : c)),
      };
    }
    case 'card_deleted': {
      const cached = board.cards.find((c) => c.id === event.entity.id);
      if (!cached || event.version <= cached.version) return board;
      return { ...board, cards: board.cards.filter((c) => c.id !== event.entity.id) };
    }
    case 'sprint_updated': {
      // The board only holds planned and active sprints; a closed one leaves it.
      const others = board.sprints.filter((s) => s.id !== event.entity.id);
      const sprints =
        event.entity.status === 'closed' ? others : sortSprints([...others, event.entity]);
      return { ...board, sprints };
    }
  }
}

/**
 * Merges a freshly fetched board with the cached one. A fetch can be answered from a database read
 * that is older than a real-time event already applied (the response overtakes nothing, the event
 * overtakes the response); then the card in the cache has a higher `version` and is kept, so a
 * stale refetch never undoes a newer move or edit. Everything else comes from the fetch.
 */
export function mergeFetchedBoard(
  fetched: BoardResponse,
  cached: BoardResponse | undefined,
): BoardResponse {
  if (!cached) return fetched;
  const newer = new Map(cached.cards.map((c) => [c.id, c]));
  let changed = false;
  const cards = fetched.cards.map((card) => {
    const kept = newer.get(card.id);
    if (kept && kept.version > card.version) {
      changed = true;
      return kept;
    }
    return card;
  });
  return changed ? { ...fetched, cards } : fetched;
}

const summaryFields = (card: CardSummary) => ({
  columnId: card.columnId,
  title: card.title,
  position: card.position,
  version: card.version,
  assigneeId: card.assigneeId,
  priority: card.priority,
  estimate: card.estimate,
  sprintId: card.sprintId,
});

/**
 * Applies a card event to the full card (the dialog's copy): the summary fields follow the event,
 * the description (not part of the event) is kept until the card is refetched. Stale events are
 * ignored.
 */
export function applyCardEvent(card: Card, event: BoardEvent): Card {
  if (
    event.type !== 'card_created' &&
    event.type !== 'card_updated' &&
    event.type !== 'card_moved'
  ) {
    return card;
  }
  if (event.entity.id !== card.id || event.version <= card.version) return card;
  return { ...card, ...summaryFields(event.entity) };
}

/** What a remote card event means for the person looking at the board. */
export type RemoteChange =
  | { kind: 'moved'; card: CardSummary; toColumnId: string; actorId: string }
  | { kind: 'deleted'; cardId: string; number: number; title: string; actorId: string };

/** The remote changes worth announcing or showing in the open dialog, if the event was applied. */
export function remoteChangeOf(before: BoardResponse, event: BoardEvent): RemoteChange | null {
  if (event.type === 'card_deleted') {
    const cached = before.cards.find((c) => c.id === event.entity.id);
    if (!cached || event.version <= cached.version) return null;
    return {
      kind: 'deleted',
      cardId: event.entity.id,
      number: event.entity.number,
      title: event.entity.title,
      actorId: event.actorId,
    };
  }
  if (event.type === 'card_moved') {
    const cached = before.cards.find((c) => c.id === event.entity.id);
    if (!cached || event.version <= cached.version) return null;
    if (cached.columnId === event.entity.columnId && cached.position === event.entity.position) {
      return null;
    }
    return {
      kind: 'moved',
      card: event.entity,
      toColumnId: event.entity.columnId,
      actorId: event.actorId,
    };
  }
  return null;
}
