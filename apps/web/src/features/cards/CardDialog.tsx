import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  CARD_DESCRIPTION_MAX_LENGTH,
  cardDescriptionSchema,
  cardReference,
  cardTitleSchema,
  type Card,
  type CardSummary,
} from '@kanban/shared';
import { Button, Dialog, ErrorState, Spinner, TextArea, useAnnounce } from '../../components';
import { useCard, useUpdateCard } from './api';
import { Markdown } from './Markdown';

export interface CardDialogProps {
  projectId: string;
  projectKey: string;
  /** The card named by the address, or undefined when the board has no such card. */
  summary: CardSummary | undefined;
  /** Owners and members (`card:edit`); viewers get a read-only dialog. */
  canEdit: boolean;
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
  canEdit,
  number,
  onClose,
  onDelete,
}: CardDialogProps) {
  const reference = cardReference(projectKey, number);
  if (!summary) {
    return (
      <Dialog open onClose={onClose} title={`Card ${reference}`}>
        <p>This card does not exist or was deleted.</p>
        <div className="dialog-actions">
          <Button onClick={onClose}>Close</Button>
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
  onClose: () => void;
  onDelete: (card: CardSummary) => void;
}

function CardDetail({
  projectId,
  reference,
  summary,
  canEdit,
  onClose,
  onDelete,
}: CardDetailProps) {
  const card = useCard(summary.id);
  const [confirming, setConfirming] = useState(false);
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
          <DescriptionSection projectId={projectId} card={card.data} canEdit={canEdit} />
        </>
      )}
      <div className="dialog-actions">
        {canEdit && <Button onClick={() => setConfirming(true)}>Delete card</Button>}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
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

/** Markdown description: rendered for everyone; editors get Edit/Preview and an explicit Save. */
function DescriptionSection({ projectId, card, canEdit }: SectionProps) {
  const announce = useAnnounce();
  const update = useUpdateCard(projectId);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState(card.description);
  const [error, setError] = useState<string>();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useLayoutEffect(() => {
    if (editing && !preview) areaRef.current?.focus();
  }, [editing, preview]);

  useLayoutEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  const stop = () => {
    refocus.current = true;
    setEditing(false);
    setPreview(false);
    setError(undefined);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const parsed = cardDescriptionSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid description');
      setPreview(false);
      return;
    }
    if (parsed.data === card.description) {
      stop();
      return;
    }
    update.mutate(
      { id: card.id, patch: { description: parsed.data } },
      {
        onSuccess: () => {
          stop();
          announce('Card description saved');
        },
        onError: (e) => {
          setError(e.message);
          announce(`Could not save the description: ${e.message}`, 'assertive');
        },
      },
    );
  };

  if (!editing) {
    return (
      <section aria-label="Description">
        <h3>Description</h3>
        {card.description.trim() === '' ? (
          <p>No description yet.</p>
        ) : (
          <Markdown source={card.description} />
        )}
        {canEdit && (
          <Button
            ref={editButtonRef}
            onClick={() => {
              setDraft(card.description);
              setEditing(true);
            }}
          >
            Edit description
          </Button>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Description">
      <h3>Description</h3>
      <form
        onSubmit={save}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            stop();
          }
        }}
      >
        <div role="group" aria-label="Description mode" className="dialog-actions">
          <Button aria-pressed={!preview} onClick={() => setPreview(false)}>
            Edit
          </Button>
          <Button aria-pressed={preview} onClick={() => setPreview(true)}>
            Preview
          </Button>
        </div>
        {preview ? (
          <div aria-label="Description preview" role="group">
            {draft.trim() === '' ? <p>Nothing to preview.</p> : <Markdown source={draft} />}
          </div>
        ) : (
          <TextArea
            ref={areaRef}
            label="Description (Markdown)"
            hint={`${draft.length} of ${CARD_DESCRIPTION_MAX_LENGTH} characters`}
            rows={8}
            value={draft}
            error={error}
            onChange={(event) => setDraft(event.target.value)}
          />
        )}
        {preview && error && <p className="field-error">{error}</p>}
        <div className="dialog-actions">
          <Button type="submit" disabled={update.isPending}>
            Save
          </Button>
          <Button onClick={stop}>Cancel</Button>
        </div>
      </form>
    </section>
  );
}
