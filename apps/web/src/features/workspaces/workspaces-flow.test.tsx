import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';

const ID = '0192f000-0000-7000-8000-000000000001';
const ws = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'Acme',
  createdAt: '2026-10-30T10:00:00.000Z',
  role: 'owner',
  ...overrides,
});
const me = () => jsonResponse(200, { user: USER });
const forbidden = () =>
  jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'You do not have permission' } });

describe('home page', () => {
  it('shows the empty state and creates a workspace with the dialog', async () => {
    let list: unknown[] = [];
    const mock = stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': () => jsonResponse(200, { workspaces: list }),
      'POST /api/workspaces': (body) => {
        list = [ws({ name: (body as { name: string }).name })];
        return jsonResponse(201, { workspace: list[0] });
      },
      [`GET /api/workspaces/${ID}`]: () => jsonResponse(200, { workspace: list[0] }),
    });
    const user = userEvent.setup();
    const router = createTestRouter(['/']);
    render(<App router={router} />);

    const empty = await screen.findByRole('region', { name: 'No workspaces yet' });
    await user.click(within(empty).getByRole('button', { name: 'Create workspace' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create workspace' });
    await user.type(within(dialog).getByLabelText('Name'), '  Acme ');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/workspaces/${ID}`));
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme' })).toBeInTheDocument();
    const post = mock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: 'Acme' });
  });

  it('lists my workspaces as links and shows them in the switcher', async () => {
    stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': () =>
        jsonResponse(200, {
          workspaces: [ws(), ws({ id: '0192f000-0000-7000-8000-000000000002', name: 'Zed' })],
        }),
    });
    render(<App router={createTestRouter(['/'])} />);
    const list = await screen.findByRole('list', { name: 'Workspaces' });
    expect(within(list).getByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      `/workspaces/${ID}`,
    );
    const switcher = screen.getByLabelText('Workspace');
    expect(
      within(switcher)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose a workspace', 'Acme', 'Zed']);
  });

  it('opens the dialog with Enter, shows a validation error and closes with Escape', async () => {
    stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': () => jsonResponse(200, { workspaces: [] }),
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter(['/'])} />);
    const button = await screen.findByRole('button', { name: 'Create workspace' });
    button.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Create workspace' });
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText('Name is required')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Create workspace' })).toHaveFocus();
  });

  it('shows an error state with Retry', async () => {
    let calls = 0;
    stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': () =>
        ++calls === 1
          ? jsonResponse(400, { error: { code: 'VALIDATION_ERROR', message: 'Broken' } })
          : jsonResponse(200, { workspaces: [] }),
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter(['/'])} />);
    expect(await screen.findByText('Broken')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'No workspaces yet' })).toBeInTheDocument();
  });
});

describe('settings page', () => {
  it('lets the owner rename optimistically and rolls back when the server refuses', async () => {
    let fail = true;
    stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': () => jsonResponse(200, { workspaces: [ws()] }),
      [`GET /api/workspaces/${ID}`]: () => jsonResponse(200, { workspace: ws() }),
      [`PATCH /api/workspaces/${ID}`]: (body) => {
        if (fail) return forbidden();
        return jsonResponse(200, { workspace: ws(body as Record<string, unknown>) });
      },
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter([`/workspaces/${ID}/settings`])} />);
    const field = await screen.findByLabelText('Workspace name');
    await user.clear(field);
    await user.type(field, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(await screen.findByText('You do not have permission')).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Acme');

    fail = false;
    await user.clear(screen.getByLabelText('Workspace name'));
    await user.type(screen.getByLabelText('Workspace name'), 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(screen.getByTestId('live-polite')).toHaveTextContent('renamed'));
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Renamed');
  });

  it('deletes only after the exact name is typed, then goes home', async () => {
    let list = [ws()];
    const mock = stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': () => jsonResponse(200, { workspaces: list }),
      [`GET /api/workspaces/${ID}`]: () => jsonResponse(200, { workspace: ws() }),
      [`DELETE /api/workspaces/${ID}`]: () => {
        list = [];
        return jsonResponse(204);
      },
    });
    const user = userEvent.setup();
    const router = createTestRouter([`/workspaces/${ID}/settings`]);
    render(<App router={router} />);
    await user.click(await screen.findByRole('button', { name: 'Delete workspace' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete workspace' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete this workspace' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Type "Acme" to confirm'), 'acme');
    expect(confirm).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Type "Acme" to confirm'));
    await user.type(within(dialog).getByLabelText('Type "Acme" to confirm'), 'Acme');
    await user.click(confirm);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    const del = mock.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(JSON.parse(String(del?.[1]?.body))).toEqual({ confirmName: 'Acme' });
    expect(await screen.findByRole('region', { name: 'No workspaces yet' })).toBeInTheDocument();
  });

  it.each(['member', 'viewer'])('is read-only with an explanation for a %s', async (role) => {
    stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': () => jsonResponse(200, { workspaces: [ws({ role })] }),
      [`GET /api/workspaces/${ID}`]: () => jsonResponse(200, { workspace: ws({ role }) }),
    });
    render(<App router={createTestRouter([`/workspaces/${ID}/settings`])} />);
    const field = await screen.findByLabelText('Workspace name');
    expect(field).toBeDisabled();
    expect(field).toHaveAccessibleDescription(/only a workspace owner/i);
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete workspace' })).not.toBeInTheDocument();
  });

  it('shows the API message when the workspace is not found', async () => {
    stubFetch({
      'GET /api/auth/me': me,
      'GET /api/workspaces': () => jsonResponse(200, { workspaces: [] }),
      [`GET /api/workspaces/${ID}`]: () =>
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Resource not found' } }),
    });
    render(<App router={createTestRouter([`/workspaces/${ID}/settings`])} />);
    expect(await screen.findByText('Resource not found')).toBeInTheDocument();
  });
});
