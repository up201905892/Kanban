import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CLIENT_MUTATION_HEADER, compareByPosition, type BoardEvent } from '@kanban/shared';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';
import { FakeWebSocket } from '../../test-utils/websocket';

const WID = '0192f000-0000-7000-8000-000000000001';
const PID = '0192f000-0000-7000-8000-0000000000a1';
const BID = '0192f000-0000-7000-8000-0000000000b1';
const cid = (n: number) => `0192f000-0000-7000-8000-0000000000c${n}`;
const kid = (n: number) => `0192f000-0000-7000-8000-0000000000d${n}`;
const ANA = '0192f000-0000-7000-8000-0000000000e2';
const NOW = '2026-11-10T10:00:00.000Z';

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
}

const columns = [
  { id: cid(1), boardId: BID, name: 'To do', position: 'a0', isDone: false },
  { id: cid(2), boardId: BID, name: 'Done', position: 'a1', isDone: true },
];
const members = [
  { userId: USER.id, name: 'Ada', email: 'ada@example.com', role: 'owner', joinedAt: NOW },
  { userId: ANA, name: 'Ana', email: 'ana@example.com', role: 'member', joinedAt: NOW },
];

const card = (n: number, extra: Partial<Cd> = {}): Cd => ({
  id: kid(n),
  columnId: cid(1),
  number: n,
  title: `Card ${n}`,
  position: `a${n}`,
  version: 1,
  assigneeId: null,
  priority: 'none',
  estimate: null,
  ...extra,
});

/** Board request counter of the most recent `server()`. */
let latest = { board: 0 };
let latestCards: Cd[] = [];

function server(role: string, cards: Cd[]) {
  const counts = { board: 0 };
  latest = counts;
  latestCards = cards;
  const handlers = {
    'GET /api/auth/me': () => jsonResponse(200, { user: USER }),
    'GET /api/workspaces': () => jsonResponse(200, { workspaces: [] }),
    [`GET /api/workspaces/${WID}/members`]: () => jsonResponse(200, { members }),
    [`GET /api/workspaces/${WID}`]: () =>
      jsonResponse(200, { workspace: { id: WID, name: 'Acme', createdAt: NOW, role } }),
    [`GET /api/projects/${PID}`]: () =>
      jsonResponse(200, {
        project: { id: PID, workspaceId: WID, name: 'Kanban Board', key: 'KB', createdAt: NOW },
      }),
    [`GET /api/projects/${PID}/board`]: () => {
      counts.board += 1;
      return jsonResponse(200, {
        board: { id: BID, projectId: PID },
        columns,
        cards: [...cards].sort(compareByPosition),
      });
    },
    ...Object.fromEntries(
      [1, 2, 3].map((n) => [
        `GET /api/cards/${kid(n)}`,
        () => {
          const found = cards.find((c) => c.id === kid(n));
          return found
            ? jsonResponse(200, {
                card: {
                  ...found,
                  boardId: BID,
                  description: 'Initial text',
                  createdById: USER.id,
                  createdAt: NOW,
                  updatedAt: NOW,
                },
              })
            : jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Resource not found' } });
        },
      ]),
    ),
  };
  return { handlers, counts, cards };
}

const base = { boardId: BID, actorId: ANA, at: NOW };
const cardEvent = (
  type: 'card_created' | 'card_updated' | 'card_moved',
  c: Cd,
  extra: { clientMutationId?: string } = {},
): BoardEvent => ({ type, ...base, ...extra, entity: c, version: c.version }) as BoardEvent;
const deleted = (c: Cd): BoardEvent => ({
  type: 'card_deleted',
  ...base,
  entity: { id: c.id, columnId: c.columnId, number: c.number, title: c.title },
  version: c.version + 1,
});

function open(path = `/projects/${PID}`) {
  const user = userEvent.setup();
  render(<App router={createTestRouter([path])} />);
  return user;
}

/** Waits until the board is shown and its socket exists, then returns the socket. */
async function connected(): Promise<FakeWebSocket> {
  await screen.findByRole('region', { name: 'Column To do' });
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const socket = FakeWebSocket.last;
  const requests = latest.board;
  act(() => socket.open());
  // Connecting refetches the board: let that settle so it cannot overwrite what a test sends next.
  await waitFor(() => expect(latest.board).toBe(requests + 1));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return socket;
}

/** Delivers an event; the fake server state follows it, as a real server's would have. */
const send = (socket: FakeWebSocket, event: BoardEvent) => {
  const cards = latestCards;
  const index = cards.findIndex((c) => c.id === event.entity.id);
  if (event.type === 'card_deleted') {
    if (index >= 0) cards.splice(index, 1);
  } else if (event.type.startsWith('card_')) {
    const entity = event.entity as Cd;
    if (index >= 0) cards[index] = entity;
    else cards.push(entity);
  }
  act(() => socket.receive(event));
};
const polite = () => screen.getByTestId('live-polite');

describe('live board updates', () => {
  it('connects to the board room of the project', async () => {
    stubFetch(server('owner', []).handlers);
    open();
    const socket = await connected();
    expect(socket.url).toMatch(new RegExp(`^wss?://[^/]+/ws/board:${BID}$`));
  });

  it('shows remote creates, edits, moves and deletes without reloading', async () => {
    const s = server('owner', [card(1)]);
    stubFetch(s.handlers);
    open();
    const socket = await connected();

    send(socket, cardEvent('card_created', card(2)));
    expect(await screen.findByRole('link', { name: 'KB-2 Card 2' })).toBeVisible();

    send(socket, cardEvent('card_updated', card(2, { title: 'Renamed', version: 2 })));
    expect(await screen.findByRole('link', { name: 'KB-2 Renamed' })).toBeVisible();

    send(
      socket,
      cardEvent('card_moved', card(2, { title: 'Renamed', columnId: cid(2), version: 3 })),
    );
    const done = screen.getByRole('region', { name: 'Column Done' });
    expect(await within(done).findByRole('link', { name: 'KB-2 Renamed' })).toBeVisible();

    send(socket, deleted(card(2, { title: 'Renamed', columnId: cid(2), version: 3 })));
    await waitFor(() => expect(screen.queryByRole('link', { name: /KB-2/ })).toBeNull());
  });

  it('applies events for a viewer too', async () => {
    stubFetch(server('viewer', [card(1)]).handlers);
    open();
    const socket = await connected();
    send(socket, cardEvent('card_updated', card(1, { title: 'Seen by viewer', version: 2 })));
    expect(await screen.findByRole('link', { name: 'KB-1 Seen by viewer' })).toBeVisible();
  });

  it('ignores stale and duplicate events', async () => {
    stubFetch(server('owner', [card(1, { title: 'Current', version: 5 })]).handlers);
    open();
    const socket = await connected();
    send(socket, cardEvent('card_updated', card(1, { title: 'Old', version: 4 })));
    send(socket, cardEvent('card_updated', card(1, { title: 'Same version', version: 5 })));
    expect(screen.getByRole('link', { name: 'KB-1 Current' })).toBeVisible();
  });

  it('ignores the echo of its own mutation', async () => {
    const s = server('owner', []);
    const fetchMock = stubFetch({
      ...s.handlers,
      [`POST /api/columns/${cid(1)}/cards`]: (body) => {
        const { id, title } = body as { id: string; title: string };
        const created = card(1, { id, title });
        s.cards.push(created);
        return jsonResponse(201, {
          card: {
            ...created,
            boardId: BID,
            description: '',
            createdById: USER.id,
            createdAt: NOW,
            updatedAt: NOW,
          },
        });
      },
    });
    const user = open();
    const socket = await connected();
    await user.click(await screen.findByRole('button', { name: 'Add card to To do' }));
    await user.type(screen.getByLabelText('Card title'), 'Mine{Enter}');
    expect(await screen.findByRole('link', { name: 'KB-1 Mine' })).toBeVisible();

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const headers = post?.[1]?.headers as Record<string, string>;
    const mutationId = headers[CLIENT_MUTATION_HEADER] ?? '';
    expect(mutationId).toMatch(/^[0-9a-f-]{36}$/);

    // Its echo (carrying that id) is skipped: a different title would otherwise replace the card.
    send(
      socket,
      cardEvent('card_updated', card(1, { title: 'Echo', version: 9 }), {
        clientMutationId: mutationId,
      }),
    );
    expect(screen.queryByRole('link', { name: 'KB-1 Echo' })).toBeNull();
    // The same event from someone else is applied.
    send(socket, cardEvent('card_updated', card(1, { title: 'Echo', version: 9 })));
    expect(await screen.findByRole('link', { name: 'KB-1 Echo' })).toBeVisible();
  });

  it('refetches the board on connect and on every reconnect', async () => {
    const s = server('owner', [card(1)]);
    stubFetch(s.handlers);
    open();
    await screen.findByRole('region', { name: 'Column To do' });
    const before = s.counts.board;
    const socket = await connected();
    await waitFor(() => expect(s.counts.board).toBe(before + 1));

    // The connection drops and comes back: the missed changes are fetched again.
    s.cards.push(card(2));
    act(() => socket.close(1006));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2), { timeout: 3000 });
    act(() => FakeWebSocket.last.open());
    expect(await screen.findByRole('link', { name: 'KB-2 Card 2' })).toBeVisible();
    expect(s.counts.board).toBe(before + 2);
  });

  it('does not reconnect after the server refuses the user', async () => {
    stubFetch(server('owner', []).handlers);
    open();
    const socket = await connected();
    act(() => socket.close(4403));
    await new Promise((r) => setTimeout(r, 700));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('live updates and accessibility', () => {
  const remoteMove = (c: Cd) =>
    cardEvent('card_moved', { ...c, columnId: cid(2), version: c.version + 1 });

  it('announces a remote move of the focused card and keeps focus on it', async () => {
    stubFetch(server('owner', [card(7)]).handlers);
    open();
    const socket = await connected();
    const tile = await screen.findByRole('link', { name: 'KB-7 Card 7' });
    tile.focus();
    expect(tile).toHaveFocus();

    send(socket, remoteMove(card(7)));
    await waitFor(() => expect(polite()).toHaveTextContent('Card KB-7 was moved to Done by Ana'));
    const done = screen.getByRole('region', { name: 'Column Done' });
    const moved = await within(done).findByRole('link', { name: 'KB-7 Card 7' });
    await waitFor(() => expect(moved).toHaveFocus());
  });

  it('keeps focus on the move handle of the card too', async () => {
    stubFetch(server('owner', [card(7)]).handlers);
    open();
    const socket = await connected();
    const handle = await screen.findByRole('button', { name: 'Move card KB-7' });
    handle.focus();
    send(socket, remoteMove(card(7)));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Move card KB-7' })).toHaveFocus(),
    );
    await waitFor(() => expect(polite()).toHaveTextContent('Card KB-7 was moved to Done by Ana'));
  });

  it('does not announce moves of cards that are not focused', async () => {
    stubFetch(server('owner', [card(1), card(7)]).handlers);
    open();
    const socket = await connected();
    (await screen.findByRole('link', { name: 'KB-1 Card 1' })).focus();
    send(socket, remoteMove(card(7)));
    const done = screen.getByRole('region', { name: 'Column Done' });
    expect(await within(done).findByRole('link', { name: 'KB-7 Card 7' })).toBeVisible();
    await new Promise((r) => setTimeout(r, 150));
    expect(polite()).toBeEmptyDOMElement();
  });

  it('updates the open card dialog in place without touching a field being edited', async () => {
    stubFetch(server('owner', [card(1)]).handlers);
    const user = open(`/projects/${PID}/cards/1`);
    const socket = await connected();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Initial text');

    // The estimate is being typed; a remote title and priority change arrives.
    const estimate = within(dialog).getByLabelText(/estimate/i);
    await user.type(estimate, '8');
    send(
      socket,
      cardEvent('card_updated', card(1, { title: 'Remote title', priority: 'high', version: 2 })),
    );
    expect(await within(dialog).findByRole('heading', { name: 'Remote title' })).toBeVisible();
    expect(within(dialog).getByLabelText('Priority')).toHaveValue('high');
    expect(estimate).toHaveValue(8);

    // A remote estimate change does not overwrite the typed value either.
    send(
      socket,
      cardEvent('card_updated', card(1, { title: 'Remote title', estimate: 3, version: 3 })),
    );
    await waitFor(() => expect(within(dialog).getByLabelText('Priority')).toHaveValue('high'));
    expect(estimate).toHaveValue(8);
  });

  it('follows a remote estimate change when the field is untouched', async () => {
    stubFetch(server('owner', [card(1)]).handlers);
    open(`/projects/${PID}/cards/1`);
    const socket = await connected();
    const dialog = await screen.findByRole('dialog');
    const estimate = await within(dialog).findByLabelText(/estimate/i);
    send(socket, cardEvent('card_updated', card(1, { estimate: 5, version: 2 })));
    await waitFor(() => expect(estimate).toHaveValue(5));
  });

  it('says the card was deleted by name and closes on confirm', async () => {
    stubFetch(server('owner', [card(1)]).handlers);
    const user = open(`/projects/${PID}/cards/1`);
    const socket = await connected();
    await screen.findByRole('dialog');
    await screen.findByText('Initial text');

    send(socket, deleted(card(1)));
    expect(await screen.findByText('This card was deleted by Ana')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('link', { name: /KB-1/ })).toBeNull();
  });
});
