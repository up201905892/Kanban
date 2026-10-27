import { APP_NAME } from '@kanban/shared';
import { Link, Outlet } from 'react-router';

export function RootLayout() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <nav aria-label="Main">
          <Link to="/">{APP_NAME}</Link>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  );
}
