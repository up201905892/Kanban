import { ROLES, can, roleSchema } from '@kanban/shared';
import type { Member, Workspace } from '@kanban/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Dialog, EmptyState, ErrorState, Spinner, useAnnounce } from '../components';
import { useCurrentUser } from '../features/auth/api';
import { InviteDialog } from '../features/invites/InviteDialog';
import { useInvites, useRevokeInvite } from '../features/invites/api';
import { useChangeMemberRole, useMembers, useRemoveMember } from '../features/members/api';
import { useWorkspace } from '../features/workspaces/api';
import { isApiError } from '../lib/api';

export function MembersPage() {
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
  return <Members workspace={workspace} />;
}

function Members({ workspace }: { workspace: Workspace }) {
  const isOwner = can(workspace.role, 'members:manage');
  return (
    <>
      <h1>Members</h1>
      <p>
        <Link to={`/workspaces/${workspace.id}`}>Back to {workspace.name}</Link>
      </p>
      {!isOwner && <p>Only a workspace owner can change roles, remove people or invite.</p>}
      <MemberTable workspace={workspace} isOwner={isOwner} />
      {isOwner && <InviteSection workspaceId={workspace.id} />}
    </>
  );
}

function MemberTable({ workspace, isOwner }: { workspace: Workspace; isOwner: boolean }) {
  const { data: members, isPending, isError, error, refetch } = useMembers(workspace.id);
  const { data: me } = useCurrentUser();
  const changeRole = useChangeMemberRole(workspace.id);
  const remove = useRemoveMember(workspace.id);
  const announce = useAnnounce();
  const navigate = useNavigate();
  const [target, setTarget] = useState<Member | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (isPending) return <Spinner label="Loading members" />;
  if (isError) {
    return (
      <ErrorState
        title="Members unavailable"
        message={error.message}
        onRetry={() => void refetch()}
      />
    );
  }

  function report(error: Error, fallback: string) {
    const message = isApiError(error) ? error.message : fallback;
    setProblem(message);
    announce(message, 'assertive');
  }

  function onRoleChange(member: Member, value: string) {
    const parsed = roleSchema.safeParse(value);
    if (!parsed.success) return;
    setProblem(null);
    changeRole.mutate(
      { userId: member.userId, role: parsed.data },
      {
        onSuccess: () => announce(`${member.name} is now ${parsed.data}`),
        onError: (e) => report(e, 'Could not change the role'),
      },
    );
  }

  function confirmRemove() {
    if (!target) return;
    const leaving = target.userId === me?.id;
    const member = target;
    setProblem(null);
    setTarget(null);
    remove.mutate(
      { userId: member.userId, leaving },
      {
        onSuccess: () => {
          if (leaving) {
            announce(`You left ${workspace.name}`);
            void navigate('/', { replace: true });
          } else {
            announce(`${member.name} removed`);
          }
        },
        onError: (e) => report(e, leaving ? 'Could not leave' : 'Could not remove the member'),
      },
    );
  }

  const leaving = target?.userId === me?.id;

  return (
    <section aria-labelledby="members-heading">
      <h2 id="members-heading">People</h2>
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}
      {members.length === 0 ? (
        <EmptyState title="No members" />
      ) : (
        <table aria-labelledby="members-heading">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isMe = member.userId === me?.id;
              return (
                <tr key={member.userId}>
                  <th scope="row">
                    {member.name}
                    {isMe ? ' (you)' : ''}
                  </th>
                  <td>{member.email}</td>
                  <td>
                    {isOwner ? (
                      <select
                        aria-label={`Role for ${member.name}`}
                        value={member.role}
                        onChange={(e) => onRoleChange(member, e.target.value)}
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    ) : (
                      member.role
                    )}
                  </td>
                  <td>
                    {isMe ? (
                      <Button onClick={() => setTarget(member)}>Leave workspace</Button>
                    ) : (
                      isOwner && (
                        <Button
                          aria-label={`Remove ${member.name}`}
                          onClick={() => setTarget(member)}
                        >
                          Remove
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Dialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={leaving ? 'Leave workspace' : 'Remove member'}
      >
        <p>
          {leaving
            ? `Leave ${workspace.name}? You will lose access until someone invites you again.`
            : `Remove ${target?.name ?? ''} from ${workspace.name}? They lose access at once. What they created stays.`}
        </p>
        <div className="dialog-actions">
          <Button onClick={confirmRemove}>{leaving ? 'Leave' : 'Remove'}</Button>
          <Button onClick={() => setTarget(null)}>Cancel</Button>
        </div>
      </Dialog>
    </section>
  );
}

function InviteSection({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const { data: invites, isPending, isError, error, refetch } = useInvites(workspaceId);
  const revoke = useRevokeInvite(workspaceId);
  const announce = useAnnounce();

  let list;
  if (isPending) {
    list = <Spinner label="Loading invites" />;
  } else if (isError) {
    list = (
      <ErrorState
        title="Invites unavailable"
        message={error.message}
        onRetry={() => void refetch()}
      />
    );
  } else if (invites.length === 0) {
    list = <p>No active invite links.</p>;
  } else {
    list = (
      <ul aria-label="Active invites" className="workspace-list">
        {invites.map((invite) => (
          <li key={invite.id}>
            {invite.role}, expires {new Date(invite.expiresAt).toLocaleDateString('en-GB')}
            {invite.maxUses !== null ? `, used ${invite.uses} of ${invite.maxUses}` : ''}{' '}
            <Button
              aria-label={`Revoke ${invite.role} invite expiring ${new Date(invite.expiresAt).toLocaleDateString('en-GB')}`}
              onClick={() =>
                revoke.mutate(invite.id, {
                  onSuccess: () => announce('Invite revoked'),
                  onError: () => announce('Could not revoke the invite', 'assertive'),
                })
              }
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby="invites-heading">
      <h2 id="invites-heading">Invite links</h2>
      <Button onClick={() => setOpen(true)}>Invite people</Button>
      {list}
      <InviteDialog workspaceId={workspaceId} open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
