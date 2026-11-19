import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Link } from 'react-router';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  defaultRangeExtractor,
  observeElementRect,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual';
import {
  cardReference,
  type CardSummary,
  type Column,
  type Member,
  type Project,
} from '@kanban/shared';
import { initialsOf, priorityDisplay } from '../cards/fields';
import { usePresence } from '../presence/PresenceContext';
import { editingLabel, othersEditing } from '../presence/view-model';

export const cardTileId = (cardId: string) => `card-tile-${cardId}`;
export const cardHandleId = (cardId: string) => `card-handle-${cardId}`;

/** Height of a tile before it is measured (title, one meta line), in pixels. */
const ESTIMATED_TILE_HEIGHT = 64;
/** Gap between tiles, in pixels (the virtual list positions tiles itself, so CSS `gap` is not used). */
const TILE_GAP = 6;
/** Tiles rendered beyond the visible ones on each side. */
const OVERSCAN = 4;
/** Used when the list has no layout (zero height), so something renders before it is measured. */
const FALLBACK_VIEWPORT_HEIGHT = 640;

let tileRenderProbe: ((cardId: string) => void) | undefined;
/** Test hook: called with the card id every time a tile renders. Pass `undefined` to remove it. */
export function setTileRenderProbe(probe: ((cardId: string) => void) | undefined): void {
  tileRenderProbe = probe;
}

interface CardItemProps {
  project: Project;
  card: CardSummary;
  /** False for viewers: the handle is disabled and the card cannot be picked up. */
  canDrag: boolean;
  members: Member[];
  /** Arrow/Home/End on the tile link: move focus to another card of the same column. */
  onNavigate: (cardId: string, key: string) => void;
}

/** Assignee initials, priority (icon + text) and estimate; nothing for a card without any. */
function CardMeta({ card, members }: { card: CardSummary; members: Member[] }) {
  if (card.assigneeId === null && card.priority === 'none' && card.estimate === null) return null;
  const assignee = card.assigneeId ? members.find((m) => m.userId === card.assigneeId) : undefined;
  const priority = priorityDisplay(card.priority);
  return (
    <span className="card-meta">
      {card.assigneeId !== null && (
        <span
          className="card-assignee"
          role="img"
          aria-label={`Assignee: ${assignee?.name ?? 'Unknown member'}`}
        >
          {assignee ? initialsOf(assignee.name) : '?'}
        </span>
      )}
      {card.priority !== 'none' && (
        <span className="card-priority">
          <span aria-hidden="true">{priority.icon}</span> <span>{priority.label}</span>
        </span>
      )}
      {card.estimate !== null && (
        <span className="card-estimate" role="img" aria-label={`Estimate: ${card.estimate} points`}>
          {card.estimate} pts
        </span>
      )}
    </span>
  );
}

/**
 * Who else is editing this card. It reads the presence context itself, so a presence change
 * re-renders only this small child and not every tile.
 */
function CardEditing({ cardId }: { cardId: string }) {
  const { people } = usePresence();
  const editors = othersEditing(people, cardId);
  if (editors.length === 0) return null;
  return (
    <span className="card-editing" data-testid="card-editing">
      {editingLabel(editors.map((p) => p.name))}
    </span>
  );
}

const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/**
 * One card: a link to its detail dialog (Tab reaches it, Enter opens it) and a drag handle. The
 * handle starts a move with Space or Enter; Space on the link does too, while Enter keeps opening
 * the dialog. Pointer drags start from anywhere on the tile. Arrow keys, Home and End on the link
 * move focus to the neighbouring cards, scrolling them into view in a long column.
 *
 * This thin shell owns the sortable binding (dnd-kit re-renders it through context); the markup
 * lives in the memoized `CardBody`, so applying one board event re-renders only the bodies whose
 * card changed.
 */
function CardItem({ project, card, canDrag, members, onNavigate }: CardItemProps) {
  // Number 0 is an optimistic card the server has not numbered yet: shown, but neither openable
  // nor movable.
  const pending = card.number === 0;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !canDrag || pending,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  if (pending) {
    return (
      <div ref={setNodeRef} style={style}>
        <div className="card-tile" aria-busy="true">
          <span className="card-title">{card.title}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'card-item is-dragging' : 'card-item'}
      onPointerDown={
        canDrag ? (listeners?.['onPointerDown'] as (e: PointerEvent) => void) : undefined
      }
    >
      <CardBody
        project={project}
        card={card}
        canDrag={canDrag}
        members={members}
        onNavigate={onNavigate}
        attributes={attributes}
        listeners={listeners}
      />
    </div>
  );
}

type SortableBindings = ReturnType<typeof useSortable>;

interface CardBodyProps {
  project: Project;
  card: CardSummary;
  canDrag: boolean;
  members: Member[];
  onNavigate: (cardId: string, key: string) => void;
  attributes: SortableBindings['attributes'];
  listeners: SortableBindings['listeners'];
}

/** The markup of one tile: the link, its meta line and the move handle. */
const CardBody = memo(function CardBody({
  project,
  card,
  canDrag,
  members,
  onNavigate,
  attributes,
  listeners,
}: CardBodyProps) {
  tileRenderProbe?.(card.id);
  const reference = cardReference(project.key, card.number);
  const onKeyDownOnLink = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (event.code === 'Space' && canDrag) {
      listeners?.['onKeyDown']?.(event);
      return;
    }
    if (NAVIGATION_KEYS.has(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      onNavigate(card.id, event.key);
    }
  };

  return (
    <>
      <Link
        id={cardTileId(card.id)}
        className="card-tile"
        to={`/projects/${project.id}/cards/${card.number}`}
        onKeyDown={onKeyDownOnLink}
      >
        <span className="card-ref">{reference}</span>{' '}
        <span className="card-title">{card.title}</span>
        <CardMeta card={card} members={members} />
        <CardEditing cardId={card.id} />
      </Link>
      {canDrag ? (
        <button
          id={cardHandleId(card.id)}
          type="button"
          className="card-handle"
          aria-label={`Move card ${reference}`}
          {...attributes}
          onKeyDown={listeners?.['onKeyDown'] as (e: KeyboardEvent) => void}
        >
          <span aria-hidden="true">::</span>
        </button>
      ) : (
        <button
          type="button"
          className="card-handle"
          disabled
          aria-label={`Move card ${reference} (not available to viewers)`}
        >
          <span aria-hidden="true">::</span>
        </button>
      )}
    </>
  );
});

export interface ColumnCardsProps {
  project: Project;
  column: Column;
  cards: CardSummary[];
  canDrag: boolean;
  members: Member[];
  /** The card being dragged, if any: it stays rendered even when it scrolls out of view. */
  heldId?: string | null;
  /**
   * Lets the board scroll a card of this column into view (it may not be rendered). Returns the
   * function that removes the registration.
   */
  registerReveal?: (columnId: string, reveal: (cardId: string) => boolean) => () => void;
}

/**
 * The cards of one column: a virtualized sortable list (only the visible tiles, plus a few more,
 * are in the DOM) that is also a drop target when it is empty. Positions announced to assistive
 * technology use the full list (`aria-posinset` / `aria-setsize`).
 */
export function ColumnCards({
  project,
  column,
  cards,
  canDrag,
  members,
  heldId = null,
  registerReveal,
}: ColumnCardsProps) {
  const { setNodeRef } = useDroppable({ id: column.id });
  const scrollRef = useRef<HTMLDivElement>(null);
  // The id list keeps its identity while the ids are unchanged (an edit to one card, for example):
  // a new array would change the sortable context and re-render every tile.
  const previousIds = useRef<string[]>([]);
  const ids = useMemo(() => {
    const next = cards.map((c) => c.id);
    const previous = previousIds.current;
    return previous.length === next.length && previous.every((id, i) => id === next[i])
      ? previous
      : next;
  }, [cards]);
  useEffect(() => {
    previousIds.current = ids;
  }, [ids]);
  // A focused tile stays rendered while it is scrolled out of view, so focus is not lost.
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const keep = useMemo(
    () => [heldId, pinnedId].map((id) => (id ? ids.indexOf(id) : -1)).filter((i) => i >= 0),
    [heldId, pinnedId, ids],
  );

  // The virtualizer's functions are not memoized by design; nothing below passes them to memoized
  // components (the tiles receive plain data), so the compiler's warning does not apply.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_TILE_HEIGHT,
    gap: TILE_GAP,
    overscan: OVERSCAN,
    getItemKey: (index) => ids[index] ?? index,
    rangeExtractor: (range: Range) => {
      const base = defaultRangeExtractor(range);
      const extra = keep.filter((i) => !base.includes(i));
      return extra.length === 0 ? base : [...base, ...extra].sort((a, b) => a - b);
    },
    // Without layout (zero height) fall back to a fixed viewport so a list still renders.
    observeElementRect: (instance, callback) =>
      observeElementRect(instance, (rect) =>
        callback({ width: rect.width, height: rect.height || FALLBACK_VIEWPORT_HEIGHT }),
      ),
    measureElement: (element) => element.getBoundingClientRect().height || ESTIMATED_TILE_HEIGHT,
  });

  const idsRef = useRef(ids);
  idsRef.current = ids;
  const heldRef = useRef(heldId);
  heldRef.current = heldId;
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  useEffect(() => {
    if (!registerReveal) return undefined;
    return registerReveal(column.id, (cardId) => {
      const index = idsRef.current.indexOf(cardId);
      if (index < 0) return false;
      virtualizerRef.current.scrollToIndex(index, { align: 'auto' });
      return true;
    });
  }, [column.id, registerReveal]);

  const onNavigate = useCallback((cardId: string, key: string) => {
    // While a card is being dragged the arrow keys belong to the drag.
    if (heldRef.current) return;
    const list = idsRef.current;
    const from = list.indexOf(cardId);
    const to =
      key === 'ArrowDown'
        ? Math.min(from + 1, list.length - 1)
        : key === 'ArrowUp'
          ? Math.max(from - 1, 0)
          : key === 'Home'
            ? 0
            : list.length - 1;
    const target = list[to];
    if (target === undefined || to === from) return;
    virtualizerRef.current.scrollToIndex(to, { align: 'auto' });
    // The target may only be rendered after the scroll; wait for it (a few frames at most).
    let attempts = 10;
    const focusWhenRendered = () => {
      const element = document.getElementById(cardTileId(target));
      if (element) element.focus();
      else if (attempts-- > 0) requestAnimationFrame(focusWhenRendered);
    };
    focusWhenRendered();
  }, []);

  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      <div ref={scrollRef} className="card-scroll">
        <ul
          ref={setNodeRef}
          className="card-list"
          style={{ height: virtualizer.getTotalSize() }}
          aria-label={`Cards in ${column.name}`}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const card = cards[row.index];
            if (!card) return null;
            return (
              <li
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                aria-posinset={row.index + 1}
                aria-setsize={cards.length}
                className="card-row"
                style={{ transform: `translateY(${row.start}px)` }}
                onFocus={() => setPinnedId(card.id)}
                onBlur={() => setPinnedId((current) => (current === card.id ? null : current))}
              >
                <CardItem
                  project={project}
                  card={card}
                  canDrag={canDrag}
                  members={members}
                  onNavigate={onNavigate}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </SortableContext>
  );
}

/** The copy that follows the pointer or keyboard while a card is being moved. */
export function CardOverlay({ project, card }: { project: Project; card: CardSummary }) {
  return (
    <div className="card-tile card-overlay">
      <span className="card-ref">{cardReference(project.key, card.number)}</span>{' '}
      <span className="card-title">{card.title}</span>
    </div>
  );
}
