import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, ErrorState, Spinner, useAnnounce } from '../components';
import { useCurrentUser } from '../features/auth/api';
import { useAcceptInvite, useInvitePreview } from '../features/invites/api';
import { isApiError } from '../lib/api';

/** Public page: shows what the link offers; accepting needs a session. */
export function InvitePage() {
  const { token = '' } = useParams();
  const preview = useInvitePreview(token);
  const { data: user, isPending: userPending } = useCurrentUser();
  const accept = useAcceptInvite(token);
  const navigate = useNavigate();
  const announce = useAnnounce();
  const [problem, setProblem] = useState<string | null>(null);

  if (preview.isPending || userPending) return <Spinner label="Checking the invite" />;
  if (preview.isError) {
    const invalid = isApiError(preview.error) && preview.error.code === 'INVITE_INVALID';
    return invalid ? (
      <ErrorState
        title="Invite not valid"
        message="This invite link is invalid or has expired. Ask the workspace owner for a new one."
      />
    ) : (
      <ErrorState
        title="Invite unavailable"
        message={preview.error.message}
        onRetry={() => void preview.refetch()}
      />
    );
  }

  const { workspaceName, role } = preview.data;
  const next = encodeURIComponent(`/invite/${token}`);

  function onAccept() {
    setProblem(null);
    accept.mutate(undefined, {
      onSuccess: ({ workspaceId }) => {
        announce(`You joined ${workspaceName}`);
        void navigate(`/workspaces/${workspaceId}`, { replace: true });
      },
      onError: (error) => {
        const message = isApiError(error) ? error.message : 'Could not accept the invite';
        setProblem(message);
        announce(message, 'assertive');
      },
    });
  }

  return (
    <>
      <h1>You are invited to {workspaceName}</h1>
      <p>
        You will join as a <strong>{role}</strong>
        {role === 'viewer' ? ' (read only).' : ' (can edit).'}
      </p>
      {user ? (
        <>
          {problem && (
            <p className="form-error" role="alert">
              {problem}
            </p>
          )}
          <Button onClick={onAccept} disabled={accept.isPending}>
            Accept
          </Button>
          {accept.isPending && <Spinner label="Joining workspace" />}
        </>
      ) : (
        <p>
          <Link to={`/login?next=${next}`}>Log in</Link> or{' '}
          <Link to={`/signup?next=${next}`}>sign up</Link> to accept.
        </p>
      )}
    </>
  );
}
