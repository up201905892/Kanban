import { createProjectRequestSchema, suggestProjectKey } from '@kanban/shared';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button, Dialog, Spinner, TextField, useAnnounce } from '../../components';
import { failureFromError, fieldErrorsFromZod } from '../auth/form-errors';
import { useAuthForm } from '../auth/useAuthForm';
import { useCreateProject } from './api';

const FIELDS = ['name', 'key'] as const;

export interface CreateProjectDialogProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

export function CreateProjectDialog({ workspaceId, open, onClose }: CreateProjectDialogProps) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  // Once the person types in the key field, it stops following the name.
  const [keyEdited, setKeyEdited] = useState(false);
  const create = useCreateProject(workspaceId);
  const navigate = useNavigate();
  const announce = useAnnounce();
  const { failure, fail, clear, registerField } = useAuthForm(FIELDS);

  function close() {
    setName('');
    setKey('');
    setKeyEdited(false);
    clear();
    create.reset();
    onClose();
  }

  function onNameChange(value: string) {
    setName(value);
    if (!keyEdited) setKey(suggestProjectKey(value));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    clear();
    const parsed = createProjectRequestSchema.safeParse({ name, key });
    if (!parsed.success) {
      fail({ fields: fieldErrorsFromZod(parsed.error, FIELDS) });
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: ({ project }) => {
        announce(`Project ${project.name} created`);
        close();
        void navigate(`/projects/${project.id}`);
      },
      onError: (error) => fail(failureFromError(error, FIELDS)),
    });
  }

  return (
    <Dialog open={open} onClose={close} title="Create project">
      <form onSubmit={onSubmit} noValidate aria-label="Create project">
        <TextField
          ref={registerField('name')}
          label="Name"
          name="name"
          autoComplete="off"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          {...(failure.fields.name && { error: failure.fields.name })}
        />
        <TextField
          ref={registerField('key')}
          label="Key"
          name="key"
          autoComplete="off"
          hint="2 to 5 uppercase letters. It starts every card ID and cannot be changed later."
          value={key}
          onChange={(e) => {
            setKeyEdited(true);
            setKey(e.target.value.toUpperCase());
          }}
          {...(failure.fields.key && { error: failure.fields.key })}
        />
        {failure.form && <p className="form-error">{failure.form}</p>}
        <div className="dialog-actions">
          <Button type="submit" disabled={create.isPending}>
            Create
          </Button>
          <Button onClick={close}>Cancel</Button>
        </div>
        {create.isPending && <Spinner label="Creating project" />}
      </form>
    </Dialog>
  );
}
