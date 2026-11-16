import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { cardReference, type CardSummary, type Project, type Sprint } from '@kanban/shared';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Select,
  Spinner,
  useAnnounce,
} from '../../components';
import { useBoard } from '../board/api';
import { useBoardEvents } from '../board/useBoardEvents';
import { SprintDialog } from './SprintDialog';
import { useSetCardSprint, useStartSprint } from './api';
import {
  backlogCards,
  dateRangeLabel,
  defaultTargetSprint,
  pointsLabel,
  pointsOf,
  sprintCards,
} from './planning';

const estimateLabel = (card: CardSummary) =>
  card.estimate === null
    ? 'not estimated'
    : `${card.estimate} ${card.estimate === 1 ? 'pt' : 'pts'}`;

export interface BacklogViewProps {
  project: Project;
  /** Owners and members create, edit and start sprints. */
  canManage: boolean;
  /** Owners and members move cards between the backlog and sprints. */
  canEditCards: boolean;
}

/** The backlog (cards in no sprint) and one section per planned or active sprint. */
export function BacklogView({ project, canManage, canEditCards }: BacklogViewProps) {
  const announce = useAnnounce();
  const board = useBoard(project.id);
  const boardId = board.data?.board.id ?? '';
  // Other people's changes (cards added to sprints, sprints started) arrive over the board room.
  useBoardEvents(project.id, boardId);
  const setSprint = useSetCardSprint(project.id);
  const startSprint = useStartSprint(project.id);
  const backlogHeadingId = useId();
  const [editing, setEditing] = useState<Sprint | 'new' | null>(null);
  const [starting, setStarting] = useState<Sprint | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const data = board.data;
  const cards = useMemo(() => data?.cards ?? [], [data]);
  const sprints = useMemo(() => data?.sprints ?? [], [data]);

  if (board.isPending) return <Spinner label="Loading backlog" />;
  if (board.isError) {
    return (
      <ErrorState
        title="Backlog unavailable"
        message={board.error.message}
        onRetry={() => void board.refetch()}
      />
    );
  }

  const active = sprints.find((s) => s.status === 'active');
  const backlog = backlogCards(cards);
  const createButton = canManage ? (
    <Button onClick={() => setEditing('new')}>Create sprint</Button>
  ) : null;

  const focusHeading = (id: string) => document.getElementById(id)?.focus();

  function add(card: CardSummary, sprint: Sprint) {
    const reference = cardReference(project.key, card.number);
    // The card's row is about to disappear: park focus on the heading of its section first.
    focusHeading(backlogHeadingId);
    setSprint.mutate(
      { id: card.id, sprintId: sprint.id },
      {
        onSuccess: () => announce(`Card ${reference} added to ${sprint.name}`),
        onError: (error) =>
          announce(
            `Could not add card ${reference} to ${sprint.name}: ${error.message}`,
            'assertive',
          ),
      },
    );
  }

  function remove(card: CardSummary, sprint: Sprint) {
    const reference = cardReference(project.key, card.number);
    focusHeading(sprintHeadingId(sprint.id));
    setSprint.mutate(
      { id: card.id, sprintId: null },
      {
        onSuccess: () => announce(`Card ${reference} removed from ${sprint.name}`),
        onError: (error) =>
          announce(
            `Could not remove card ${reference} from ${sprint.name}: ${error.message}`,
            'assertive',
          ),
      },
    );
  }

  function confirmStart() {
    const sprint = starting;
    if (!sprint) return;
    setStartError(null);
    startSprint.mutate(
      { id: sprint.id },
      {
        onSuccess: () => {
          setStarting(null);
          announce(`Sprint ${sprint.name} started`);
        },
        onError: (error) => {
          setStartError(error.message);
          announce(`Could not start the sprint: ${error.message}`, 'assertive');
        },
      },
    );
  }

  return (
    <>
      <p>
        <Link to={`/projects/${project.id}`}>Back to the board</Link>
      </p>
      <div className="backlog-toolbar">
        <h1>Backlog: {project.name}</h1>
        {createButton}
      </div>
      {sprints.length === 0 && (
        <EmptyState
          title="No sprints yet"
          description={
            canManage
              ? 'Create a sprint to plan work with dates and a goal.'
              : 'Nobody has planned a sprint yet.'
          }
        />
      )}
      {sprints.map((sprint) => {
        const inSprint = sprintCards(cards, sprint.id);
        return (
          <section
            key={sprint.id}
            className="sprint-section"
            aria-labelledby={sprintHeadingId(sprint.id)}
          >
            <header>
              <h2 id={sprintHeadingId(sprint.id)} tabIndex={-1}>
                {sprint.name}
              </h2>
              <p>
                {sprint.status === 'active' ? 'Active' : 'Planned'} ·{' '}
                {dateRangeLabel(sprint.startDate, sprint.endDate)} ·{' '}
                {pointsLabel(pointsOf(inSprint))}
              </p>
              {sprint.goal && <p>Goal: {sprint.goal}</p>}
              {canManage && (
                <div className="dialog-actions">
                  <Button onClick={() => setEditing(sprint)}>Edit sprint {sprint.name}</Button>
                  {sprint.status === 'planned' && (
                    <Button
                      disabled={active !== undefined}
                      aria-describedby={active ? `${sprint.id}-start-hint` : undefined}
                      onClick={() => {
                        setStartError(null);
                        setStarting(sprint);
                      }}
                    >
                      Start sprint {sprint.name}
                    </Button>
                  )}
                </div>
              )}
              {canManage && sprint.status === 'planned' && active && (
                <p id={`${sprint.id}-start-hint`}>
                  {active.name} is active. Only one sprint can be active at a time.
                </p>
              )}
            </header>
            {inSprint.length === 0 ? (
              <p>No cards in this sprint yet. Add cards from the backlog below.</p>
            ) : (
              <ul className="backlog-list">
                {inSprint.map((card) => (
                  <li key={card.id} className="backlog-card">
                    <CardLine project={project} card={card} />
                    {canEditCards && (
                      <Button
                        aria-label={`Remove from sprint: ${cardReference(project.key, card.number)}`}
                        onClick={() => remove(card, sprint)}
                      >
                        Remove from sprint
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <section className="sprint-section" aria-labelledby={backlogHeadingId}>
        <header>
          <h2 id={backlogHeadingId} tabIndex={-1}>
            Backlog
          </h2>
          <p>
            {backlog.length} {backlog.length === 1 ? 'card' : 'cards'} ·{' '}
            {pointsLabel(pointsOf(backlog))}
          </p>
        </header>
        {backlog.length === 0 ? (
          <p>The backlog is empty. Every card is in a sprint.</p>
        ) : (
          <ul className="backlog-list">
            {backlog.map((card) => (
              <li key={card.id} className="backlog-card">
                <CardLine project={project} card={card} />
                {canEditCards && (
                  <AddToSprint
                    reference={cardReference(project.key, card.number)}
                    sprints={sprints}
                    onAdd={(sprint) => add(card, sprint)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <SprintDialog
        projectId={project.id}
        open={editing !== null}
        sprint={editing === 'new' ? undefined : (editing ?? undefined)}
        onClose={() => setEditing(null)}
      />
      <Dialog
        open={starting !== null}
        onClose={() => setStarting(null)}
        title={`Start ${starting?.name ?? 'sprint'}?`}
      >
        {starting && (
          <StartBody
            sprint={starting}
            cards={sprintCards(cards, starting.id)}
            error={startError}
            pending={startSprint.isPending}
            onConfirm={confirmStart}
            onCancel={() => setStarting(null)}
          />
        )}
      </Dialog>
    </>
  );
}

const sprintHeadingId = (sprintId: string) => `sprint-heading-${sprintId}`;

function CardLine({ project, card }: { project: Project; card: CardSummary }) {
  const reference = cardReference(project.key, card.number);
  return (
    <span className="backlog-card-line">
      <Link to={`/projects/${project.id}/cards/${card.number}`}>
        {reference} {card.title}
      </Link>{' '}
      <span>({estimateLabel(card)})</span>
    </span>
  );
}

/** A select and a button: choosing never acts by itself, so arrow keys cannot add a card by accident. */
function AddToSprint({
  reference,
  sprints,
  onAdd,
}: {
  reference: string;
  sprints: readonly Sprint[];
  onAdd: (sprint: Sprint) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  if (sprints.length === 0) return null;
  const selected = sprints.find((s) => s.id === choice) ?? defaultTargetSprint(sprints);
  return (
    <span className="add-to-sprint">
      <Select
        label={`Sprint for ${reference}`}
        value={selected?.id ?? ''}
        onChange={(e) => setChoice(e.target.value)}
        options={sprints.map((s) => ({
          value: s.id,
          label: s.status === 'active' ? `${s.name} (active)` : s.name,
        }))}
      />
      <Button
        aria-label={`Add to sprint: ${reference}`}
        onClick={() => selected && onAdd(selected)}
      >
        Add to sprint
      </Button>
    </span>
  );
}

function StartBody({
  sprint,
  cards,
  error,
  pending,
  onConfirm,
  onCancel,
}: {
  sprint: Sprint;
  cards: readonly CardSummary[];
  error: string | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <p>
        {cards.length} {cards.length === 1 ? 'card' : 'cards'}, {pointsLabel(pointsOf(cards))} will
        be committed. Only one sprint can be active at a time.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button onClick={onConfirm} disabled={pending}>
          Start sprint
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
      {pending && <Spinner label={`Starting ${sprint.name}`} />}
    </>
  );
}
