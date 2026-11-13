import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  cardReference,
  cardTitleSchema,
  type Card,
  type CardSummary,
  type Column,
  type Member,
} from '@kanban/shared';
import { Button, Dialog, ErrorState, Select, Spinner, useAnnounce } from '../../components';
import { usePresence } from '../presence/PresenceContext';
import { othersOnCard } from '../presence/view-model';
import { useCard, useUpdateCard } from './api';
import { CardFields } from './CardFields';
import { DescriptionSection } from './DescriptionSection';

export interface CardDialogProps {
  projectId: string;
  projectKey: string;
  /** The card named by the address, or undefined when the board has no such card. */
  summary: CardSummary | undefined;
  /** Name of the person who deleted this card while the dialog was open (live updates). */
  deletedBy?: string | undefined;
  /** Owners and members (`card:edit`); viewers get a read-only dialog. */
  canEdit: boolean;
  /** Columns of the board, for "Move to...". */
  columns: Column[];
  /** Members of the workspace: the assignee choices and names. */
  members: Member[];
  /** "Move to...": the non-drag way to move the card. */
  onMove: (card: CardSummary, columnId: string, placement: 'top' | 'bottom') => void;
  /** The number from the address, for the "not found" message. */
  number: number;
  onClose: () => void;
  onDelete: (card: CardSummary) => void;
}

/** Card detail at `/projects/:pid/cards/:number`: title, description and delete. */
export function CardDialog({
  projectId,
  projectKey,
  summary,
  deletedBy,
  canEdit,
  columns,
  members,
  onMove,
  number,
  onClose,
  onDelete,
}: CardDialogProps) {
  const reference = cardReference(projectKey, number);
  if (!summary) {
    return (
      <Dialog open onClose={onClose} title={`Card ${reference}`}>
        <p>
          {deletedBy
            ? `This card was deleted by ${deletedBy}`
            : 'This card does not exist or was deleted.'}
        </p>
        <div className="dialog-actions">
          <Button onClick={onClose}>{deletedBy ? 'OK' : 'Close'}</Button>
        </div>
      </Dialog>
    );
  }
  return (
    <CardDetail
      projectId={projectId}
      reference={reference}
      summary={summary}
      canEdit={canEdit}
      columns={columns}
      members={members}
      onMove={onMove}
      onClose={onClose}
      onDelete={onDelete}
    />
  );
}

interface CardDetailProps {
  projectId: string;
  reference: string;
  summary: CardSummary;
  canEdit: boolean;
  columns: Column[];
  members: Member[];
  onMove: (card: CardSummary, columnId: string, placement: 'top' | 'bottom') => void;
  onClose: () => void;
  onDelete: (card: CardSummary) => void;
}

function CardDetail({
  projectId,
  reference,
  summary,
  canEdit,
  columns,
  members,
  onMove,
  onClose,
  onDelete,
}: CardDetailProps) {
  const card = useCard(summary.id);
  const [confirming, setConfirming] = useState(false);
  const { people, setActiveCard } = usePresence();
  const others = othersOnCard(people, summary.id);

  // Tell the board which card this person has open (presence, KB-020).
  useEffect(() => {
    setActiveCard(summary.id);
    return () => setActiveCard(null);
  }, [summary.id, setActiveCard]);
  const title = `Card ${reference}`;

  if (confirming) {
    return (
      <Dialog
        key="confirm-delete"
        open
        onClose={() => setConfirming(false)}
        title={`Delete card ${reference}?`}
      >
        <p>
          &ldquo;{card.data?.title ?? summary.title}&rdquo; is removed from the board. This cannot
          be undone from here.
        </p>
        <div className="dialog-actions">
          <Button onClick={() => onDelete(summary)}>Delete card</Button>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog key="detail" open onClose={onClose} title={title}>
      {others.length > 0 && (
        <p className="card-presence" data-testid="card-presence">
          Also here:{' '}
          {others
            .map((p) => (p.editingCardIds.includes(summary.id) ? `${p.name} (editing)` : p.name))
            .join(', ')}
        </p>
      )}
      {card.isPending && <Spinner label="Loading card" />}
      {card.isError && (
        <ErrorState
          title="Card unavailable"
          message={card.error.message}
          onRetry={() => void card.refetch()}
        />
      )}
      {card.data && (
        <>
          <TitleSection projectId={projectId} card={card.data} canEdit={canEdit} />
          <CardFields projectId={projectId} card={card.data} members={members} canEdit={canEdit} />
          <DescriptionSection card={card.data} canEdit={canEdit} />
        </>
      )}
      {canEdit && <MoveSection summary={summary} columns={columns} onMove={onMove} />}
      <div className="dialog-actions">
        {canEdit && <Button onClick={() => setConfirming(true)}>Delete card</Button>}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

interface MoveSectionProps {
  summary: CardSummary;
  columns: Column[];
  onMove: (card: CardSummary, columnId: string, placement: 'top' | 'bottom') => void;
}

/** "Move to...": the keyboard and screen-reader alternative to dragging (column + top or bottom). */
function MoveSection({ summary, columns, onMove }: MoveSectionProps) {
  const [columnId, setColumnId] = useState(summary.columnId);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
  return (
    <form
      aria-label="Move to"
      className="move-section"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onMove(summary, columnId, placement);
      }}
    >
      <h3>Move to&hellip;</h3>
      <Select
        label="Column"
        value={columnId}
        options={columns.map((c) => ({ value: c.id, label: c.name }))}
        onChange={(event) => setColumnId(event.target.value)}
      />
      <Select
        label="Position"
        value={placement}
        options={[
          { value: 'top', label: 'Top' },
          { value: 'bottom', label: 'Bottom' },
        ]}
        onChange={(event) => setPlacement(event.target.value === 'top' ? 'top' : 'bottom')}
      />
      <Button type="submit">Move card</Button>
    </form>
  );
}

interface SectionProps {
  projectId: string;
  card: Card;
  canEdit: boolean;
}

/** The title as a heading; editors get an inline editor (Enter saves, Escape cancels). */
function TitleSection({ projectId, card, canEdit }: SectionProps) {
  const announce = useAnnounce();
  const update = useUpdateCard(projectId);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(card.title);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const refocus = useRef(false);

  useLayoutEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  const finish = () => {
    refocus.current = true;
    setEditing(false);
    setError(undefined);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = cardTitleSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid title');
      inputRef.current?.focus();
      return;
    }
    finish();
    if (parsed.data === card.title) return;
    update.mutate(
      { id: card.id, patch: { title: parsed.data } },
      {
        onSuccess: () => announce('Card title saved'),
        onError: (e) => announce(`Could not save the title: ${e.message}`, 'assertive'),
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      // Cancel the edit only; a second Escape closes the dialog.
      event.preventDefault();
      event.stopPropagation();
      setValue(card.title);
      finish();
    }
  };

  if (editing) {
    return (
      <form onSubmit={submit}>
        <label htmlFor={`${errorId}-title`}>Card title</label>
        <input
          id={`${errorId}-title`}
          ref={inputRef}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {error && (
          <p id={errorId} className="field-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="submit">Save title</Button>
          <Button
            onClick={() => {
              setValue(card.title);
              finish();
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div>
      <h3>{card.title}</h3>
      {canEdit && (
        <Button
          ref={editButtonRef}
          onClick={() => {
            setValue(card.title);
            setEditing(true);
          }}
        >
          Edit title
        </Button>
      )}
    </div>
  );
}
