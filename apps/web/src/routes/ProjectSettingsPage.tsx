import { can, updateProjectRequestSchema } from '@kanban/shared';
import type { Project, Role } from '@kanban/shared';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Dialog, ErrorState, Spinner, TextField, useAnnounce } from '../components';
import { failureFromError, fieldErrorsFromZod } from '../features/auth/form-errors';
import { useAuthForm } from '../features/auth/useAuthForm';
import { useDeleteProject, useProject, useRenameProject } from '../features/projects/api';
import { useWorkspace } from '../features/workspaces/api';

export function ProjectSettingsPage() {
  const { pid = '' } = useParams();
  const project = useProject(pid);

  if (project.isPending) return <Spinner label="Loading project" />;
  if (project.isError) {
    return (
      <ErrorState
        title="Project unavailable"
        message={project.error.message}
        onRetry={() => void project.refetch()}
      />
    );
  }
  return <WithRole project={project.data} />;
}

/** The role comes from the workspace, which is requested once the project is known. */
function WithRole({ project }: { project: Project }) {
  const workspace = useWorkspace(project.workspaceId);
  if (workspace.isPending) return <Spinner label="Loading project" />;
  if (workspace.isError) {
    return (
      <ErrorState
        title="Project unavailable"
        message={workspace.error.message}
        onRetry={() => void workspace.refetch()}
      />
    );
  }
  return <Settings project={project} role={workspace.data.role} />;
}

const RENAME_FIELDS = ['name'] as const;

function Settings({ project, role }: { project: Project; role: Role }) {
  const canRename = can(role, 'project:manage');
  const canDelete = can(role, 'project:delete');
  return (
    <>
      <h1>Project settings</h1>
      <p>
        <Link to={`/projects/${project.id}`}>Back to {project.name}</Link>
      </p>
      <p>Key: {project.key}</p>
      {!canRename && <p id="project-read-only">Viewers cannot change this project.</p>}
      <RenameForm project={project} canRename={canRename} />
      {canDelete ? (
        <DeleteSection project={project} />
      ) : (
        canRename && <p>Only a workspace owner can delete this project.</p>
      )}
    </>
  );
}

function RenameForm({ project, canRename }: { project: Project; canRename: boolean }) {
  const [name, setName] = useState(project.name);
  const rename = useRenameProject(project);
  const announce = useAnnounce();
  const { failure, fail, clear, registerField } = useAuthForm(RENAME_FIELDS);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    clear();
    const parsed = updateProjectRequestSchema.safeParse({ name });
    if (!parsed.success) {
      fail({ fields: fieldErrorsFromZod(parsed.error, RENAME_FIELDS) });
      return;
    }
    rename.mutate(parsed.data, {
      onSuccess: ({ project: saved }) => {
        setName(saved.name);
        announce('Project renamed');
      },
      onError: (error) => {
        setName(project.name);
        fail(failureFromError(error, RENAME_FIELDS));
      },
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Rename project">
      <TextField
        ref={registerField('name')}
        label="Project name"
        name="name"
        autoComplete="off"
        value={name}
        disabled={!canRename}
        {...(!canRename && { 'aria-describedby': 'project-read-only' })}
        onChange={(e) => setName(e.target.value)}
        {...(failure.fields.name && { error: failure.fields.name })}
      />
      {failure.form && <p className="form-error">{failure.form}</p>}
      {canRename && (
        <Button type="submit" disabled={rename.isPending}>
          Rename
        </Button>
      )}
    </form>
  );
}

function DeleteSection({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const remove = useDeleteProject(project);
  const navigate = useNavigate();
  const announce = useAnnounce();
  const [error, setError] = useState<string>();

  function close() {
    setOpen(false);
    setConfirmName('');
    setError(undefined);
    remove.reset();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // The server needs no confirmation; the typed name guards against accidental clicks.
    if (confirmName !== project.name) return;
    setError(undefined);
    remove.mutate(undefined, {
      onSuccess: () => {
        announce(`Project ${project.name} deleted`);
        void navigate(`/workspaces/${project.workspaceId}`, { replace: true });
      },
      onError: (e) => {
        setError(failureFromError(e, [] as const).form);
        announce('Could not delete the project', 'assertive');
      },
    });
  }

  return (
    <section aria-labelledby="project-danger-zone">
      <h2 id="project-danger-zone">Delete project</h2>
      <p>Deleting a project removes everything in it. This cannot be undone.</p>
      <Button onClick={() => setOpen(true)}>Delete project</Button>
      <Dialog open={open} onClose={close} title="Delete project">
        <form onSubmit={onSubmit} noValidate aria-label="Delete project">
          <TextField
            label={`Type "${project.name}" to confirm`}
            name="confirmName"
            autoComplete="off"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button type="submit" disabled={remove.isPending || confirmName !== project.name}>
              Delete this project
            </Button>
            <Button onClick={close}>Cancel</Button>
          </div>
          {remove.isPending && <Spinner label="Deleting project" />}
        </form>
      </Dialog>
    </section>
  );
}
