import { can } from '@kanban/shared';
import type { Workspace } from '@kanban/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, EmptyState, ErrorState, Spinner } from '../components';
import { CreateProjectDialog } from '../features/projects/CreateProjectDialog';
import { useProjects } from '../features/projects/api';
import { useWorkspace } from '../features/workspaces/api';

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
      <Projects workspace={workspace} />
    </>
  );
}

function Projects({ workspace }: { workspace: Workspace }) {
  const { data: projects, isPending, isError, error, refetch } = useProjects(workspace.id);
  const [creating, setCreating] = useState(false);
  const canCreate = can(workspace.role, 'project:manage');

  const createButton = canCreate ? (
    <Button onClick={() => setCreating(true)}>Create project</Button>
  ) : undefined;

  let content;
  if (isPending) {
    content = <Spinner label="Loading projects" />;
  } else if (isError) {
    content = (
      <ErrorState
        title="Projects unavailable"
        message={error.message}
        onRetry={() => void refetch()}
      />
    );
  } else if (projects.length === 0) {
    content = (
      <EmptyState
        title="No projects yet"
        description={
          canCreate
            ? 'A project has its own board, backlog and sprints.'
            : 'Ask a workspace owner or member to create the first project.'
        }
        action={createButton}
      />
    );
  } else {
    content = (
      <>
        <ul aria-label="Projects" className="workspace-list">
          {projects.map((project) => (
            <li key={project.id}>
              <Link to={`/projects/${project.id}`}>{project.name}</Link>{' '}
              <span>({project.key})</span>
            </li>
          ))}
        </ul>
        {createButton}
      </>
    );
  }

  return (
    <>
      <h2>Projects</h2>
      {content}
      {canCreate && (
        <CreateProjectDialog
          workspaceId={workspace.id}
          open={creating}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}
