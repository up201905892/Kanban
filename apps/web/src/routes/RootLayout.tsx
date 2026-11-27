import { APP_NAME } from '@kanban/shared';
import { useRef } from 'react';
import { Link, Outlet } from 'react-router';
import { useHeadingTitle } from './useHeadingTitle';
import { Button } from '../components';
import { useCurrentUser, useLogout } from '../features/auth/api';
import { WorkspaceSwitcher } from '../features/workspaces/WorkspaceSwitcher';

export function RootLayout() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const mainRef = useRef<HTMLElement>(null);
  useHeadingTitle(mainRef);

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <nav aria-label="Main">
          <Link to="/">{APP_NAME}</Link>
        </nav>
        {user && <WorkspaceSwitcher />}
        {user && (
          <div className="user-menu">
            <span>{user.name}</span>
            <Button disabled={logout.isPending} onClick={() => logout.mutate()}>
              Log out
            </Button>
          </div>
        )}
      </header>
      <main id="main" tabIndex={-1} ref={mainRef}>
        <Outlet />
      </main>
    </>
  );
}
