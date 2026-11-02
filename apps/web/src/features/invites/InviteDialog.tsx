import {
  INVITE_MAX_DAYS,
  createInviteRequestSchema,
  inviteRoleSchema,
  type CreateInviteRequest,
} from '@kanban/shared';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Dialog, Select, Spinner, TextField, useAnnounce } from '../../components';
import { failureFromError, fieldErrorsFromZod } from '../auth/form-errors';
import { useAuthForm } from '../auth/useAuthForm';
import { useCreateInvite } from './api';

const FIELDS = ['role', 'expiresInDays', 'maxUses'] as const;
const ROLE_OPTIONS = [
  { value: 'member', label: 'Member (can edit)' },
  { value: 'viewer', label: 'Viewer (read only)' },
];
const DAY_OPTIONS = [1, 7, 14, INVITE_MAX_DAYS].map((days) => ({
  value: String(days),
  label: days === 1 ? '1 day' : `${days} days`,
}));

export interface InviteDialogProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

export function InviteDialog({ workspaceId, open, onClose }: InviteDialogProps) {
  const [role, setRole] = useState('member');
  const [days, setDays] = useState('7');
  const [maxUses, setMaxUses] = useState('');
  // The link exists only here, once: it is not kept anywhere after the dialog closes.
  const [link, setLink] = useState<string | null>(null);
  const create = useCreateInvite(workspaceId);
  const announce = useAnnounce();
  const { failure, fail, clear, registerField } = useAuthForm(FIELDS);

  function close() {
    setRole('member');
    setDays('7');
    setMaxUses('');
    setLink(null);
    clear();
    create.reset();
    onClose();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    clear();
    const trimmed = maxUses.trim();
    const candidate = {
      role: inviteRoleSchema.safeParse(role).success ? role : undefined,
      expiresInDays: Number(days),
      ...(trimmed !== '' && { maxUses: Number(trimmed) }),
    };
    const parsed = createInviteRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      fail({ fields: fieldErrorsFromZod(parsed.error, FIELDS) });
      return;
    }
    const body: CreateInviteRequest = parsed.data;
    create.mutate(body, {
      onSuccess: (created) => {
        setLink(created.link);
        announce('Invite link created');
      },
      onError: (error) => fail(failureFromError(error, FIELDS)),
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      announce('Link copied');
    } catch {
      announce('Could not copy the link. Select it and copy it manually.', 'assertive');
    }
  }

  return (
    <Dialog open={open} onClose={close} title="Invite people">
      {link ? (
        <div>
          <p>Copy this link and share it. It is shown only once.</p>
          <TextField
            label="Invite link"
            name="link"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="dialog-actions">
            <Button onClick={() => void copy()}>Copy link</Button>
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate aria-label="Create invite link">
          <Select
            label="Role"
            name="role"
            value={role}
            options={ROLE_OPTIONS}
            onChange={(e) => setRole(e.target.value)}
            {...(failure.fields.role && { error: failure.fields.role })}
          />
          <Select
            label="Expires after"
            name="expiresInDays"
            value={days}
            options={DAY_OPTIONS}
            onChange={(e) => setDays(e.target.value)}
            {...(failure.fields.expiresInDays && { error: failure.fields.expiresInDays })}
          />
          <TextField
            ref={registerField('maxUses')}
            label="Maximum uses (optional)"
            name="maxUses"
            inputMode="numeric"
            autoComplete="off"
            hint="Leave empty for no limit."
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            {...(failure.fields.maxUses && { error: failure.fields.maxUses })}
          />
          {failure.form && <p className="form-error">{failure.form}</p>}
          <div className="dialog-actions">
            <Button type="submit" disabled={create.isPending}>
              Create link
            </Button>
            <Button onClick={close}>Cancel</Button>
          </div>
          {create.isPending && <Spinner label="Creating invite link" />}
        </form>
      )}
    </Dialog>
  );
}
