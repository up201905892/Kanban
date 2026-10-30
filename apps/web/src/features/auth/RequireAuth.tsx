import { Navigate, Outlet, useLocation } from 'react-router';
import { ErrorState, Spinner } from '../../components';
import { useCurrentUser } from './api';
import { loginPathFor } from './safe-next';

/** Layout route: renders its children only for a logged-in user, otherwise goes to login. */
export function RequireAuth() {
  const { data: user, isPending, isError, refetch } = useCurrentUser();
  const location = useLocation();

  if (isPending) return <Spinner label="Checking your session" />;
  if (isError) {
    return <ErrorState message="Could not check your session." onRetry={() => void refetch()} />;
  }
  if (!user) {
    return (
      <Navigate
        to={loginPathFor(`${location.pathname}${location.search}${location.hash}`)}
        replace
      />
    );
  }
  return <Outlet />;
}
