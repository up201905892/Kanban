import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';
import { FakeWebSocket } from '../../test-utils/websocket';

const WID = '0192f000-0000-7000-8000-000000000001';
const PID = '0192f000-0000-7000-8000-0000000000a1';
const BID = '0192f000-0000-7000-8000-0000000000b1';
const TODO = '0192f000-0000-7000-8000-0000000000c1';
const DONE = '0192f000-0000-7000-8000-0000000000c2';
const SID = '0192f000-0000-7000-8000-0000000000e1';
const kid = (n: number) => `0192f000-0000-7000-8000-0000000000d${n}`;
const NOW = '2026-11-16T10:00:00.000Z';

interface Cd {
  id: string;
  columnId: string;
  number: number;
  title: string;
  position: string;
  version: number;
  assigneeId: string | null;
  priority: string;
  estimate: number | null;
  sprintId: string | null;
  labelIds: string[];
}

const card = (n: number, columnId: string, estimate: number | null, sprintId: string | null) => ({
  id: kid(n),
  columnId,
  number: n,
  title: `Card ${n}`,
  position: `a${n}`,
  version: 1,
  assigneeId: null,
  priority: 'none',
  estimate,
  sprintId,
  labelIds: [],
});

const activeSprint = {
  id: SID,
  projectId: PID,
  name: 'Sprint 1',
  goal: '',
  startDate: '2026-11-16',
  endDate: '2026-11-27',
  status: 'active',
  committedPoints: 11,
  completedPoints: null,
  closedAt: null,
  createdAt: NOW,
};

/** Two cards in Done (3 + 1 points) and two unfinished in a sprint, one backlog card. */
function server(role: string, closeResponse?: () => Response) {
  const cards: Cd[] = [
    card(1, DONE, 3, SID),
    card(2, DONE, 1, SID),
    card(3, TODO, 5, SID),
    card(4, TODO, null, SID),
    card(5, TODO, 2, null),
  ];
  const sprints: object[] = [activeSprint];
  const calls: string[] = [];
  return {
    cards,
    calls,
    handlers: {
      'GET /api/auth/me': () => jsonResponse(200, { user: USER }),
      'GET /api/workspaces': () => jsonResponse(200, { workspaces: [] }),
      [`GET /api/workspaces/${WID}/members`]: () => jsonResponse(200, { members: [] }),
      [`GET /api/workspaces/${WID}`]: () =>
        jsonResponse(200, { workspace: { id: WID, name: 'Acme', createdAt: NOW, role } }),
      [`GET /api/projects/${PID}`]: () =>
        jsonResponse(200, {
          project: { id: PID, workspaceId: WID, name: 'Kanban Board', key: 'KB', createdAt: NOW },
        }),
      [`GET /api/projects/${PID}/board`]: () =>
        jsonResponse(200, {
          board: { id: BID, projectId: PID },
          columns: [
            { id: TODO, boardId: BID, name: 'To do', position: 'a0', isDone: false },
            { id: DONE, boardId: BID, name: 'Done', position: 'a1', isDone: true },
          ],
          cards,
          sprints,
          labels: [],
        }),
      [`POST /api/sprints/${SID}/close`]:
        closeResponse ??
        (() => {
          calls.push('close');
          for (const c of cards) if (c.sprintId === SID && c.columnId === TODO) c.sprintId = null;
          sprints.length = 0;
          return jsonResponse(200, { completedCards: 2, completedPoints: 4, returnedCards: 2 });
        }),
    },
  };
}

function open() {
  const user = userEvent.setup();
  render(<App router={createTestRouter([`/projects/${PID}/backlog`])} />);
  return user;
}

describe('complete a sprint', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  it('confirms with what will happen, closes, shows a summary and updates the backlog', async () => {
    const { handlers, calls } = server('member');
    stubFetch(handlers);
    const user = open();
    const trigger = await screen.findByRole('button', { name: 'Complete sprint Sprint 1' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Complete Sprint 1?' });
    expect(
      within(dialog).getByText('2 done (4 points), 2 will return to the backlog.'),
    ).toBeVisible();
    // Focus moves into the dialog and nothing was sent yet.
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(calls).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Complete sprint' }));
    const summary = await screen.findByRole('dialog', { name: 'Sprint 1 completed' });
    expect(within(summary).getByRole('status')).toHaveTextContent(
      '2 done (4 points), 2 returned to the backlog.',
    );
    expect(calls).toEqual(['close']);
    // The result is also announced politely.
    expect(await screen.findAllByText(/Sprint Sprint 1 completed: 2 done/)).not.toHaveLength(0);

    await user.click(within(summary).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('region', { name: 'Sprint 1' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Backlog' })).toHaveFocus();
    const backlog = screen.getByRole('region', { name: 'Backlog' });
    expect(within(backlog).getByRole('link', { name: /KB-3 Card 3/ })).toBeVisible();
    expect(within(backlog).getByRole('link', { name: /KB-4 Card 4/ })).toBeVisible();
    expect(within(backlog).queryByRole('link', { name: /KB-1 Card 1/ })).toBeNull();
  });

  it('can be cancelled with Escape and sends nothing', async () => {
    const { handlers, calls } = server('owner');
    stubFetch(handlers);
    const user = open();
    const trigger = await screen.findByRole('button', { name: 'Complete sprint Sprint 1' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls).toHaveLength(0);
    expect(trigger).toHaveFocus();
  });

  it('shows the error and keeps the sprint when the server refuses', async () => {
    const { handlers } = server('owner', () =>
      jsonResponse(409, {
        error: { code: 'SPRINT_NOT_ACTIVE', message: 'Only an active sprint can be closed' },
      }),
    );
    stubFetch(handlers);
    const user = open();
    await user.click(await screen.findByRole('button', { name: 'Complete sprint Sprint 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Complete Sprint 1?' });
    await user.click(within(dialog).getByRole('button', { name: 'Complete sprint' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Only an active sprint can be closed',
    );
    expect(screen.getByRole('region', { name: 'Sprint 1' })).toBeVisible();
  });

  it('offers no button to a viewer', async () => {
    stubFetch(server('viewer').handlers);
    open();
    await screen.findByRole('region', { name: 'Sprint 1' });
    expect(screen.queryByRole('button', { name: /Complete sprint/ })).toBeNull();
  });
});
