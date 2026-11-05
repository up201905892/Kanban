import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  cardReference,
  columnNameSchema,
  moveNeighbours,
  type BoardResponse,
  type CardSummary,
  type Column,
  type MoveDirection,
  type Project,
} from '@kanban/shared';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Select,
  Spinner,
  TextField,
  useAnnounce,
} from '../../components';
import { Link } from 'react-router';
import { AddCard, addCardButtonId } from '../cards/AddCard';
import { CardDialog } from '../cards/CardDialog';
import { useCreateCard, useDeleteCard } from '../cards/api';
import { ColumnMenu, type ColumnMenuItem } from './ColumnMenu';
import { useBoard, useCreateColumn, useDeleteColumn, useUpdateColumn } from './api';
import { cardsOf, sortColumns } from './ordering';

const cardTileId = (cardId: string) => `card-tile-${cardId}`;

/** A card on the board: a link to its detail dialog, so Tab reaches it and Enter opens it. */
function CardTile({ project, card }: { project: Project; card: CardSummary }) {
  // Number 0 is an optimistic card the server has not numbered yet: shown, but not openable.
  if (card.number === 0) {
    return (
      <div className="card-tile" aria-busy="true">
        <span className="card-title">{card.title}</span>
      </div>
    );
  }
  const reference = cardReference(project.key, card.number);
  return (
    <Link
      id={cardTileId(card.id)}
      className="card-tile"
      to={`/projects/${project.id}/cards/${card.number}`}
    >
      <span className="card-ref">{reference}</span> <span className="card-title">{card.title}</span>
    </Link>
  );
}

const triggerIdOf = (columnId: string) => `column-menu-${columnId}`;
const ADD_BUTTON_ID = 'add-column-button';

const validate = (name: string): string | undefined => {
  const parsed = columnNameSchema.safeParse(name);
  return parsed.success ? undefined : (parsed.error.issues[0]?.message ?? 'Invalid name');
};

interface ColumnTitleProps {
  column: Column;
  canManage: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (name: string) => void;
}

/** The column name: a heading, and for managers an inline editor (Enter saves, Escape cancels). */
function ColumnTitle({
  column,
  canManage,
  editing,
  onStartEdit,
  onCancel,
  onSave,
}: ColumnTitleProps) {
  if (editing) return <ColumnNameEditor column={column} onCancel={onCancel} onSave={onSave} />;
  return (
    <h2 className="column-title">
      {canManage ? (
        <button type="button" onClick={onStartEdit} title="Rename column">
          {column.name}
        </button>
      ) : (
        column.name
      )}
      {column.isDone && <span className="badge"> (Done column)</span>}
    </h2>
  );
}

interface ColumnNameEditorProps {
  column: Column;
  onCancel: () => void;
  onSave: (name: string) => void;
}

/** Mounted only while editing, so its state always starts from the current name. */
function ColumnNameEditor({ column, onCancel, onSave }: ColumnNameEditorProps) {
  const [value, setValue] = useState(column.name);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const errorId = useId();

  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    if (finished.current) return;
    const problem = validate(value);
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    finished.current = true;
    const name = value.trim();
    if (name === column.name) onCancel();
    else onSave(name);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finished.current = true;
      onCancel();
    }
  };

  return (
    <form
      className="column-title"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        ref={inputRef}
        value={value}
        aria-label={`Name of column ${column.name}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={submit}
      />
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </form>
  );
}

interface AddColumnProps {
  onAdd: (name: string) => void;
}

function AddColumn({ onAdd }: AddColumnProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setName('');
    setError(undefined);
    // The button is re-rendered after the form closes; focus it on the next frame.
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  if (!open) {
    return (
      <button ref={buttonRef} id={ADD_BUTTON_ID} type="button" onClick={() => setOpen(true)}>
        Add column
      </button>
    );
  }

  return (
    <form
      aria-label="Add column"
      onSubmit={(event) => {
        event.preventDefault();
        const problem = validate(name);
        if (problem) {
          setError(problem);
          inputRef.current?.focus();
          return;
        }
        onAdd(name.trim());
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <TextField
        ref={inputRef}
        label="Column name"
        value={name}
        error={error}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="dialog-actions">
        <Button type="submit">Add</Button>
        <Button onClick={close}>Cancel</Button>
      </div>
    </form>
  );
}

interface DeleteColumnBodyProps {
  column: Column;
  otherColumns: Column[];
  cardCount: number;
  onConfirm: (moveCardsTo: string | undefined) => void;
  onCancel: () => void;
}

/** Mounted only while the dialog is open, so the chosen destination always starts fresh. */
function DeleteColumnBody({
  column,
  otherColumns,
  cardCount,
  onConfirm,
  onCancel,
}: DeleteColumnBodyProps) {
  const [moveTo, setMoveTo] = useState(otherColumns[0]?.id ?? '');
  const hasCards = cardCount > 0;
  return (
    <>
      {hasCards ? (
        <>
          <p>
            This column has {cardCount} {cardCount === 1 ? 'card' : 'cards'}. They are not deleted:
            they move to the end of the column you choose.
          </p>
          <Select
            label="Move cards to"
            value={moveTo}
            options={otherColumns.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(event) => setMoveTo(event.target.value)}
          />
        </>
      ) : (
        <p>The column {column.name} is empty. It is removed from the board.</p>
      )}
      <div className="dialog-actions">
        <Button onClick={() => onConfirm(hasCards ? moveTo : undefined)}>Delete column</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </>
  );
}

export interface BoardViewProps {
  project: Project;
  /** True for owners and members (`board:manage`); viewers get a read-only board. */
  canManage: boolean;
  /** True for owners and members (`card:edit`); viewers cannot add, edit or delete cards. */
  canEditCards: boolean;
  /** Number of the card named by the address (`/projects/:pid/cards/:number`), if any. */
  openCardNumber?: number | undefined;
  /** Closes the card dialog (the page removes the card from the address). */
  onCloseCard: () => void;
}

export function BoardView({
  project,
  canManage,
  canEditCards,
  openCardNumber,
  onCloseCard,
}: BoardViewProps) {
  const announce = useAnnounce();
  const board = useBoard(project.id);
  const boardId = board.data?.board.id ?? '';
  const createColumn = useCreateColumn(project.id, boardId);
  const updateColumn = useUpdateColumn(project.id);
  const deleteColumn = useDeleteColumn(project.id);
  const createCard = useCreateCard(project.id);
  const deleteCard = useDeleteCard(project.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Column | null>(null);
  const focusAfterRender = useRef<string | null>(null);

  // Keyed DOM nodes that move can lose focus; put it back where the user was.
  useLayoutEffect(() => {
    const id = focusAfterRender.current;
    if (id) {
      focusAfterRender.current = null;
      document.getElementById(id)?.focus();
    }
  });

  if (board.isPending) return <Spinner label="Loading board" />;
  if (board.isError) {
    return (
      <ErrorState
        title="Board unavailable"
        message={board.error.message}
        onRetry={() => void board.refetch()}
      />
    );
  }

  const columns = sortColumns(board.data.columns);
  const failed = (action: string) => (error: Error) =>
    announce(`${action}: ${error.message}`, 'assertive');

  function addColumn(name: string) {
    createColumn.mutate(
      { id: crypto.randomUUID(), name },
      {
        onSuccess: () => announce(`Column ${name} added`),
        onError: failed('Could not add the column'),
      },
    );
  }

  function rename(column: Column, name: string) {
    setEditingId(null);
    focusAfterRender.current = triggerIdOf(column.id);
    updateColumn.mutate(
      { id: column.id, patch: { name } },
      {
        onSuccess: () => announce(`Column renamed to ${name}`),
        onError: failed('Could not rename the column'),
      },
    );
  }

  function move(column: Column, direction: MoveDirection) {
    const neighbours = moveNeighbours(
      columns.map((c) => c.id),
      column.id,
      direction,
    );
    if (!neighbours) return;
    focusAfterRender.current = triggerIdOf(column.id);
    const target = columns.findIndex((c) => c.id === column.id) + (direction === 'left' ? -1 : 1);
    updateColumn.mutate(
      { id: column.id, patch: neighbours },
      {
        onSuccess: () =>
          announce(`Column ${column.name} moved to position ${target + 1} of ${columns.length}`),
        onError: failed('Could not move the column'),
      },
    );
  }

  function markDone(column: Column) {
    focusAfterRender.current = triggerIdOf(column.id);
    updateColumn.mutate(
      { id: column.id, patch: { isDone: true } },
      {
        onSuccess: () => announce(`Column ${column.name} is now the Done column`),
        onError: failed('Could not mark the column as Done'),
      },
    );
  }

  function confirmDelete(moveCardsTo: string | undefined) {
    const column = deleting;
    if (!column) return;
    setDeleting(null);
    focusAfterRender.current = ADD_BUTTON_ID;
    const destination = columns.find((c) => c.id === moveCardsTo);
    const moved = cardsOf(board.data as BoardResponse, column.id).length;
    deleteColumn.mutate(
      { id: column.id, ...(moveCardsTo && { moveCardsTo }) },
      {
        onSuccess: () =>
          announce(
            destination && moved > 0
              ? `Column ${column.name} deleted; ${moved} ${moved === 1 ? 'card' : 'cards'} moved to ${destination.name}`
              : `Column ${column.name} deleted`,
          ),
        onError: failed('Could not delete the column'),
      },
    );
  }

  function addCard(column: Column, title: string) {
    createCard.mutate(
      { id: crypto.randomUUID(), columnId: column.id, title },
      {
        onSuccess: ({ card }) =>
          announce(`Card ${cardReference(project.key, card.number)} created in ${column.name}`),
        onError: failed('Could not create the card'),
      },
    );
  }

  function removeCard(card: CardSummary) {
    const reference = cardReference(project.key, card.number);
    onCloseCard();
    deleteCard.mutate(card.id, {
      onSuccess: () => announce(`Card ${reference} deleted`),
      onError: failed(`Could not delete card ${reference}`),
    });
    // The tile is gone and the dialog unmounts (restoring focus to that tile first); the column's
    // "Add card" button is the next sensible stop, so move there once both have settled.
    window.setTimeout(() => document.getElementById(addCardButtonId(card.columnId))?.focus(), 50);
  }

  function closeCard(card: CardSummary | undefined) {
    onCloseCard();
    // A deep link has no earlier focus to return to; the tile is the natural place.
    if (card) {
      requestAnimationFrame(() => document.getElementById(cardTileId(card.id))?.focus());
    }
  }

  const menuItems = (column: Column, index: number): ColumnMenuItem[] => [
    { label: 'Rename', onSelect: () => setEditingId(column.id) },
    {
      label: 'Move left',
      onSelect: () => move(column, 'left'),
      ...(index === 0 && { disabledReason: 'Already the first column' }),
    },
    {
      label: 'Move right',
      onSelect: () => move(column, 'right'),
      ...(index === columns.length - 1 && { disabledReason: 'Already the last column' }),
    },
    {
      label: 'Mark as Done column',
      onSelect: () => markDone(column),
      ...(column.isDone && { disabledReason: 'Already the Done column' }),
    },
    {
      label: 'Delete',
      onSelect: () => setDeleting(column),
      ...(column.isDone && {
        disabledReason: 'The Done column cannot be deleted; mark another column as Done first',
      }),
    },
  ];

  return (
    <section aria-label="Board">
      {columns.length === 0 && (
        <EmptyState
          title="No columns yet"
          description={
            canManage ? 'Add a column to start organising work.' : 'This board has no columns.'
          }
        />
      )}
      {/* The scroll container is focusable so keyboard users can scroll it (axe: scrollable-region). */}
      <div className="board-scroll" tabIndex={0} role="group" aria-label="Board columns">
        <ul className="board">
          {columns.map((column, index) => (
            <li key={column.id} className="board-column">
              <section aria-label={`Column ${column.name}`}>
                <header className="column-header">
                  <ColumnTitle
                    column={column}
                    canManage={canManage}
                    editing={editingId === column.id}
                    onStartEdit={() => setEditingId(column.id)}
                    onCancel={() => {
                      setEditingId(null);
                      focusAfterRender.current = triggerIdOf(column.id);
                    }}
                    onSave={(name) => rename(column, name)}
                  />
                  {canManage && (
                    <ColumnMenu
                      triggerId={triggerIdOf(column.id)}
                      columnName={column.name}
                      items={menuItems(column, index)}
                    />
                  )}
                </header>
                <ul className="card-list" aria-label={`Cards in ${column.name}`}>
                  {cardsOf(board.data, column.id).map((card) => (
                    <li key={card.id}>
                      <CardTile project={project} card={card} />
                    </li>
                  ))}
                </ul>
                {canEditCards && (
                  <AddCard
                    columnId={column.id}
                    columnName={column.name}
                    onAdd={(title) => addCard(column, title)}
                  />
                )}
              </section>
            </li>
          ))}
          {canManage && (
            <li className="board-column">
              <AddColumn onAdd={addColumn} />
            </li>
          )}
        </ul>
      </div>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete column ${deleting?.name ?? ''}?`}
      >
        {deleting && (
          <DeleteColumnBody
            column={deleting}
            otherColumns={columns.filter((c) => c.id !== deleting.id)}
            cardCount={cardsOf(board.data, deleting.id).length}
            onConfirm={confirmDelete}
            onCancel={() => setDeleting(null)}
          />
        )}
      </Dialog>
      {openCardNumber !== undefined && (
        <CardDialog
          projectId={project.id}
          projectKey={project.key}
          number={openCardNumber}
          summary={board.data.cards.find((c) => c.number === openCardNumber)}
          canEdit={canEditCards}
          onClose={() => closeCard(board.data.cards.find((c) => c.number === openCardNumber))}
          onDelete={removeCard}
        />
      )}
    </section>
  );
}
