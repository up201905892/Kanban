import { useLayoutEffect, useRef, useState } from 'react';
import { cardTitleSchema } from '@kanban/shared';
import { Button, TextField } from '../../components';

export const addCardButtonId = (columnId: string) => `add-card-${columnId}`;

export interface AddCardProps {
  columnId: string;
  columnName: string;
  onAdd: (title: string) => void;
}

/**
 * "Add card" at the bottom of a column. Enter creates the card and keeps the field open and focused
 * for the next one; Escape (or Cancel) closes it and returns focus to the button.
 */
export function AddCard({ columnId, columnName, onAdd }: AddCardProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setTitle('');
    setError(undefined);
    // The button is re-rendered after the form closes; focus it on the next frame.
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  if (!open) {
    return (
      <button
        ref={buttonRef}
        id={addCardButtonId(columnId)}
        type="button"
        aria-label={`Add card to ${columnName}`}
        onClick={() => setOpen(true)}
      >
        Add card
      </button>
    );
  }

  return (
    <form
      aria-label={`Add card to ${columnName}`}
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = cardTitleSchema.safeParse(title);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Invalid title');
          inputRef.current?.focus();
          return;
        }
        onAdd(parsed.data);
        setTitle('');
        setError(undefined);
        inputRef.current?.focus();
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
        label="Card title"
        value={title}
        error={error}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="dialog-actions">
        <Button type="submit">Add</Button>
        <Button onClick={close}>Done</Button>
      </div>
    </form>
  );
}
