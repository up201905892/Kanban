import { Link, useParams } from 'react-router';
import { ErrorState, Spinner } from '../components';
import { useProject } from '../features/projects/api';
import { BurndownView } from '../features/reports/BurndownView';
import { VelocityView } from '../features/reports/VelocityView';

/** Reports of one project (the burndown of the active sprint). */
export function ReportsPage() {
  const { pid = '' } = useParams();
  const { data: project, isPending, isError, error, refetch } = useProject(pid);
  if (isPending) return <Spinner label="Loading project" />;
  if (isError) {
    return (
      <ErrorState
        headingLevel={1}
        title="Project unavailable"
        message={error.message}
        onRetry={() => void refetch()}
      />
    );
  }
  return (
    <>
      <p>
        <Link to={`/projects/${project.id}`}>Back to the board</Link>
      </p>
      <BurndownView project={project} />
      <section aria-labelledby="velocity-heading">
        <h2 id="velocity-heading">Velocity</h2>
        <VelocityView project={project} />
      </section>
    </>
  );
}
