import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  SPRINT_GOAL_MAX_LENGTH,
  SPRINT_NAME_MAX_LENGTH,
  createSprintRequestSchema,
  type Sprint,
} from '@kanban/shared';
import { Button, Dialog, TextArea, TextField, useAnnounce } from '../../components';
import { failureFromError, fieldErrorsFromZod } from '../auth/form-errors';
import { useAuthForm } from '../auth/useAuthForm';
import { localToday } from './planning';
import { useCreateSprint, useUpdateSprint } from './api';

const FIELDS = ['name', 'startDate', 'endDate', 'goal'] as const;

/** `date` plus `days` calendar days (UTC arithmetic, so daylight saving cannot shift it). */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  return result.toISOString().slice(0, 10);
}

export interface SprintDialogProps {
  projectId: string;
  open: boolean;
  /** The sprint being edited; without it the dialog creates a sprint. */
  sprint?: Sprint | undefined;
  onClose: () => void;
}

export function SprintDialog({ projectId, open, sprint, onClose }: SprintDialogProps) {
  // The body remounts on every open, so its fields always start from the sprint (or the defaults).
  return (
    <Dialog open={open} onClose={onClose} title={sprint ? 'Edit sprint' : 'Create sprint'}>
      <SprintForm projectId={projectId} sprint={sprint} onClose={onClose} />
    </Dialog>
  );
}

function SprintForm({
  projectId,
  sprint,
  onClose,
}: {
  projectId: string;
  sprint: Sprint | undefined;
  onClose: () => void;
}) {
  const today = localToday();
  const [name, setName] = useState(sprint?.name ?? '');
  const [goal, setGoal] = useState(sprint?.goal ?? '');
  const [startDate, setStartDate] = useState(sprint?.startDate ?? today);
  const [endDate, setEndDate] = useState(sprint?.endDate ?? addDays(today, 13));
  const create = useCreateSprint(projectId);
  const update = useUpdateSprint(projectId);
  const announce = useAnnounce();
  const { failure, fail, clear, registerField } = useAuthForm(FIELDS);
  const pending = create.isPending || update.isPending;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    clear();
    const parsed = createSprintRequestSchema.safeParse({ name, goal, startDate, endDate });
    if (!parsed.success) {
      fail({ fields: fieldErrorsFromZod(parsed.error, FIELDS) });
      return;
    }
    const { name: cleanName, goal: cleanGoal = '' } = parsed.data;
    const done = (message: string) => () => {
      announce(message);
      onClose();
    };
    const onError = (error: Error) => fail(failureFromError(error, FIELDS));
    if (sprint) {
      update.mutate(
        {
          id: sprint.id,
          patch: { name: cleanName, goal: cleanGoal, startDate, endDate },
        },
        { onSuccess: done(`Sprint ${cleanName} saved`), onError },
      );
    } else {
      create.mutate(
        { id: crypto.randomUUID(), name: cleanName, goal: cleanGoal, startDate, endDate },
        { onSuccess: done(`Sprint ${cleanName} created`), onError },
      );
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label={sprint ? 'Edit sprint' : 'Create sprint'}>
      <TextField
        ref={registerField('name')}
        label="Name"
        name="name"
        autoComplete="off"
        maxLength={SPRINT_NAME_MAX_LENGTH + 20}
        value={name}
        onChange={(e) => setName(e.target.value)}
        {...(failure.fields.name && { error: failure.fields.name })}
      />
      <TextField
        ref={registerField('startDate')}
        label="Start date"
        name="startDate"
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        {...(failure.fields.startDate && { error: failure.fields.startDate })}
      />
      <TextField
        ref={registerField('endDate')}
        label="End date"
        name="endDate"
        type="date"
        value={endDate}
        onChange={(e) => setEndDate(e.target.value)}
        {...(failure.fields.endDate && { error: failure.fields.endDate })}
      />
      <TextArea
        label="Goal (optional)"
        name="goal"
        rows={3}
        hint={`Up to ${SPRINT_GOAL_MAX_LENGTH} characters.`}
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        {...(failure.fields.goal && { error: failure.fields.goal })}
      />
      {failure.form && <p className="form-error">{failure.form}</p>}
      <div className="dialog-actions">
        <Button type="submit" disabled={pending}>
          {sprint ? 'Save' : 'Create'}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}
