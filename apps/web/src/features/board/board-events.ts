import type { BoardEvent, BoardResponse, Card, CardSummary, Column } from '@kanban/shared';

const upsertColumn = (columns: Column[], column: Column): Column[] =>
  columns.some((c) => c.id === column.id)
    ? columns.map((c) => (c.id === column.id ? column : c))
    : [...columns, column];

/**
 * Applies one board event to the cached board. Idempotent and safe against out-of-order delivery:
 * a card event whose `version` is not newer than the cached card's is ignored (and the same board
 * object is returned). Columns are not versioned, so their events are always applied.
 */
export function applyBoardEvent(board: BoardResponse, event: BoardEvent): BoardResponse {
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
  }
}

const summaryFields = (card: CardSummary) => ({
  columnId: card.columnId,
  title: card.title,
  position: card.position,
  version: card.version,
  assigneeId: card.assigneeId,
  priority: card.priority,
  estimate: card.estimate,
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
