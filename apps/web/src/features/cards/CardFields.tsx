import { useId, useState } from 'react';
import {
  CARD_ESTIMATE_MAX,
  CARD_ESTIMATE_MIN,
  CARD_PRIORITIES,
  cardEstimateSchema,
  cardPrioritySchema,
  type Card,
  type Member,
} from '@kanban/shared';
import { Select, TextField, useAnnounce } from '../../components';
import { useUpdateCard } from './api';
import { assignableMembers, priorityDisplay } from './fields';

export interface CardFieldsProps {
  projectId: string;
  card: Card;
  /** Everyone in the workspace; only owners and members are offered as assignees. */
  members: Member[];
  canEdit: boolean;
}

const UNASSIGNED = '';

/** Assignee, priority and estimate of a card: editable selects and a number input, or read-only text. */
export function CardFields({ projectId, card, members, canEdit }: CardFieldsProps) {
  const announce = useAnnounce();
  const update = useUpdateCard(projectId);
  const [estimate, setEstimate] = useState(card.estimate === null ? '' : String(card.estimate));
  const [estimateError, setEstimateError] = useState<string>();
  const [syncedEstimate, setSyncedEstimate] = useState(card.estimate);
  const headingId = useId();

  // Follow the server value (another save, a remote change, a rollback) unless the person has
  // typed something else in the field: a field being edited is never overwritten (KB-018).
  if (syncedEstimate !== card.estimate) {
    const untouched = estimate === (syncedEstimate === null ? '' : String(syncedEstimate));
    setSyncedEstimate(card.estimate);
    if (untouched) {
      setEstimate(card.estimate === null ? '' : String(card.estimate));
      setEstimateError(undefined);
    }
  }

  const assignee = members.find((m) => m.userId === card.assigneeId);
  const assigneeName = card.assigneeId ? (assignee?.name ?? 'Unknown member') : 'Unassigned';

  const save = (
    patch: Parameters<typeof update.mutate>[0]['patch'],
    saved: string,
    failed: string,
  ) => {
    update.mutate(
      { id: card.id, patch },
      {
        onSuccess: () => announce(saved),
        onError: (e) => announce(`${failed}: ${e.message}`, 'assertive'),
      },
    );
  };

  const options = assignableMembers(members).map((m) => ({ value: m.userId, label: m.name }));
  if (card.assigneeId && !options.some((o) => o.value === card.assigneeId)) {
    // Still assigned but no longer assignable (for example a demoted member): keep it visible.
    options.push({ value: card.assigneeId, label: assigneeName });
  }

  if (!canEdit) {
    return (
      <section aria-labelledby={headingId}>
        <h3 id={headingId}>Details</h3>
        <dl className="card-fields">
          <dt>Assignee</dt>
          <dd>{assigneeName}</dd>
          <dt>Priority</dt>
          <dd>
            <span aria-hidden="true">{priorityDisplay(card.priority).icon}</span>{' '}
            {priorityDisplay(card.priority).label}
          </dd>
          <dt>Estimate</dt>
          <dd>{card.estimate === null ? 'Not estimated' : `${card.estimate} points`}</dd>
        </dl>
      </section>
    );
  }

  const commitEstimate = () => {
    const text = estimate.trim();
    if (text === '') {
      setEstimateError(undefined);
      if (card.estimate !== null) {
        save({ estimate: null }, 'Estimate cleared', 'Could not clear the estimate');
      }
      return;
    }
    const parsed = cardEstimateSchema.safeParse(Number(text));
    if (!parsed.success) {
      setEstimateError(parsed.error.issues[0]?.message ?? 'Invalid estimate');
      return;
    }
    setEstimateError(undefined);
    if (parsed.data !== card.estimate) {
      save(
        { estimate: parsed.data },
        `Estimate set to ${parsed.data} points`,
        'Could not save the estimate',
      );
    }
  };

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>Details</h3>
      <Select
        label="Assignee"
        value={card.assigneeId ?? UNASSIGNED}
        options={[{ value: UNASSIGNED, label: 'Unassigned' }, ...options]}
        onChange={(event) => {
          const value = event.target.value;
          const name = options.find((o) => o.value === value)?.label;
          save(
            { assigneeId: value === UNASSIGNED ? null : value },
            value === UNASSIGNED ? 'Card unassigned' : `Card assigned to ${name ?? 'a member'}`,
            'Could not change the assignee',
          );
        }}
      />
      <Select
        label="Priority"
        value={card.priority}
        options={CARD_PRIORITIES.map((p) => ({ value: p, label: priorityDisplay(p).label }))}
        onChange={(event) => {
          const parsed = cardPrioritySchema.safeParse(event.target.value);
          if (!parsed.success) return;
          save(
            { priority: parsed.data },
            `Priority set to ${priorityDisplay(parsed.data).label}`,
            'Could not change the priority',
          );
        }}
      />
      <div>
        <TextField
          label="Estimate (story points)"
          type="number"
          inputMode="numeric"
          min={CARD_ESTIMATE_MIN}
          max={CARD_ESTIMATE_MAX}
          step={1}
          hint={`Whole number from ${CARD_ESTIMATE_MIN} to ${CARD_ESTIMATE_MAX}, or empty`}
          value={estimate}
          error={estimateError}
          onChange={(event) => setEstimate(event.target.value)}
          onBlur={() => commitEstimate()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Saves like blur does; no form, so Enter never submits anything else.
              event.preventDefault();
              commitEstimate();
            }
          }}
        />
      </div>
    </section>
  );
}
