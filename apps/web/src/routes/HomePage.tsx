import { APP_NAME } from '@kanban/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button, EmptyState, ErrorState, Spinner } from '../components';
import { CreateWorkspaceDialog } from '../features/workspaces/CreateWorkspaceDialog';
import { useWorkspaces } from '../features/workspaces/api';

export function HomePage() {
  const { data: workspaces, isPending, isError, error, refetch } = useWorkspaces();
  const [creating, setCreating] = useState(false);

  const createButton = <Button onClick={() => setCreating(true)}>Create workspace</Button>;

  let content;
  if (isPending) {
    content = <Spinner label="Loading workspaces" />;
  } else if (isError) {
    content = <ErrorState message={error.message} onRetry={() => void refetch()} />;
  } else if (workspaces.length === 0) {
    content = (
      <EmptyState
        title="No workspaces yet"
        description="A workspace holds your projects and the people you work with."
        action={createButton}
      />
    );
  } else {
    content = (
      <>
        <ul aria-label="Workspaces" className="workspace-list">
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <Link to={`/workspaces/${workspace.id}`}>{workspace.name}</Link>{' '}
              <span>({workspace.role})</span>
            </li>
          ))}
        </ul>
        {createButton}
      </>
    );
  }

  return (
    <>
      <h1>{APP_NAME}</h1>
      <h2>Your workspaces</h2>
      {content}
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
