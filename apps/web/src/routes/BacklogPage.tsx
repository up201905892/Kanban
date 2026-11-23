import { Link, useParams } from 'react-router';
import { can } from '@kanban/shared';
import { ErrorState, Spinner } from '../components';
import { useProject } from '../features/projects/api';
import { BacklogView } from '../features/sprints/BacklogView';
import { useWorkspace } from '../features/workspaces/api';

/** Backlog and sprint planning of one project. */
export function BacklogPage() {
  const { pid = '' } = useParams();
  const { data: project, isPending, isError, error, refetch } = useProject(pid);
  const { data: workspace } = useWorkspace(project?.workspaceId ?? '');

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
  if (!workspace) return <Spinner label="Loading backlog" />;
  return (
    <>
      <p>
        <Link to={`/workspaces/${project.workspaceId}`}>Back to the workspace</Link>
      </p>
      <BacklogView
        project={project}
        canManage={can(workspace.role, 'board:manage')}
        canEditCards={can(workspace.role, 'card:edit')}
      />
    </>
  );
}
