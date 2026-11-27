import { useId, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { velocitySummary, type Project } from '@kanban/shared';
import { Button, EmptyState, ErrorState, Spinner } from '../../components';
import { useVelocity } from './api';

/** Reports page section: committed vs completed points of the last closed sprints. */
export function VelocityView({ project }: { project: Project }) {
  const { data, isPending, isError, error, refetch } = useVelocity(project.id);
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
  if (isPending) return <Spinner label="Loading velocity" />;
  if (isError) {
    return (
      <ErrorState
        title="Velocity unavailable"
        message={error.message}
        onRetry={() => void refetch()}
      />
    );
  }
  if (data.sprints.length === 0) {
    return (
      <EmptyState
        title="Close a sprint to see velocity"
        description="Velocity compares the points committed and completed in each closed sprint."
      />
    );
  }
  const summary = velocitySummary(data);
  return (
    <>
      <p>{summary}</p>
      <Button aria-pressed={asTable} aria-controls={tableId} onClick={() => setAsTable((v) => !v)}>
        {asTable ? 'Show velocity as chart' : 'Show velocity as table'}
      </Button>
      <div id={tableId}>
        {asTable ? (
          <table>
            <caption>Velocity: points committed and completed per closed sprint</caption>
            <thead>
              <tr>
                <th scope="col">Sprint</th>
                <th scope="col">Committed points</th>
                <th scope="col">Completed points</th>
              </tr>
            </thead>
            <tbody>
              {data.sprints.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.name}</th>
                  <td>{s.committedPoints}</td>
                  <td>{s.completedPoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div
            role="img"
            aria-label={`Velocity chart. ${summary}. Use "Show velocity as table" for the values.`}
          >
            <ResponsiveContainer
              width="100%"
              height={300}
              initialDimension={{ width: 600, height: 300 }}
            >
              <BarChart data={data.sprints} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="committedPoints"
                  name="Committed"
                  fill="#4b5563"
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="completedPoints"
                  name="Completed"
                  fill="#1d4ed8"
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </>
  );
}
