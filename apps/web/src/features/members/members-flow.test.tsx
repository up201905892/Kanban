import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';

const WID = '0192f000-0000-7000-8000-000000000001';
const OTHER = '0192f000-0000-7000-8000-0000000000aa';
const workspace = (role: string) => ({
  id: WID,
  name: 'Acme',
  createdAt: '2026-10-30T10:00:00.000Z',
  role,
});
const member = (userId: string, name: string, role: string) => ({
  userId,
  name,
  email: `${name.toLowerCase()}@example.com`,
  role,
  joinedAt: '2026-10-30T10:00:00.000Z',
});
const me = () => jsonResponse(200, { user: USER });
const inviteJson = (overrides: Record<string, unknown> = {}) => ({
  id: '0192f000-0000-7000-8000-0000000000bb',
  role: 'viewer',
  createdAt: '2026-11-02T10:00:00.000Z',
  expiresAt: '2026-11-09T10:00:00.000Z',
  maxUses: null,
  uses: 0,
  ...overrides,
});
const TOKEN = 'tok_ABC-123';

describe('invite page', () => {
  it('shows the offer and sends logged-out visitors to login or sign-up with next', async () => {
    stubFetch({
      [`GET /api/invites/${TOKEN}`]: () =>
        jsonResponse(200, {
          workspaceName: 'Acme',
          role: 'viewer',
          expiresAt: '2026-11-09T10:00:00.000Z',
        }),
      'GET /api/auth/me': () =>
        jsonResponse(401, {
          error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
        }),
    });
    render(<App router={createTestRouter([`/invite/${TOKEN}`])} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: /invited to Acme/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
    const next = encodeURIComponent(`/invite/${TOKEN}`);
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      `/login?next=${next}`,
    );
    expect(screen.getByRole('link', { name: 'sign up' })).toHaveAttribute(
      'href',
      `/signup?next=${next}`,
    );
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('accepts when logged in and opens the workspace', async () => {
    const mock = stubFetch({
      [`GET /api/invites/${TOKEN}`]: () =>
        jsonResponse(200, {
          workspaceName: 'Acme',
          role: 'member',
          expiresAt: '2026-11-09T10:00:00.000Z',
        }),
      'GET /api/auth/me': me,
      [`POST /api/invites/${TOKEN}/accept`]: () => jsonResponse(200, { workspaceId: WID }),
      'GET /api/workspaces': () => jsonResponse(200, { workspaces: [workspace('member')] }),
      [`GET /api/workspaces/${WID}`]: () => jsonResponse(200, { workspace: workspace('member') }),
      [`GET /api/workspaces/${WID}/projects`]: () => jsonResponse(200, { projects: [] }),
    });
    const user = userEvent.setup();
    const router = createTestRouter([`/invite/${TOKEN}`]);
    render(<App router={router} />);
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/workspaces/${WID}`));
    expect(mock).toHaveBeenCalledWith(
      `/api/invites/${TOKEN}/accept`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows one message for an invalid link', async () => {
    stubFetch({
      [`GET /api/invites/${TOKEN}`]: () =>
        jsonResponse(404, { error: { code: 'INVITE_INVALID', message: 'invalid' } }),
      'GET /api/auth/me': me,
    });
    render(<App router={createTestRouter([`/invite/${TOKEN}`])} />);
    expect(await screen.findByRole('heading', { name: 'Invite not valid' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });
});

describe('members page', () => {
  function stubMembers(
    role: string,
    extra: Record<string, () => Response | Promise<Response>> = {},
  ) {
    return stubFetch({
      'GET /api/auth/me': me,
      [`GET /api/workspaces/${WID}`]: () => jsonResponse(200, { workspace: workspace(role) }),
      [`GET /api/workspaces/${WID}/members`]: () =>
        jsonResponse(200, {
          members: [member(USER.id, 'Ada', role), member(OTHER, 'Bob', 'viewer')],
        }),
      [`GET /api/workspaces/${WID}/invites`]: () => jsonResponse(200, { invites: [inviteJson()] }),
      'GET /api/workspaces': () => jsonResponse(200, { workspaces: [workspace(role)] }),
      ...extra,
    });
  }

  it('labels each role select with the member name and changes a role', async () => {
    let bobRole = 'viewer';
    const mock = stubMembers('owner', {
      [`GET /api/workspaces/${WID}/members`]: () =>
        jsonResponse(200, {
          members: [member(USER.id, 'Ada', 'owner'), member(OTHER, 'Bob', bobRole)],
        }),
      [`PATCH /api/workspaces/${WID}/members/${OTHER}`]: () => {
        bobRole = 'member';
        return jsonResponse(200, { member: member(OTHER, 'Bob', 'member') });
      },
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter([`/workspaces/${WID}/members`])} />);
    const select = await screen.findByRole('combobox', { name: 'Role for Bob' });
    expect(screen.getByRole('combobox', { name: 'Role for Ada' })).toBeInTheDocument();
    await user.selectOptions(select, 'member');
    await waitFor(() => expect(select).toHaveValue('member'));
    const patch = mock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ role: 'member' });
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent('Bob is now member'),
    );
  });

  it('rolls back and explains when the last owner cannot be demoted', async () => {
    stubMembers('owner', {
      [`PATCH /api/workspaces/${WID}/members/${USER.id}`]: () =>
        jsonResponse(409, {
          error: { code: 'LAST_OWNER', message: 'A workspace needs at least one owner.' },
        }),
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter([`/workspaces/${WID}/members`])} />);
    const select = await screen.findByRole('combobox', { name: 'Role for Ada' });
    await user.selectOptions(select, 'viewer');
    expect(await screen.findByText('A workspace needs at least one owner.')).toBeInTheDocument();
    await waitFor(() => expect(select).toHaveValue('owner'));
  });

  it('asks for confirmation before removing a member', async () => {
    let removed = false;
    stubMembers('owner', {
      [`GET /api/workspaces/${WID}/members`]: () =>
        jsonResponse(200, {
          members: removed
            ? [member(USER.id, 'Ada', 'owner')]
            : [member(USER.id, 'Ada', 'owner'), member(OTHER, 'Bob', 'viewer')],
        }),
      [`DELETE /api/workspaces/${WID}/members/${OTHER}`]: () => {
        removed = true;
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter([`/workspaces/${WID}/members`])} />);
    await user.click(await screen.findByRole('button', { name: 'Remove Bob' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove member' });
    // Cancel does nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('combobox', { name: 'Role for Bob' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Bob' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Remove member' })).getByRole('button', {
        name: 'Remove',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Role for Bob' })).not.toBeInTheDocument(),
    );
  });

  it('creates an invite, shows the link once and announces "Link copied"', async () => {
    const link = `http://localhost:5173/invite/${TOKEN}`;
    stubMembers('owner', {
      [`POST /api/workspaces/${WID}/invites`]: () =>
        jsonResponse(201, { invite: inviteJson({ role: 'member' }), link }),
    });
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<App router={createTestRouter([`/workspaces/${WID}/members`])} />);
    await user.click(await screen.findByRole('button', { name: 'Invite people' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite people' });
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(await within(dialog).findByLabelText('Invite link')).toHaveValue(link);
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(link);
    await waitFor(() => expect(screen.getByTestId('live-polite')).toHaveTextContent('Link copied'));
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Invite people' }));
    // Reopening starts from the form: the link is gone.
    const again = await screen.findByRole('dialog', { name: 'Invite people' });
    expect(within(again).queryByLabelText('Invite link')).not.toBeInTheDocument();
  });

  it('revokes an active invite optimistically', async () => {
    let revoked = false;
    stubMembers('owner', {
      [`GET /api/workspaces/${WID}/invites`]: () =>
        jsonResponse(200, { invites: revoked ? [] : [inviteJson()] }),
      [`DELETE /api/invites/${inviteJson().id}`]: () => {
        revoked = true;
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter([`/workspaces/${WID}/members`])} />);
    const list = await screen.findByRole('list', { name: 'Active invites' });
    await user.click(within(list).getByRole('button', { name: /^Revoke viewer invite/ }));
    expect(await screen.findByText('No active invite links.')).toBeInTheDocument();
  });

  it('is read-only for a viewer: no selects, no invite, no remove; leave is available', async () => {
    stubMembers('viewer');
    render(<App router={createTestRouter([`/workspaces/${WID}/members`])} />);
    const table = await screen.findByRole('table');
    expect(within(table).queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite people' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave workspace' })).toBeInTheDocument();
  });
});
