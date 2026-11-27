import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardEvent } from '@kanban/shared';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';
import { FakeWebSocket } from '../../test-utils/websocket';

const WID = '0192f000-0000-7000-8000-000000000001';
const PID = '0192f000-0000-7000-8000-0000000000a1';
const BID = '0192f000-0000-7000-8000-0000000000b1';
const COL = '0192f000-0000-7000-8000-0000000000c1';
const kid = (n: number) => `0192f000-0000-7000-8000-0000000000d${n}`;
const sid = (n: number) => `0192f000-0000-7000-8000-0000000000e${n}`;
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

interface Sp {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  status: string;
  committedPoints: number | null;
  completedPoints: number | null;
  closedAt: string | null;
  createdAt: string;
}

const card = (n: number, estimate: number | null, sprintId: string | null = null): Cd => ({
  id: kid(n),
  columnId: COL,
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

const sprint = (n: number, status = 'planned', extra: Partial<Sp> = {}): Sp => ({
  id: sid(n),
  projectId: PID,
  name: `Sprint ${n}`,
  goal: '',
  startDate: '2026-11-16',
  endDate: '2026-11-27',
  status,
  committedPoints: null,
  completedPoints: null,
  closedAt: null,
  createdAt: NOW,
  ...extra,
});

type Handler = (body: unknown) => Response;

function server(role: string, cards: Cd[], sprints: Sp[]) {
  const calls: { path: string; body: unknown }[] = [];
  const fullCard = (c: Cd) => ({
    ...c,
    boardId: BID,
    description: '',
    createdById: USER.id,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const handlers: Record<string, Handler> = {
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
        columns: [{ id: COL, boardId: BID, name: 'To do', position: 'a0', isDone: false }],
        cards,
        sprints,
        labels: [],
      }),
    // The server keeps the state, so the refetch after a change agrees with it.
    [`POST /api/projects/${PID}/sprints`]: (body) => {
      calls.push({ path: 'create sprint', body });
      const created = sprint(sprints.length + 1, 'planned', body as Partial<Sp>);
      sprints.push(created);
      return jsonResponse(201, { sprint: created });
    },
  };
  for (const c of cards) {
    handlers[`PUT /api/cards/${c.id}/sprint`] = (body) => {
      calls.push({ path: `card ${c.number}`, body });
      c.sprintId = (body as { sprintId: string | null }).sprintId;
      c.version += 1;
      return jsonResponse(200, { card: fullCard(c) });
    };
  }
  for (const s of sprints) {
    handlers[`POST /api/sprints/${s.id}/start`] = () => {
      calls.push({ path: `start ${s.name}`, body: undefined });
      s.status = 'active';
      s.committedPoints = cards
        .filter((c) => c.sprintId === s.id)
        .reduce((total, c) => total + (c.estimate ?? 0), 0);
      return jsonResponse(200, { sprint: s });
    };
  }
  return { handlers, calls };
}

function open(path: string) {
  const user = userEvent.setup();
  render(<App router={createTestRouter([path])} />);
  return user;
}

const backlogPath = `/projects/${PID}/backlog`;

describe('backlog page', () => {
  it('shows one labelled section per sprint and the backlog, with point totals', async () => {
    const cards = [card(1, 5, sid(1)), card(2, null, sid(1)), card(3, 3), card(4, null)];
    stubFetch(server('owner', cards, [sprint(1, 'active'), sprint(2)]).handlers);
    open(backlogPath);
    expect(
      await screen.findByRole('heading', { level: 1, name: /Backlog: Kanban Board/ }),
    ).toBeVisible();

    const one = screen.getByRole('region', { name: 'Sprint 1' });
    expect(within(one).getByText(/Active/)).toBeVisible();
    expect(within(one).getByText(/16 Nov 2026 to 27 Nov 2026/)).toBeVisible();
    expect(within(one).getByText(/5 points, 1 not estimated/)).toBeVisible();
    expect(within(one).getByRole('link', { name: /KB-1 Card 1/ })).toBeVisible();

    const two = screen.getByRole('region', { name: 'Sprint 2' });
    expect(within(two).getByText(/No cards in this sprint yet/)).toBeVisible();

    const backlog = screen.getByRole('region', { name: 'Backlog' });
    expect(within(backlog).getByText(/2 cards · 3 points, 1 not estimated/)).toBeVisible();
    expect(within(backlog).queryByText(/Card 1/)).toBeNull();
  });

  it('has empty states for no sprints and an empty backlog', async () => {
    stubFetch(server('owner', [], []).handlers);
    open(backlogPath);
    expect(await screen.findByRole('heading', { name: 'No sprints yet' })).toBeVisible();
    expect(screen.getByText(/The backlog is empty/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create sprint' })).toBeVisible();
  });

  it('shows a viewer the plan with no actions', async () => {
    stubFetch(server('viewer', [card(1, 2), card(2, 1, sid(1))], [sprint(1)]).handlers);
    open(backlogPath);
    await screen.findByRole('region', { name: 'Sprint 1' });
    expect(screen.queryByRole('button', { name: 'Create sprint' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Start sprint/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit sprint/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add to sprint/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove from sprint/ })).toBeNull();
  });

  it('adds a card to a sprint with the keyboard and announces it', async () => {
    const { handlers, calls } = server('owner', [card(1, 5)], [sprint(1)]);
    stubFetch(handlers);
    const user = open(backlogPath);
    const add = await screen.findByRole('button', { name: 'Add to sprint: KB-1' });
    add.focus();
    await user.keyboard('{Enter}');

    const sprintSection = screen.getByRole('region', { name: 'Sprint 1' });
    expect(await within(sprintSection).findByRole('link', { name: /KB-1 Card 1/ })).toBeVisible();
    expect(within(sprintSection).getByText(/5 points/)).toBeVisible();
    expect(await screen.findByText('Card KB-1 added to Sprint 1')).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ path: 'card 1', body: { sprintId: sid(1) } });
    expect(screen.getByRole('heading', { name: 'Backlog' })).toHaveFocus();
  });

  it('offers every open sprint, defaulting to the active one', async () => {
    const { handlers, calls } = server(
      'owner',
      [card(1, 5)],
      [sprint(1), sprint(2, 'active', { startDate: '2026-12-01' })],
    );
    stubFetch(handlers);
    const user = open(backlogPath);
    const select = await screen.findByRole('combobox', { name: 'Sprint for KB-1' });
    expect(select).toHaveValue(sid(2));
    await user.selectOptions(select, sid(1));
    await user.click(screen.getByRole('button', { name: 'Add to sprint: KB-1' }));
    await waitFor(() => expect(calls[0]).toMatchObject({ body: { sprintId: sid(1) } }));
  });

  it('removes a card from a sprint', async () => {
    const { handlers, calls } = server('member', [card(1, 2, sid(1))], [sprint(1)]);
    stubFetch(handlers);
    const user = open(backlogPath);
    await user.click(await screen.findByRole('button', { name: 'Remove from sprint: KB-1' }));
    const backlog = screen.getByRole('region', { name: 'Backlog' });
    expect(await within(backlog).findByRole('link', { name: /KB-1 Card 1/ })).toBeVisible();
    expect(calls[0]).toMatchObject({ body: { sprintId: null } });
    expect(await screen.findByText('Card KB-1 removed from Sprint 1')).toBeInTheDocument();
  });

  it('puts the card back and announces the error when the server refuses', async () => {
    const { handlers } = server('owner', [card(1, 5)], [sprint(1)]);
    stubFetch({
      ...handlers,
      [`PUT /api/cards/${kid(1)}/sprint`]: () =>
        jsonResponse(409, { error: { code: 'SPRINT_CLOSED', message: 'This sprint is closed' } }),
    });
    const user = open(backlogPath);
    await user.click(await screen.findByRole('button', { name: 'Add to sprint: KB-1' }));
    expect(await screen.findByText(/This sprint is closed/)).toBeInTheDocument();
    const backlog = screen.getByRole('region', { name: 'Backlog' });
    await waitFor(() =>
      expect(within(backlog).getByRole('link', { name: /KB-1 Card 1/ })).toBeVisible(),
    );
  });

  it('creates a sprint: labelled date fields, validation, then the request', async () => {
    const { handlers, calls } = server('owner', [], []);
    stubFetch(handlers);
    const user = open(backlogPath);
    await user.click(await screen.findByRole('button', { name: 'Create sprint' }));
    const dialog = screen.getByRole('dialog', { name: 'Create sprint' });
    const name = within(dialog).getByLabelText('Name');
    const start = within(dialog).getByLabelText('Start date');
    const end = within(dialog).getByLabelText('End date');
    expect(start).toHaveAttribute('type', 'date');
    expect(end).toHaveAttribute('type', 'date');

    // An empty name is refused before any request; focus goes to the field.
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription('Name is required');

    await user.type(name, 'Sprint A');
    await user.clear(start);
    await user.type(start, '2026-11-20');
    await user.clear(end);
    await user.type(end, '2026-11-19');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(end).toHaveAccessibleDescription('End date must be on or after the start date');
    expect(calls).toHaveLength(0);

    await user.clear(end);
    await user.type(end, '2026-11-27');
    await user.clear(start);
    await user.type(start, '2026-11-16');
    await user.type(within(dialog).getByLabelText(/Goal/), 'Ship it');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls[0]?.body).toMatchObject({
      name: 'Sprint A',
      goal: 'Ship it',
      startDate: '2026-11-16',
      endDate: '2026-11-27',
    });
    expect(await screen.findByRole('region', { name: 'Sprint A' })).toBeVisible();
  });

  it('asks for confirmation before starting, then shows the sprint as active', async () => {
    const { handlers, calls } = server(
      'owner',
      [card(1, 5, sid(1)), card(2, 3, sid(1))],
      [sprint(1)],
    );
    stubFetch(handlers);
    const user = open(backlogPath);
    await user.click(await screen.findByRole('button', { name: 'Start sprint Sprint 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Start Sprint 1?' });
    expect(within(dialog).getByText(/2 cards, 8 points will be committed/)).toBeVisible();
    expect(calls).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Start sprint' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls).toHaveLength(1);
    expect(
      within(screen.getByRole('region', { name: 'Sprint 1' })).getByText(/Active/),
    ).toBeVisible();
    expect(await screen.findByText('Sprint Sprint 1 started')).toBeInTheDocument();
  });

  it('keeps the dialog open and shows the server message when another sprint is active', async () => {
    const { handlers } = server('owner', [], [sprint(1)]);
    stubFetch({
      ...handlers,
      [`POST /api/sprints/${sid(1)}/start`]: () =>
        jsonResponse(409, {
          error: { code: 'SPRINT_ALREADY_ACTIVE', message: 'Another sprint is already active.' },
        }),
    });
    const user = open(backlogPath);
    await user.click(await screen.findByRole('button', { name: 'Start sprint Sprint 1' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Start sprint' }),
    );
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'Another sprint is already active.',
    );
  });

  it('disables starting a second sprint and says why', async () => {
    stubFetch(server('owner', [], [sprint(1, 'active'), sprint(2)]).handlers);
    open(backlogPath);
    const start = await screen.findByRole('button', { name: 'Start sprint Sprint 2' });
    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(/Sprint 1 is active/);
  });

  it('shows a sprint that another person created, as it happens', async () => {
    stubFetch(server('owner', [], []).handlers);
    open(backlogPath);
    await screen.findByRole('heading', { name: 'No sprints yet' });
    await waitFor(() => expect(FakeWebSocket.boards).toHaveLength(1));
    const socket = FakeWebSocket.boards[0] as FakeWebSocket;
    act(() => socket.open());
    // Connecting refetches the board: let that settle so it cannot overwrite the event below.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const event = {
      type: 'sprint_updated',
      boardId: BID,
      actorId: '0192f000-0000-7000-8000-0000000000aa',
      at: NOW,
      entity: sprint(1, 'planned', { name: 'From Ana' }),
      version: null,
    } as BoardEvent;
    act(() => socket.receive(event));
    expect(await screen.findByRole('region', { name: 'From Ana' })).toBeVisible();
  });
});

describe('board and the active sprint', () => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = (offset: number) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  it('filters to the active sprint by default, with its name, dates and days left', async () => {
    const cards = [card(1, 2, sid(1)), card(2, 3), card(3, 1, sid(2))];
    const active = sprint(1, 'active', { startDate: day(-3), endDate: day(4) });
    stubFetch(server('owner', cards, [active, sprint(2)]).handlers);
    const user = open(`/projects/${PID}`);
    const banner = await screen.findByRole('region', { name: 'Active sprint' });
    expect(within(banner).getByText('Sprint 1')).toBeVisible();
    expect(within(banner).getByText(/4 days left/)).toBeVisible();
    const filter = within(banner).getByRole('checkbox', { name: 'Active sprint only' });
    expect(filter).toBeChecked();

    expect(screen.getByRole('link', { name: /KB-1/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /KB-2/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /KB-3/ })).toBeNull();

    await user.click(filter);
    expect(screen.getByRole('link', { name: /KB-2/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /KB-3/ })).toBeVisible();
  });

  it('shows no banner or filter without an active sprint', async () => {
    stubFetch(server('owner', [card(1, 2), card(2, 3, sid(2))], [sprint(2)]).handlers);
    open(`/projects/${PID}`);
    await screen.findByRole('region', { name: 'Column To do' });
    expect(screen.queryByRole('region', { name: 'Active sprint' })).toBeNull();
    expect(screen.getByRole('link', { name: /KB-1/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /KB-2/ })).toBeVisible();
  });

  it('links to the backlog', async () => {
    stubFetch(server('owner', [], []).handlers);
    open(`/projects/${PID}`);
    expect(await screen.findByRole('link', { name: 'Backlog and sprints' })).toHaveAttribute(
      'href',
      backlogPath,
    );
  });
});
