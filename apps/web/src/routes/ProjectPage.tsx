import { Link, useNavigate, useParams } from 'react-router';
import { can } from '@kanban/shared';
import { ErrorState, Spinner } from '../components';
import { BoardView } from '../features/board/BoardView';
import { useProject } from '../features/projects/api';
import { useWorkspace } from '../features/workspaces/api';

/** Landing page of a project: its name and the board. */
export function ProjectPage() {
  const { pid = '', number } = useParams();
  const navigate = useNavigate();
  // `/projects/:pid/cards/:number` opens the card dialog over the board (deep link).
  const parsedNumber = number === undefined ? undefined : Number(number);
  const openCardNumber =
    parsedNumber !== undefined && Number.isInteger(parsedNumber) && parsedNumber > 0
      ? parsedNumber
      : undefined;
  const { data: project, isPending, isError, error, refetch } = useProject(pid);
  // The role decides whether the board is editable (the server enforces it either way).
  const { data: workspace } = useWorkspace(project?.workspaceId ?? '');

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
      <p>
        <Link to={`/projects/${project.id}/settings`}>Project settings</Link>
      </p>
      {workspace ? (
        <BoardView
          project={project}
          canManage={can(workspace.role, 'board:manage')}
          canEditCards={can(workspace.role, 'card:edit')}
          openCardNumber={openCardNumber}
          onCloseCard={() => void navigate(`/projects/${project.id}`)}
        />
      ) : (
        <Spinner label="Loading board" />
      )}
    </>
  );
}
