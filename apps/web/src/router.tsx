import { createBrowserRouter, createMemoryRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { RequireAuth } from './features/auth/RequireAuth';
import { HomePage } from './routes/HomePage';
import { LoginPage } from './routes/LoginPage';
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
      {
        // Every private route goes under this layout route.
        element: <RequireAuth />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'workspaces/:id', element: <WorkspacePage /> },
          { path: 'workspaces/:id/settings', element: <WorkspaceSettingsPage /> },
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
