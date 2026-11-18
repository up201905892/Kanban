import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { burndownSummary, toCalendarDate, type Project, type Sprint } from '@kanban/shared';
import { Button, EmptyState, ErrorState, Spinner } from '../../components';
import { useBoard } from '../board/api';
import { useBoardEvents } from '../board/useBoardEvents';
import { burndownKey, useBurndown } from './api';
import { burndownRows, hasNoEstimates } from './chart-data';

const cell = (value: number | null) => (value === null ? '–' : String(value));

function BurndownReport({ sprint }: { sprint: Sprint }) {
  const { data, isPending, isError, error, refetch } = useBurndown(sprint.id);
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
  if (isPending) return <Spinner label="Loading burndown" />;
  if (isError) {
    return (
      <ErrorState
        title="Burndown unavailable"
        message={error.message}
        onRetry={() => void refetch()}
      />
    );
  }
  if (hasNoEstimates(data)) {
    return (
      <EmptyState
        title="No estimated cards"
        description={
          data.unestimatedCount > 0
            ? `${data.unestimatedCount} ${data.unestimatedCount === 1 ? 'card has' : 'cards have'} no estimate yet. Add story points to the cards of ${sprint.name} to see the burndown.`
            : `Add cards with story points to ${sprint.name} to see the burndown.`
        }
      />
    );
  }

  const rows = burndownRows(data);
  const last = data.days.at(-1);
  const summary = burndownSummary(sprint, last, toCalendarDate(new Date()));
  return (
    <>
      <p>{summary}</p>
      {data.unestimatedCount > 0 && (
        <p>
          {data.unestimatedCount} {data.unestimatedCount === 1 ? 'card is' : 'cards are'} not
          estimated and count as 0 points.
        </p>
      )}
      <Button aria-pressed={asTable} aria-controls={tableId} onClick={() => setAsTable((v) => !v)}>
        {asTable ? 'Show as chart' : 'Show as table'}
      </Button>
      <div id={tableId}>
        {asTable ? (
          <table>
            <caption>Burndown of {sprint.name}: points by day (UTC), with the ideal line</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Remaining points</th>
                <th scope="col">Scope points</th>
                <th scope="col">Ideal points</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date}>
                  <th scope="row">{row.date}</th>
                  <td>{cell(row.remaining)}</td>
                  <td>{cell(row.scope)}</td>
                  <td>{row.ideal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div
            role="img"
            aria-label={`Burndown chart. ${summary}. Use "Show as table" for the values.`}
          >
            <ResponsiveContainer
              width="100%"
              height={300}
              initialDimension={{ width: 600, height: 300 }}
            >
              <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="remaining"
                  name="Remaining"
                  stroke="#1d4ed8"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="ideal"
                  name="Ideal"
                  stroke="#4b5563"
                  strokeDasharray="5 5"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </>
  );
}

/** Reports page content: the burndown of the project's active sprint. */
export function BurndownView({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const board = useBoard(project.id);
  const boardId = board.data?.board.id ?? '';
  // Cards that move, change estimate or join the sprint arrive over the board room.
  useBoardEvents(project.id, boardId);
  const active = board.data?.sprints.find((s) => s.status === 'active');
  const activeId = active?.id;
  const updatedAt = board.dataUpdatedAt;
  useEffect(() => {
    if (activeId) void queryClient.invalidateQueries({ queryKey: burndownKey(activeId) });
  }, [queryClient, activeId, updatedAt]);

  if (board.isPending) return <Spinner label="Loading reports" />;
  if (board.isError) {
    return (
      <ErrorState
        title="Reports unavailable"
        message={board.error.message}
        onRetry={() => void board.refetch()}
      />
    );
  }
  return (
    <section aria-labelledby="burndown-heading">
      <h1 id="burndown-heading">Reports: {project.name}</h1>
      {active ? (
        <>
          <h2>Burndown of {active.name}</h2>
          <BurndownReport sprint={active} />
        </>
      ) : (
        <EmptyState
          title="No active sprint"
          description="Start a sprint to see its burndown."
          action={<Link to={`/projects/${project.id}/backlog`}>Go to the backlog</Link>}
        />
      )}
    </section>
  );
}
