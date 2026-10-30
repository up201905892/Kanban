import { Link, useParams } from 'react-router';
import { ErrorState, Spinner } from '../components';
import { useProject } from '../features/projects/api';

/** Placeholder landing page of a project; KB-011 puts the board here. */
export function ProjectPage() {
  const { pid = '' } = useParams();
  const { data: project, isPending, isError, error, refetch } = useProject(pid);

  if (isPending) return <Spinner label="Loading project" />;
  if (isError) {
    return (
      <ErrorState
        title="Project unavailable"
        message={error.message}
        onRetry={() => void refetch()}
      />
    );
  }
  return (
    <>
      <p>
        <Link to={`/workspaces/${project.workspaceId}`}>Back to the workspace</Link>
      </p>
      <h1>{project.name}</h1>
      <p>Key: {project.key}</p>
      <p>The board is coming soon.</p>
      <p>
        <Link to={`/projects/${project.id}/settings`}>Project settings</Link>
      </p>
    </>
  );
}
