import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  columnNameSchema,
  moveNeighbours,
  type Column,
  type MoveDirection,
  type Project,
} from '@kanban/shared';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Spinner,
  TextField,
  useAnnounce,
} from '../../components';
import { ColumnMenu, type ColumnMenuItem } from './ColumnMenu';
import { useBoard, useCreateColumn, useDeleteColumn, useUpdateColumn } from './api';
import { sortColumns } from './ordering';

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

export interface BoardViewProps {
  project: Project;
  /** True for owners and members (`board:manage`); viewers get a read-only board. */
  canManage: boolean;
}

export function BoardView({ project, canManage }: BoardViewProps) {
  const announce = useAnnounce();
  const board = useBoard(project.id);
  const boardId = board.data?.board.id ?? '';
  const createColumn = useCreateColumn(project.id, boardId);
  const updateColumn = useUpdateColumn(project.id);
  const deleteColumn = useDeleteColumn(project.id);
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

  function confirmDelete() {
    const column = deleting;
    if (!column) return;
    setDeleting(null);
    focusAfterRender.current = ADD_BUTTON_ID;
    deleteColumn.mutate(column.id, {
      onSuccess: () => announce(`Column ${column.name} deleted`),
      onError: failed('Could not delete the column'),
    });
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
        <p>
          The column is removed from the board. This is the only thing it affects; there are no
          cards yet.
        </p>
        <div className="dialog-actions">
          <Button onClick={confirmDelete}>Delete column</Button>
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
        </div>
      </Dialog>
    </section>
  );
}
