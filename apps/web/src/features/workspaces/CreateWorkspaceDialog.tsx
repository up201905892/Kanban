import { createWorkspaceRequestSchema } from '@kanban/shared';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button, Dialog, Spinner, TextField, useAnnounce } from '../../components';
import { failureFromError, fieldErrorsFromZod } from '../auth/form-errors';
import { useAuthForm } from '../auth/useAuthForm';
import { useCreateWorkspace } from './api';

const FIELDS = ['name'] as const;

export interface CreateWorkspaceDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateWorkspaceDialog({ open, onClose }: CreateWorkspaceDialogProps) {
  const [name, setName] = useState('');
  const create = useCreateWorkspace();
  const navigate = useNavigate();
  const announce = useAnnounce();
  const { failure, fail, clear, registerField } = useAuthForm(FIELDS);

  function close() {
    setName('');
    clear();
    create.reset();
    onClose();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    clear();
    const parsed = createWorkspaceRequestSchema.safeParse({ name });
    if (!parsed.success) {
      fail({ fields: fieldErrorsFromZod(parsed.error, FIELDS) });
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: ({ workspace }) => {
        announce(`Workspace ${workspace.name} created`);
        close();
        void navigate(`/workspaces/${workspace.id}`);
      },
      onError: (error) => fail(failureFromError(error, FIELDS)),
    });
  }

  return (
    <Dialog open={open} onClose={close} title="Create workspace">
      <form onSubmit={onSubmit} noValidate aria-label="Create workspace">
        <TextField
          ref={registerField('name')}
          label="Name"
          name="name"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          {...(failure.fields.name && { error: failure.fields.name })}
        />
        {failure.form && <p className="form-error">{failure.form}</p>}
        <div className="dialog-actions">
          <Button type="submit" disabled={create.isPending}>
            Create
          </Button>
          <Button onClick={close}>Cancel</Button>
        </div>
        {create.isPending && <Spinner label="Creating workspace" />}
      </form>
    </Dialog>
  );
}
