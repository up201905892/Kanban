import { Link, useParams } from 'react-router';
import { ErrorState, Spinner } from '../components';
import { useWorkspace } from '../features/workspaces/api';

/** Placeholder landing page of a workspace; KB-008 lists its projects here. */
export function WorkspacePage() {
  const { id = '' } = useParams();
  const { data: workspace, isPending, isError, error, refetch } = useWorkspace(id);

  if (isPending) return <Spinner label="Loading workspace" />;
  if (isError) {
    return (
      <ErrorState
        title="Workspace unavailable"
        message={error.message}
        onRetry={() => void refetch()}
      />
    );
  }
  return (
    <>
      <h1>{workspace.name}</h1>
      <p>Your role: {workspace.role}.</p>
      <p>
        <Link to={`/workspaces/${workspace.id}/settings`}>Workspace settings</Link>
      </p>
    </>
  );
}
