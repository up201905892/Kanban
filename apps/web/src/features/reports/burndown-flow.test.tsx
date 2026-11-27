import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toCalendarDate } from '@kanban/shared';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';
import { FakeWebSocket } from '../../test-utils/websocket';

const WID = '0192f000-0000-7000-8000-000000000001';
const PID = '0192f000-0000-7000-8000-0000000000a1';
const BID = '0192f000-0000-7000-8000-0000000000b1';
const SID = '0192f000-0000-7000-8000-0000000000e1';
const NOW = '2026-11-16T10:00:00.000Z';

const DAY = 24 * 60 * 60 * 1000;
const dayOffset = (n: number) => toCalendarDate(new Date(Date.now() + n * DAY));

const sprint = {
  id: SID,
  projectId: PID,
  name: 'Sprint 1',
  goal: '',
  startDate: dayOffset(-1),
  endDate: dayOffset(3),
  status: 'active',
  committedPoints: 30,
  completedPoints: null,
  closedAt: null,
  createdAt: NOW,
};

function server(sprints: object[], burndown?: object) {
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
        sprints,
        labels: [],
      }),
    [`GET /api/projects/${PID}/velocity`]: () =>
      jsonResponse(200, { sprints: [], averageCompleted: 0 }),
    [`GET /api/sprints/${SID}/burndown`]: () => jsonResponse(200, burndown),
  };
}

const open = () => {
  const user = userEvent.setup();
  render(<App router={createTestRouter([`/projects/${PID}/reports`])} />);
  return user;
};

describe('burndown report', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  it('shows the text summary and a table alternative reachable by keyboard', async () => {
    stubFetch(
      server([sprint], {
        days: [
          { date: dayOffset(-1), remainingPoints: 30, scopePoints: 30 },
          { date: dayOffset(0), remainingPoints: 12, scopePoints: 30 },
        ],
        ideal: [-1, 0, 1, 2, 3].map((n, i) => ({ date: dayOffset(n), points: 30 - i * 7.5 })),
        unestimatedCount: 1,
      }),
    );
    const user = open();
    expect(await screen.findByText('12 of 30 points remaining, 3 days left')).toBeVisible();
    expect(screen.getByRole('img', { name: /Burndown chart/ })).toBeVisible();
    expect(screen.getByText('1 card is not estimated and count as 0 points.')).toBeVisible();

    await user.tab();
    await user.tab();
    const toggle = screen.getByRole('button', { name: 'Show as table' });
    toggle.focus();
    await user.keyboard('{Enter}');

    const table = screen.getByRole('table', { name: /Burndown of Sprint 1/ });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    const today = within(table).getByRole('row', { name: new RegExp(dayOffset(0)) });
    expect(within(today).getAllByRole('cell')[0]).toHaveTextContent('12');
    // Days that have not happened have no real values.
    const future = within(table).getByRole('row', { name: new RegExp(dayOffset(3)) });
    expect(within(future).getAllByRole('cell')[0]).toHaveTextContent('–');
    expect(screen.getByRole('button', { name: 'Show as chart' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says so when there is no active sprint', async () => {
    stubFetch(server([{ ...sprint, status: 'planned' }]));
    open();
    expect(await screen.findByRole('heading', { name: 'No active sprint' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to the backlog' })).toBeVisible();
  });

  it('says so when no card has an estimate', async () => {
    stubFetch(
      server([sprint], {
        days: [{ date: dayOffset(0), remainingPoints: 0, scopePoints: 0 }],
        ideal: [{ date: dayOffset(0), points: 0 }],
        unestimatedCount: 2,
      }),
    );
    open();
    expect(await screen.findByRole('heading', { name: 'No estimated cards' })).toBeVisible();
    expect(screen.getByText(/2 cards have no estimate yet/)).toBeVisible();
  });
});
