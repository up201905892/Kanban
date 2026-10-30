import { can, deleteWorkspaceRequestSchema, updateWorkspaceRequestSchema } from '@kanban/shared';
import type { Workspace } from '@kanban/shared';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Dialog, ErrorState, Spinner, TextField, useAnnounce } from '../components';
import { failureFromError, fieldErrorsFromZod } from '../features/auth/form-errors';
import { useAuthForm } from '../features/auth/useAuthForm';
import { useDeleteWorkspace, useRenameWorkspace, useWorkspace } from '../features/workspaces/api';

export function WorkspaceSettingsPage() {
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
  return <Settings workspace={workspace} />;
}

const RENAME_FIELDS = ['name'] as const;
const DELETE_FIELDS = ['confirmName'] as const;

function Settings({ workspace }: { workspace: Workspace }) {
  const isOwner = can(workspace.role, 'workspace:update');
  return (
    <>
      <h1>Workspace settings</h1>
      <p>
        <Link to={`/workspaces/${workspace.id}`}>Back to {workspace.name}</Link>
      </p>
      {!isOwner && (
        <p id="owner-only">Only a workspace owner can rename or delete this workspace.</p>
      )}
      <RenameForm workspace={workspace} isOwner={isOwner} />
      {isOwner && <DeleteSection workspace={workspace} />}
    </>
  );
}

function RenameForm({ workspace, isOwner }: { workspace: Workspace; isOwner: boolean }) {
  const [name, setName] = useState(workspace.name);
  const rename = useRenameWorkspace(workspace.id);
  const announce = useAnnounce();
  const { failure, fail, clear, registerField } = useAuthForm(RENAME_FIELDS);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    clear();
    const parsed = updateWorkspaceRequestSchema.safeParse({ name });
    if (!parsed.success) {
      fail({ fields: fieldErrorsFromZod(parsed.error, RENAME_FIELDS) });
      return;
    }
    rename.mutate(parsed.data, {
      onSuccess: ({ workspace: saved }) => {
        setName(saved.name);
        announce('Workspace renamed');
      },
      onError: (error) => {
        setName(workspace.name);
        fail(failureFromError(error, RENAME_FIELDS));
      },
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Rename workspace">
      <TextField
        ref={registerField('name')}
        label="Workspace name"
        name="name"
        autoComplete="off"
        value={name}
        disabled={!isOwner}
        {...(!isOwner && { 'aria-describedby': 'owner-only' })}
        onChange={(e) => setName(e.target.value)}
        {...(failure.fields.name && { error: failure.fields.name })}
      />
      {failure.form && <p className="form-error">{failure.form}</p>}
      {isOwner && (
        <Button type="submit" disabled={rename.isPending}>
          Rename
        </Button>
      )}
    </form>
  );
}

function DeleteSection({ workspace }: { workspace: Workspace }) {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const remove = useDeleteWorkspace(workspace.id);
  const navigate = useNavigate();
  const announce = useAnnounce();
  const { failure, fail, clear, registerField } = useAuthForm(DELETE_FIELDS);

  function close() {
    setOpen(false);
    setConfirmName('');
    clear();
    remove.reset();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    clear();
    const parsed = deleteWorkspaceRequestSchema.safeParse({ confirmName });
    if (!parsed.success) {
      fail({ fields: fieldErrorsFromZod(parsed.error, DELETE_FIELDS) });
      return;
    }
    remove.mutate(parsed.data, {
      onSuccess: () => {
        announce(`Workspace ${workspace.name} deleted`);
        void navigate('/', { replace: true });
      },
      onError: (error) => {
        fail(failureFromError(error, DELETE_FIELDS));
        announce('Could not delete the workspace', 'assertive');
      },
    });
  }

  return (
    <section aria-labelledby="danger-zone">
      <h2 id="danger-zone">Delete workspace</h2>
      <p>Deleting a workspace removes everything in it. This cannot be undone.</p>
      <Button onClick={() => setOpen(true)}>Delete workspace</Button>
      <Dialog open={open} onClose={close} title="Delete workspace">
        <form onSubmit={onSubmit} noValidate aria-label="Delete workspace">
          <TextField
            ref={registerField('confirmName')}
            label={`Type "${workspace.name}" to confirm`}
            name="confirmName"
            autoComplete="off"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            {...(failure.fields.confirmName && { error: failure.fields.confirmName })}
          />
          {failure.form && <p className="form-error">{failure.form}</p>}
          <div className="dialog-actions">
            <Button type="submit" disabled={remove.isPending || confirmName !== workspace.name}>
              Delete this workspace
            </Button>
            <Button onClick={close}>Cancel</Button>
          </div>
          {remove.isPending && <Spinner label="Deleting workspace" />}
        </form>
      </Dialog>
    </section>
  );
}
