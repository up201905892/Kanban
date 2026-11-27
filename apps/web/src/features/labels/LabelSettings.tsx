import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import {
  LABEL_COLORS,
  LABEL_NAME_MAX_LENGTH,
  createLabelRequestSchema,
  labelColorSchema,
  updateLabelRequestSchema,
  type Label,
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
import { useBoard } from '../board/api';
import { useCreateLabel, useDeleteLabel, useUpdateLabel } from './api';
import { LabelChip } from './LabelChip';
import { COLOR_NAMES } from './labels';

const COLOR_OPTIONS = LABEL_COLORS.map((c) => ({ value: c, label: COLOR_NAMES[c] }));

/** Label management of a project (owners and members). Viewers see the list only. */
export function LabelSettings({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const board = useBoard(projectId);
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Labels</h2>
      {board.isPending && <Spinner label="Loading labels" />}
      {board.isError && (
        <ErrorState
          title="Labels unavailable"
          message={board.error.message}
          onRetry={() => void board.refetch()}
        />
      )}
      {board.data && (
        <>
          {canManage && <CreateLabelForm projectId={projectId} />}
          {board.data.labels.length === 0 ? (
            <EmptyState
              title="No labels yet"
              description={
                canManage
                  ? 'Create a label above, then add it to cards.'
                  : 'Owners and members can create labels.'
              }
            />
          ) : (
            <ul className="label-settings-list">
              {board.data.labels.map((label) => (
                <li key={label.id}>
                  {canManage ? (
                    <LabelRow projectId={projectId} label={label} />
                  ) : (
                    <LabelChip label={label} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function CreateLabelForm({ projectId }: { projectId: string }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(LABEL_COLORS[0]);
  const [error, setError] = useState<string>();
  const create = useCreateLabel(projectId);
  const announce = useAnnounce();
  const nameId = useId();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const parsed = createLabelRequestSchema.safeParse({ name, color });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid label');
      document.getElementById(nameId)?.focus();
      return;
    }
    // The client id makes a retry of the same create safe (A6).
    create.mutate(
      { ...parsed.data, id: crypto.randomUUID() },
      {
        onSuccess: ({ label }) => {
          setName('');
          announce(`Label ${label.name} created`);
        },
        onError: (e) => {
          setError(e.message);
          announce(`Could not create the label: ${e.message}`, 'assertive');
          document.getElementById(nameId)?.focus();
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Create label" className="label-form">
      <TextField
        id={nameId}
        label="New label name"
        name="name"
        autoComplete="off"
        maxLength={LABEL_NAME_MAX_LENGTH * 2}
        hint={`Up to ${LABEL_NAME_MAX_LENGTH} characters, unique in this project`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        {...(error && { error })}
      />
      <Select
        label="Color"
        value={color}
        options={COLOR_OPTIONS}
        onChange={(e) => setColor(e.target.value)}
      />
      <Button type="submit">Create label</Button>
    </form>
  );
}

function LabelRow({ projectId, label }: { projectId: string; label: Label }) {
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState<string>(label.color);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const update = useUpdateLabel(projectId);
  const remove = useDeleteLabel(projectId);
  const announce = useAnnounce();
  const nameId = useId();
  const board = useBoard(projectId);
  const inUse = board.data?.cards.filter((c) => c.labelIds.includes(label.id)).length ?? 0;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const colorParsed = labelColorSchema.safeParse(color);
    const parsed = updateLabelRequestSchema.safeParse({
      name,
      ...(colorParsed.success && { color: colorParsed.data }),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid label');
      document.getElementById(nameId)?.focus();
      return;
    }
    update.mutate(
      { id: label.id, patch: parsed.data },
      {
        onSuccess: ({ label: saved }) => {
          setName(saved.name);
          announce(`Label ${saved.name} saved`);
        },
        onError: (e) => {
          setName(label.name);
          setColor(label.color);
          setError(e.message);
          announce(`Could not save the label: ${e.message}`, 'assertive');
          document.getElementById(nameId)?.focus();
        },
      },
    );
  }

  function confirmDelete() {
    setConfirming(false);
    remove.mutate(label.id, {
      onSuccess: () => announce(`Label ${label.name} deleted`),
      onError: (e) => announce(`Could not delete the label: ${e.message}`, 'assertive'),
    });
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label={`Edit label ${label.name}`}
        className="label-form"
      >
        <LabelChip label={{ name, color: labelColorSchema.catch(label.color).parse(color) }} />
        <TextField
          id={nameId}
          label="Name"
          name="name"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          {...(error && { error })}
        />
        <Select
          label="Color"
          value={color}
          options={COLOR_OPTIONS}
          onChange={(e) => setColor(e.target.value)}
        />
        <Button type="submit">Save label</Button>
        <Button onClick={() => setConfirming(true)}>Delete label</Button>
      </form>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete label ${label.name}?`}
      >
        <p>
          {inUse === 0
            ? 'No card uses this label.'
            : `It is removed from ${inUse} ${inUse === 1 ? 'card' : 'cards'}.`}{' '}
          This cannot be undone.
        </p>
        <div className="dialog-actions">
          <Button onClick={confirmDelete}>Delete label</Button>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      </Dialog>
    </>
  );
}
