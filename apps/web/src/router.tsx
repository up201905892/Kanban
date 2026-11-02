import { createBrowserRouter, createMemoryRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { RequireAuth } from './features/auth/RequireAuth';
import { HomePage } from './routes/HomePage';
import { InvitePage } from './routes/InvitePage';
import { LoginPage } from './routes/LoginPage';
import { MembersPage } from './routes/MembersPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { ProjectPage } from './routes/ProjectPage';
import { ProjectSettingsPage } from './routes/ProjectSettingsPage';
import { RootLayout } from './routes/RootLayout';
import { RouteError } from './routes/RouteError';
import { SignupPage } from './routes/SignupPage';
import { WorkspacePage } from './routes/WorkspacePage';
import { WorkspaceSettingsPage } from './routes/WorkspaceSettingsPage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { path: 'login', element: <LoginPage /> },
      { path: 'signup', element: <SignupPage /> },
      // Public: logged-out visitors see the offer, then log in or sign up and come back.
      { path: 'invite/:token', element: <InvitePage /> },
      {
        // Every private route goes under this layout route.
        element: <RequireAuth />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'workspaces/:id', element: <WorkspacePage /> },
          { path: 'workspaces/:id/settings', element: <WorkspaceSettingsPage /> },
          { path: 'workspaces/:id/members', element: <MembersPage /> },
          { path: 'projects/:pid', element: <ProjectPage /> },
          { path: 'projects/:pid/settings', element: <ProjectSettingsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[] = ['/']) =>
  createMemoryRouter(routes, { initialEntries });
