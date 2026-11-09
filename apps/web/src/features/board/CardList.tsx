import type { KeyboardEvent, PointerEvent } from 'react';
import { Link } from 'react-router';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  cardReference,
  type CardSummary,
  type Column,
  type Member,
  type Project,
} from '@kanban/shared';
import { initialsOf, priorityDisplay } from '../cards/fields';

export const cardTileId = (cardId: string) => `card-tile-${cardId}`;
export const cardHandleId = (cardId: string) => `card-handle-${cardId}`;

interface CardItemProps {
  project: Project;
  card: CardSummary;
  /** False for viewers: the handle is disabled and the card cannot be picked up. */
  canDrag: boolean;
  members: Member[];
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
 * One card: a link to its detail dialog (Tab reaches it, Enter opens it) and a drag handle. The
 * handle starts a move with Space or Enter; Space on the link does too, while Enter keeps opening
 * the dialog. Pointer drags start from anywhere on the tile.
 */
function CardItem({ project, card, canDrag, members }: CardItemProps) {
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
      <li ref={setNodeRef} style={style}>
        <div className="card-tile" aria-busy="true">
          <span className="card-title">{card.title}</span>
        </div>
      </li>
    );
  }

  const reference = cardReference(project.key, card.number);
  const onKeyDownOnLink = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (event.code === 'Space' && canDrag) listeners?.['onKeyDown']?.(event);
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'card-item is-dragging' : 'card-item'}
      onPointerDown={
        canDrag ? (listeners?.['onPointerDown'] as (e: PointerEvent) => void) : undefined
      }
    >
      <Link
        id={cardTileId(card.id)}
        className="card-tile"
        to={`/projects/${project.id}/cards/${card.number}`}
        onKeyDown={onKeyDownOnLink}
      >
        <span className="card-ref">{reference}</span>{' '}
        <span className="card-title">{card.title}</span>
        <CardMeta card={card} members={members} />
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
    </li>
  );
}

export interface ColumnCardsProps {
  project: Project;
  column: Column;
  cards: CardSummary[];
  canDrag: boolean;
  members: Member[];
}

/** The cards of one column: a sortable list that is also a drop target when it is empty. */
export function ColumnCards({ project, column, cards, canDrag, members }: ColumnCardsProps) {
  const { setNodeRef } = useDroppable({ id: column.id });
  return (
    <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
      <ul ref={setNodeRef} className="card-list" aria-label={`Cards in ${column.name}`}>
        {cards.map((card) => (
          <CardItem
            key={card.id}
            project={project}
            card={card}
            canDrag={canDrag}
            members={members}
          />
        ))}
      </ul>
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
