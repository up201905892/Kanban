import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';
import { FakeWebSocket } from '../../test-utils/websocket';

const WID = '0192f000-0000-7000-8000-000000000001';
const PID = '0192f000-0000-7000-8000-0000000000a1';
const BID = '0192f000-0000-7000-8000-0000000000b1';
const NOW = '2026-11-16T10:00:00.000Z';

function server(velocity: object) {
  return {
    'GET /api/auth/me': () => jsonResponse(200, { user: USER }),
    'GET /api/workspaces': () => jsonResponse(200, { workspaces: [] }),
    [`GET /api/workspaces/${WID}/members`]: () => jsonResponse(200, { members: [] }),
    [`GET /api/workspaces/${WID}`]: () =>
      jsonResponse(200, { workspace: { id: WID, name: 'Acme', createdAt: NOW, role: 'viewer' } }),
    [`GET /api/projects/${PID}`]: () =>
      jsonResponse(200, {
        project: { id: PID, workspaceId: WID, name: 'Kanban Board', key: 'KB', createdAt: NOW },
      }),
    [`GET /api/projects/${PID}/board`]: () =>
      jsonResponse(200, {
        board: { id: BID, projectId: PID },
        columns: [],
        cards: [],
        sprints: [],
        labels: [],
      }),
    [`GET /api/projects/${PID}/velocity`]: () => jsonResponse(200, velocity),
  };
}

const open = () => {
  const user = userEvent.setup();
  render(<App router={createTestRouter([`/projects/${PID}/reports`])} />);
  return user;
};

const sprintRow = (n: number, committedPoints: number, completedPoints: number) => ({
  id: `0192f000-0000-7000-8000-0000000000f${n}`,
  name: `Sprint ${n}`,
  committedPoints,
  completedPoints,
});

describe('velocity report', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  it('shows the summary and a table alternative reachable by keyboard', async () => {
    stubFetch(
      server({ sprints: [sprintRow(1, 10, 8), sprintRow(2, 12, 9)], averageCompleted: 8.5 }),
    );
    const user = open();
    expect(
      await screen.findByText(
        'Average velocity: 8.5 points completed per sprint over the last 2 sprints',
      ),
    ).toBeVisible();
    expect(screen.getByRole('img', { name: /Velocity chart/ })).toBeVisible();

    const toggle = screen.getByRole('button', { name: 'Show velocity as table' });
    toggle.focus();
    await user.keyboard('{Enter}');
    const table = screen.getByRole('table', { name: /Velocity/ });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3);
    const row = within(table).getByRole('row', { name: /Sprint 2/ });
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['12', '9']);
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('has an empty state before any sprint is closed', async () => {
    stubFetch(server({ sprints: [], averageCompleted: 0 }));
    open();
    expect(
      await screen.findByRole('heading', { name: 'Close a sprint to see velocity' }),
    ).toBeVisible();
  });
});
