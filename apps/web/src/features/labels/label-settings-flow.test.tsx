import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';

const WID = '0192f000-0000-7000-8000-000000000001';
const PID = '0192f000-0000-7000-8000-0000000000a1';
const BID = '0192f000-0000-7000-8000-0000000000b1';
const NOW = '2026-11-27T10:00:00.000Z';
const lid = (n: number) => `0192f000-0000-7000-8000-0000000005${String(n).padStart(2, '0')}`;

interface Lb {
  id: string;
  projectId: string;
  name: string;
  color: string;
}

function server(role: string, labels: Lb[]) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const handlers = {
    'GET /api/auth/me': () => jsonResponse(200, { user: USER }),
    'GET /api/workspaces': () => jsonResponse(200, { workspaces: [] }),
    [`GET /api/workspaces/${WID}`]: () =>
      jsonResponse(200, { workspace: { id: WID, name: 'Acme', createdAt: NOW, role } }),
    [`GET /api/projects/${PID}`]: () =>
      jsonResponse(200, {
        project: { id: PID, workspaceId: WID, name: 'Kanban', key: 'KB', createdAt: NOW },
      }),
    [`GET /api/projects/${PID}/board`]: () =>
      jsonResponse(200, {
        board: { id: BID, projectId: PID },
        columns: [],
        cards: [],
        sprints: [],
        labels,
      }),
    [`POST /api/projects/${PID}/labels`]: (body: unknown) => {
      calls.push({ method: 'POST', path: 'labels', body });
      const input = body as { id: string; name: string; color: string };
      if (labels.some((l) => l.name.toLowerCase() === input.name.toLowerCase())) {
        return jsonResponse(409, {
          error: { code: 'LABEL_NAME_TAKEN', message: 'A label with this name already exists' },
        });
      }
      const label = { id: input.id, projectId: PID, name: input.name, color: input.color };
      labels.push(label);
      return jsonResponse(201, { label });
    },
    [`DELETE /api/labels/${lid(1)}`]: () => {
      calls.push({ method: 'DELETE', path: 'label 1', body: undefined });
      labels.splice(0, 1);
      return new Response(null, { status: 204 });
    },
  };
  return { handlers, calls };
}

const open = () => {
  const user = userEvent.setup();
  render(<App router={createTestRouter([`/projects/${PID}/settings`])} />);
  return user;
};

describe('label settings', () => {
  it('shows the empty state, creates a label with a client id and announces it', async () => {
    const { handlers, calls } = server('member', []);
    stubFetch(handlers);
    const user = open();
    expect(await screen.findByRole('region', { name: 'No labels yet' })).toBeVisible();
    await user.type(screen.getByLabelText('New label name'), 'Bug');
    await user.selectOptions(screen.getByLabelText('Color'), 'blue');
    await user.click(screen.getByRole('button', { name: 'Create label' }));
    expect(await screen.findByRole('form', { name: 'Edit label Bug' })).toBeVisible();
    expect(calls[0]?.body).toMatchObject({ name: 'Bug', color: 'blue' });
    expect((calls[0]?.body as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent('Label Bug created'),
    );
  });

  it('validates the name before sending and shows the server error for a duplicate', async () => {
    const { handlers, calls } = server('owner', [
      { id: lid(1), projectId: PID, name: 'Bug', color: 'red' },
    ]);
    stubFetch(handlers);
    const user = open();
    await screen.findByRole('form', { name: 'Edit label Bug' });
    await user.click(screen.getByRole('button', { name: 'Create label' }));
    expect(await screen.findByText('Name is required')).toBeVisible();
    expect(screen.getByLabelText('New label name')).toHaveFocus();
    expect(calls).toHaveLength(0);

    await user.type(screen.getByLabelText('New label name'), 'bug');
    await user.click(screen.getByRole('button', { name: 'Create label' }));
    expect(await screen.findByText('A label with this name already exists')).toBeVisible();
    expect(screen.getAllByRole('form', { name: /Edit label/ })).toHaveLength(1);
  });

  it('asks before deleting and then removes the label', async () => {
    const { handlers, calls } = server('owner', [
      { id: lid(1), projectId: PID, name: 'Bug', color: 'red' },
    ]);
    stubFetch(handlers);
    const user = open();
    const row = await screen.findByRole('form', { name: 'Edit label Bug' });
    await user.click(within(row).getByRole('button', { name: 'Delete label' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete label Bug?' });
    expect(within(dialog).getByText(/No card uses this label/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Delete label' }));
    await waitFor(() =>
      expect(calls).toEqual([{ method: 'DELETE', path: 'label 1', body: undefined }]),
    );
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Edit label Bug' })).not.toBeInTheDocument(),
    );
  });

  it('is read-only for a viewer', async () => {
    const { handlers } = server('viewer', [
      { id: lid(1), projectId: PID, name: 'Bug', color: 'red' },
    ]);
    stubFetch(handlers);
    open();
    expect(await screen.findByText('Bug')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create label' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete label' })).not.toBeInTheDocument();
  });
});
