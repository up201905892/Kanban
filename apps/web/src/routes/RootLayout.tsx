import { APP_NAME } from '@kanban/shared';
import { Link, Outlet } from 'react-router';
import { Button } from '../components';
import { useCurrentUser, useLogout } from '../features/auth/api';

export function RootLayout() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <nav aria-label="Main">
          <Link to="/">{APP_NAME}</Link>
        </nav>
        {user && (
          <div className="user-menu">
            <span>{user.name}</span>
            <Button disabled={logout.isPending} onClick={() => logout.mutate()}>
              Log out
            </Button>
          </div>
        )}
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  );
}
