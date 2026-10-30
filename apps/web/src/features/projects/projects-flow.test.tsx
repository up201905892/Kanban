import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';

const WID = '0192f000-0000-7000-8000-000000000001';
const PID = '0192f000-0000-7000-8000-0000000000a1';
const ws = (role = 'owner') => ({
  id: WID,
  name: 'Acme',
  createdAt: '2026-10-30T10:00:00.000Z',
  role,
});
const project = (overrides: Record<string, unknown> = {}) => ({
  id: PID,
  workspaceId: WID,
  name: 'Kanban Board',
  key: 'KB',
  createdAt: '2026-10-30T10:00:00.000Z',
  ...overrides,
});
const me = () => jsonResponse(200, { user: USER });
const workspaces =
  (role = 'owner') =>
  () =>
    jsonResponse(200, { workspaces: [ws(role)] });
const workspace =
  (role = 'owner') =>
  () =>
    jsonResponse(200, { workspace: ws(role) });

describe('workspace page projects', () => {
  it('shows the empty state, suggests the key and creates a project', async () => {
    let list: unknown[] = [];
    const mock = stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': workspaces(),
      [`GET /api/workspaces/${WID}`]: workspace(),
      [`GET /api/workspaces/${WID}/projects`]: () => jsonResponse(200, { projects: list }),
      [`POST /api/workspaces/${WID}/projects`]: () => {
        list = [project()];
        return jsonResponse(201, { project: list[0] });
      },
      [`GET /api/projects/${PID}`]: () => jsonResponse(200, { project: list[0] }),
    });
    const user = userEvent.setup();
    const router = createTestRouter([`/workspaces/${WID}`]);
    render(<App router={router} />);

    const empty = await screen.findByRole('region', { name: 'No projects yet' });
    await user.click(within(empty).getByRole('button', { name: 'Create project' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create project' });
    await user.type(within(dialog).getByLabelText('Name'), 'Kanban Board');
    expect(within(dialog).getByLabelText('Key')).toHaveValue('KB');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${PID}`));
    expect(await screen.findByRole('heading', { level: 1, name: 'Kanban Board' })).toBeVisible();
    const post = mock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: 'Kanban Board', key: 'KB' });
  });

  it('stops following the name once the key is edited and uppercases what is typed', async () => {
    stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': workspaces(),
      [`GET /api/workspaces/${WID}`]: workspace(),
      [`GET /api/workspaces/${WID}/projects`]: () => jsonResponse(200, { projects: [] }),
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter([`/workspaces/${WID}`])} />);
    await user.click(await screen.findByRole('button', { name: 'Create project' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create project' });
    const name = within(dialog).getByLabelText('Name');
    const key = within(dialog).getByLabelText('Key');
    await user.type(name, 'Web Site');
    expect(key).toHaveValue('WS');
    await user.clear(key);
    await user.type(key, 'abc');
    expect(key).toHaveValue('ABC');
    await user.type(name, ' Extra');
    expect(key).toHaveValue('ABC');
  });

  it('validates the key and shows a taken key on the key field', async () => {
    stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': workspaces(),
      [`GET /api/workspaces/${WID}`]: workspace(),
      [`GET /api/workspaces/${WID}/projects`]: () => jsonResponse(200, { projects: [] }),
      [`POST /api/workspaces/${WID}/projects`]: () =>
        jsonResponse(409, {
          error: {
            code: 'PROJECT_KEY_TAKEN',
            message: 'This key is already used in the workspace',
            details: [{ path: 'key', message: 'This key is already used in the workspace' }],
          },
        }),
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter([`/workspaces/${WID}`])} />);
    await user.click(await screen.findByRole('button', { name: 'Create project' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create project' });

    await user.type(within(dialog).getByLabelText('Name'), 'X');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText(/Key must be 2 to 5 uppercase letters/)).toBeVisible();
    expect(within(dialog).getByLabelText('Key')).toHaveFocus();

    await user.type(within(dialog).getByLabelText('Key'), 'KB');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText(/already used in the workspace/)).toBeVisible();
    expect(within(dialog).getByLabelText('Key')).toHaveAttribute('aria-invalid', 'true');
  });

  it('lists projects as links, with the key', async () => {
    stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': workspaces(),
      [`GET /api/workspaces/${WID}`]: workspace(),
      [`GET /api/workspaces/${WID}/projects`]: () => jsonResponse(200, { projects: [project()] }),
    });
    render(<App router={createTestRouter([`/workspaces/${WID}`])} />);
    const list = await screen.findByRole('list', { name: 'Projects' });
    expect(within(list).getByRole('link', { name: 'Kanban Board' })).toHaveAttribute(
      'href',
      `/projects/${PID}`,
    );
    expect(within(list).getByText('(KB)')).toBeVisible();
  });

  it('shows an error with Retry', async () => {
    let fail = true;
    stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': workspaces(),
      [`GET /api/workspaces/${WID}`]: workspace(),
      [`GET /api/workspaces/${WID}/projects`]: () =>
        fail
          ? jsonResponse(400, { error: { code: 'VALIDATION_ERROR', message: 'Boom' } })
          : jsonResponse(200, { projects: [project()] }),
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter([`/workspaces/${WID}`])} />);
    expect(await screen.findByText('Boom')).toBeVisible();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Kanban Board' })).toBeVisible();
  });

  it('hides project creation from viewers', async () => {
    stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': workspaces('viewer'),
      [`GET /api/workspaces/${WID}`]: workspace('viewer'),
      [`GET /api/workspaces/${WID}/projects`]: () => jsonResponse(200, { projects: [] }),
    });
    render(<App router={createTestRouter([`/workspaces/${WID}`])} />);
    expect(await screen.findByRole('region', { name: 'No projects yet' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create project' })).not.toBeInTheDocument();
  });
});

function settingsHandlers(role: string, extra: Record<string, () => Response> = {}) {
  return {
    'GET /api/auth/me': me,
    'GET /api/workspaces': workspaces(role),
    [`GET /api/workspaces/${WID}`]: workspace(role),
    [`GET /api/projects/${PID}`]: () => jsonResponse(200, { project: project() }),
    [`GET /api/workspaces/${WID}/projects`]: () => jsonResponse(200, { projects: [project()] }),
    ...extra,
  };
}

describe('project settings', () => {
  it('renames optimistically and rolls back when the server refuses', async () => {
    stubFetch(
      settingsHandlers('owner', {
        [`PATCH /api/projects/${PID}`]: () =>
          jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Could not save' } }),
      }),
    );
    const user = userEvent.setup();
    render(<App router={createTestRouter([`/projects/${PID}/settings`])} />);
    const input = await screen.findByLabelText('Project name');
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(await screen.findByText('Could not save')).toBeVisible();
    await waitFor(() => expect(input).toHaveValue('Kanban Board'));
  });

  it('renames a project', async () => {
    let name = 'Kanban Board';
    stubFetch(
      settingsHandlers('member', {
        [`GET /api/projects/${PID}`]: () => jsonResponse(200, { project: project({ name }) }),
        [`PATCH /api/projects/${PID}`]: () => {
          name = 'Renamed';
          return jsonResponse(200, { project: project({ name }) });
        },
      }),
    );
    const user = userEvent.setup();
    render(<App router={createTestRouter([`/projects/${PID}/settings`])} />);
    const input = await screen.findByLabelText('Project name');
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent('Project renamed'),
    );
    expect(input).toHaveValue('Renamed');
  });

  it('deletes only after the exact name is typed, then returns to the workspace', async () => {
    let deleted = false;
    const mock = stubFetch(
      settingsHandlers('owner', {
        [`DELETE /api/projects/${PID}`]: () => {
          deleted = true;
          return jsonResponse(204);
        },
        [`GET /api/workspaces/${WID}/projects`]: () =>
          jsonResponse(200, { projects: deleted ? [] : [project()] }),
      }),
    );
    const user = userEvent.setup();
    const router = createTestRouter([`/projects/${PID}/settings`]);
    render(<App router={router} />);
    await user.click(await screen.findByRole('button', { name: 'Delete project' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete project' });
    const submit = within(dialog).getByRole('button', { name: 'Delete this project' });
    await user.type(within(dialog).getByLabelText('Type "Kanban Board" to confirm'), 'Kanban');
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/to confirm/), ' Board');
    await user.click(submit);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/workspaces/${WID}`));
    expect(mock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
    expect(await screen.findByRole('region', { name: 'No projects yet' })).toBeVisible();
  });

  it('lets a member rename but not delete', async () => {
    stubFetch(settingsHandlers('member'));
    render(<App router={createTestRouter([`/projects/${PID}/settings`])} />);
    expect(await screen.findByRole('button', { name: 'Rename' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Delete project' })).not.toBeInTheDocument();
    expect(screen.getByText('Only a workspace owner can delete this project.')).toBeVisible();
  });

  it('is read-only for a viewer', async () => {
    stubFetch(settingsHandlers('viewer'));
    render(<App router={createTestRouter([`/projects/${PID}/settings`])} />);
    expect(await screen.findByLabelText('Project name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete project' })).not.toBeInTheDocument();
  });

  it('shows an error when the project cannot be found', async () => {
    stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': workspaces(),
      [`GET /api/projects/${PID}`]: () =>
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Resource not found' } }),
    });
    render(<App router={createTestRouter([`/projects/${PID}`])} />);
    expect(await screen.findByText('Resource not found')).toBeVisible();
  });
});
