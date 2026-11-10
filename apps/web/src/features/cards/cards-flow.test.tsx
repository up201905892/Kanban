import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { compareByPosition } from '@kanban/shared';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { descriptionSocket, serveDescription, type FakeRoom } from '../../test-utils/collab';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';
import type { FakeWebSocket } from '../../test-utils/websocket';

const WID = '0192f000-0000-7000-8000-000000000001';
const PID = '0192f000-0000-7000-8000-0000000000a1';
const BID = '0192f000-0000-7000-8000-0000000000b1';
const cid = (n: number) => `0192f000-0000-7000-8000-0000000000c${n}`;
const kid = (n: number) => `0192f000-0000-7000-8000-0000000000d${n}`;
const NOW = '2026-11-05T10:00:00.000Z';

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
  description: string;
}

const columns = [
  { id: cid(1), boardId: BID, name: 'To do', position: 'a0', isDone: false },
  { id: cid(2), boardId: BID, name: 'In progress', position: 'a1', isDone: false },
  { id: cid(3), boardId: BID, name: 'Done', position: 'a2', isDone: true },
];

const card = (n: number, columnId = cid(1), extra: Partial<Cd> = {}): Cd => ({
  id: kid(n),
  columnId,
  number: n,
  title: `Card ${n}`,
  position: `a${n}`,
  version: 1,
  assigneeId: null,
  priority: 'none',
  estimate: null,
  description: '',
  ...extra,
});

const summary = (c: Cd) => ({
  id: c.id,
  columnId: c.columnId,
  number: c.number,
  title: c.title,
  position: c.position,
  version: c.version,
  assigneeId: c.assigneeId,
  priority: c.priority,
  estimate: c.estimate,
});
const full = (c: Cd) => ({
  ...summary(c),
  boardId: BID,
  description: c.description,
  createdById: USER.id,
  createdAt: NOW,
  updatedAt: NOW,
});

const GRACE = '0192f000-0000-7000-8000-0000000000e2';
const VERA = '0192f000-0000-7000-8000-0000000000e3';
const members = [
  { userId: USER.id, name: 'Ada Lovelace', email: 'ada@example.com', role: 'owner', joinedAt: NOW },
  {
    userId: GRACE,
    name: 'Grace Hopper',
    email: 'grace@example.com',
    role: 'member',
    joinedAt: NOW,
  },
  { userId: VERA, name: 'Vera Viewer', email: 'vera@example.com', role: 'viewer', joinedAt: NOW },
];

function server(role: string, cards: Cd[]) {
  const handlers = {
    [`GET /api/workspaces/${WID}/members`]: () => jsonResponse(200, { members }),
    'GET /api/auth/me': () => jsonResponse(200, { user: USER }),
    'GET /api/workspaces': () => jsonResponse(200, { workspaces: [] }),
    [`GET /api/workspaces/${WID}`]: () =>
      jsonResponse(200, { workspace: { id: WID, name: 'Acme', createdAt: NOW, role } }),
    [`GET /api/projects/${PID}`]: () =>
      jsonResponse(200, {
        project: { id: PID, workspaceId: WID, name: 'Kanban Board', key: 'KB', createdAt: NOW },
      }),
    [`GET /api/projects/${PID}/board`]: () =>
      jsonResponse(200, {
        board: { id: BID, projectId: PID },
        columns,
        cards: cards.map(summary).sort(compareByPosition),
      }),
    ...Object.fromEntries(
      [1, 2, 3, 4].map((n) => [
        `GET /api/cards/${kid(n)}`,
        () => {
          const found = cards.find((c) => c.id === kid(n));
          return found
            ? jsonResponse(200, { card: full(found) })
            : jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Resource not found' } });
        },
      ]),
    ),
  };
  return handlers;
}

const renderAt = (path: string) => {
  const user = userEvent.setup();
  render(<App router={createTestRouter([path])} />);
  return user;
};

const board = (path = `/projects/${PID}`) => renderAt(path);
const polite = () => screen.getByTestId('live-polite');

describe('cards on the board', () => {
  it('shows tiles with KEY-number and title as links in order, per column', async () => {
    stubFetch(
      server('owner', [card(2, cid(1)), card(1, cid(1)), card(3, cid(2), { title: 'Elsewhere' })]),
    );
    board();
    const todo = await screen.findByRole('region', { name: 'Column To do' });
    const links = await within(todo).findAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['KB-1 Card 1', 'KB-2 Card 2']);
    expect(links[0]).toHaveAttribute('href', `/projects/${PID}/cards/1`);
    const doing = screen.getByRole('region', { name: 'Column In progress' });
    expect(within(doing).getByRole('link', { name: 'KB-3 Elsewhere' })).toBeVisible();
  });

  it('is read-only for a viewer: tiles, but no Add card', async () => {
    stubFetch(server('viewer', [card(1)]));
    board();
    expect(await screen.findByRole('link', { name: 'KB-1 Card 1' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Add card/ })).toBeNull();
  });

  it('adds cards with the keyboard only: Enter creates and keeps the field open', async () => {
    const cards: Cd[] = [];
    const mock = stubFetch({
      ...server('owner', cards),
      [`POST /api/columns/${cid(1)}/cards`]: (body) => {
        const { id, title } = body as { id: string; title: string };
        const created = card(cards.length + 1, cid(1), { id, title });
        cards.push(created);
        return jsonResponse(201, { card: full(created) });
      },
    });
    const user = board();
    const add = await screen.findByRole('button', { name: 'Add card to To do' });
    add.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByLabelText('Card title');
    expect(input).toHaveFocus();
    await user.keyboard('First{Enter}');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    await user.keyboard('Second{Enter}');
    const todo = screen.getByRole('region', { name: 'Column To do' });
    await waitFor(() =>
      expect(
        within(todo)
          .getAllByRole('link')
          .map((l) => l.textContent),
      ).toEqual(['KB-1 First', 'KB-2 Second']),
    );
    await waitFor(() => expect(polite()).toHaveTextContent('Card KB-2 created in To do'));
    const posts = mock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(2);
    const sent = JSON.parse(String(posts[0]?.[1]?.body)) as { id: string; title: string };
    expect(sent.title).toBe('First');
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(input).toHaveFocus();
  });

  it('validates the title and closes with Escape, returning focus to the button', async () => {
    stubFetch(server('owner', []));
    const user = board();
    await user.click(await screen.findByRole('button', { name: 'Add card to To do' }));
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Card title')).toHaveAccessibleDescription('Title is required');
    expect(screen.getByLabelText('Card title')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Card title')).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add card to To do' })).toHaveFocus(),
    );
  });

  it('rolls back a card the server refuses and announces the error', async () => {
    stubFetch({
      ...server('owner', []),
      [`POST /api/columns/${cid(1)}/cards`]: () =>
        jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'No way' } }),
    });
    const user = board();
    await user.click(await screen.findByRole('button', { name: 'Add card to To do' }));
    await user.keyboard('Doomed{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent(
        'Could not create the card: No way',
      ),
    );
    await waitFor(() => expect(screen.queryByText('Doomed')).toBeNull());
  });
});

describe('moving cards', () => {
  it('gives editors a move handle per card and viewers a disabled one', async () => {
    stubFetch(server('owner', [card(1)]));
    board();
    expect(await screen.findByRole('button', { name: 'Move card KB-1' })).toBeEnabled();
  });

  it('disables the handle for a viewer', async () => {
    stubFetch(server('viewer', [card(1)]));
    board();
    const handle = await screen.findByRole('button', {
      name: 'Move card KB-1 (not available to viewers)',
    });
    expect(handle).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Move card KB-1' })).toBeNull();
  });

  it('"Move to..." moves the card optimistically and announces it', async () => {
    const cards = [card(1), card(2)];
    let sent: unknown;
    stubFetch({
      ...server('owner', cards),
      [`POST /api/cards/${kid(1)}/move`]: (body) => {
        sent = body;
        const found = cards[0] as Cd;
        found.columnId = cid(3);
        found.version = 2;
        return jsonResponse(200, { card: full(found) });
      },
    });
    const user = board(`/projects/${PID}/cards/1`);
    const dialog = await screen.findByRole('dialog', { name: 'Card KB-1' });
    await user.selectOptions(within(dialog).getByLabelText('Column'), 'Done');
    await user.selectOptions(within(dialog).getByLabelText('Position'), 'Top');
    await user.click(within(dialog).getByRole('button', { name: 'Move card' }));
    const done = screen.getByRole('region', { name: 'Column Done' });
    expect(await within(done).findByRole('link', { name: 'KB-1 Card 1' })).toBeVisible();
    await waitFor(() =>
      expect(polite()).toHaveTextContent("Card KB-1 'Card 1' moved to Done, position 1 of 1"),
    );
    expect(sent).toEqual({
      columnId: cid(3),
      afterCardId: null,
      beforeCardId: null,
    });
  });

  it('rolls the move back and announces the error when the server refuses', async () => {
    stubFetch({
      ...server('owner', [card(1), card(2)]),
      [`POST /api/cards/${kid(2)}/move`]: () =>
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Resource not found' } }),
    });
    const user = board(`/projects/${PID}/cards/2`);
    const dialog = await screen.findByRole('dialog', { name: 'Card KB-2' });
    await user.selectOptions(within(dialog).getByLabelText('Column'), 'In progress');
    await user.click(within(dialog).getByRole('button', { name: 'Move card' }));
    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent(
        "Could not move Card KB-2 'Card 2': Resource not found",
      ),
    );
    const todo = screen.getByRole('region', { name: 'Column To do' });
    await waitFor(() =>
      expect(within(todo).getByRole('link', { name: 'KB-2 Card 2' })).toBeVisible(),
    );
  });
});

describe('card dialog', () => {
  it('opens from a tile with Enter and closes with Escape, returning focus to the tile', async () => {
    stubFetch(server('owner', [card(1, cid(1), { description: 'Some **bold** words' })]));
    const user = board();
    const tile = await screen.findByRole('link', { name: 'KB-1 Card 1' });
    tile.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Card KB-1' });
    expect(await within(dialog).findByRole('heading', { level: 3, name: 'Card 1' })).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: 'Description' })).toHaveValue(
      'Some **bold** words',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(within(dialog).getByText('bold').tagName).toBe('STRONG');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByRole('link', { name: 'KB-1 Card 1' })).toHaveFocus());
  });

  it('opens by deep link and focuses the tile after closing', async () => {
    stubFetch(server('owner', [card(2, cid(1))]));
    const user = board(`/projects/${PID}/cards/2`);
    const dialog = await screen.findByRole('dialog', { name: 'Card KB-2' });
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByRole('link', { name: 'KB-2 Card 2' })).toHaveFocus());
  });

  it('says so when the card does not exist', async () => {
    stubFetch(server('owner', [card(1)]));
    board(`/projects/${PID}/cards/99`);
    const dialog = await screen.findByRole('dialog', { name: 'Card KB-99' });
    expect(within(dialog).getByText(/does not exist or was deleted/)).toBeVisible();
  });

  it('shows an error state with Retry when the card fails to load', async () => {
    const cards = [card(1)];
    const handlers = server('owner', cards);
    let fail = true;
    stubFetch({
      ...handlers,
      [`GET /api/cards/${kid(1)}`]: () =>
        fail
          ? jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'Boom' } })
          : jsonResponse(200, { card: full(card(1)) }),
    });
    const user = board(`/projects/${PID}/cards/1`);
    expect(await screen.findByText('Boom')).toBeVisible();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Card 1' })).toBeVisible();
  });

  it('edits the title inline: Escape cancels, Enter saves optimistically', async () => {
    const cards = [card(1)];
    const mock = stubFetch({
      ...server('owner', cards),
      [`PATCH /api/cards/${kid(1)}`]: (body) => {
        const { title } = body as { title: string };
        const target = cards[0] as Cd;
        target.title = title;
        target.version += 1;
        return jsonResponse(200, { card: full(target) });
      },
    });
    const user = board(`/projects/${PID}/cards/1`);
    await user.click(await screen.findByRole('button', { name: 'Edit title' }));
    await user.keyboard('{Control>}a{/Control}Ignored{Escape}');
    // Escape cancels the edit but does not close the dialog.
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('heading', { level: 3, name: 'Card 1' })).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    expect(screen.getByRole('button', { name: 'Edit title' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Edit title' }));
    await user.keyboard('{Control>}a{/Control}Renamed{Enter}');
    expect(await screen.findByRole('heading', { level: 3, name: 'Renamed' })).toBeVisible();
    await waitFor(() => expect(polite()).toHaveTextContent('Card title saved'));
    const patch = mock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ title: 'Renamed' });
    // The tile behind the dialog shows the new title too.
    expect(screen.getByRole('link', { name: 'KB-1 Renamed' })).toBeInTheDocument();
  });

  it('rolls the title back and announces when the save fails', async () => {
    stubFetch({
      ...server('owner', [card(1)]),
      [`PATCH /api/cards/${kid(1)}`]: () =>
        jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Nope' } }),
    });
    const user = board(`/projects/${PID}/cards/1`);
    await user.click(await screen.findByRole('button', { name: 'Edit title' }));
    await user.keyboard('{Control>}a{/Control}Broken{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent(
        'Could not save the title: Nope',
      ),
    );
    expect(await screen.findByRole('heading', { level: 3, name: 'Card 1' })).toBeVisible();
  });

  it('validates the title before saving', async () => {
    stubFetch(server('owner', [card(1)]));
    const user = board(`/projects/${PID}/cards/1`);
    await user.click(await screen.findByRole('button', { name: 'Edit title' }));
    await user.keyboard('{Control>}a{/Control}{Backspace}{Enter}');
    expect(screen.getByLabelText('Card title')).toHaveAccessibleDescription('Title is required');
    expect(screen.getByLabelText('Card title')).toHaveFocus();
  });

  it('edits the description live: no Save button, Syncing/Saved status, Edit/Preview', async () => {
    const mock = stubFetch(server('owner', [card(1)]));
    const user = board(`/projects/${PID}/cards/1`);
    const area = await screen.findByRole('textbox', { name: 'Description' });
    // Before the first sync the REST text is shown, read-only.
    expect(area).toHaveAttribute('aria-readonly', 'true');
    expect(screen.getByTestId('description-status')).toHaveTextContent('Connecting…');
    let room!: FakeRoom;
    act(() => {
      room = serveDescription('');
    });
    await waitFor(() =>
      expect(screen.getByTestId('description-status')).toHaveTextContent('Saved'),
    );
    expect(area).not.toHaveAttribute('aria-readonly');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    await user.type(area, '# Plan{Enter}Do <script>x</script> it');
    expect(room.text).toBe('# Plan\nDo <script>x</script> it');
    await waitFor(() =>
      expect(screen.getByTestId('description-status')).toHaveTextContent('Saved'),
    );

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const preview = screen.getByRole('group', { name: 'Description preview' });
    expect(within(preview).getByRole('heading', { name: 'Plan' })).toBeVisible();
    expect(preview.querySelector('script')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
      '# Plan\nDo <script>x</script> it',
    );
    // One write path: nothing went through PATCH, and typing announced nothing.
    expect(mock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    expect(screen.getByTestId('live-polite')).toBeEmptyDOMElement();
    expect(screen.getByTestId('live-assertive')).toBeEmptyDOMElement();
  });

  it('shows "Syncing…" until the server confirms a change', async () => {
    stubFetch(server('owner', [card(1)]));
    const user = board(`/projects/${PID}/cards/1`);
    const area = await screen.findByRole('textbox', { name: 'Description' });
    const socket = descriptionSocket() as FakeWebSocket;
    let room!: FakeRoom;
    act(() => {
      room = serveDescription('');
    });
    await waitFor(() =>
      expect(screen.getByTestId('description-status')).toHaveTextContent('Saved'),
    );
    // A server that does not answer yet: the status stays on "Syncing…".
    const answer = socket.onSend;
    socket.onSend = null;
    const mark = socket.sent.length;
    await user.type(area, 'a');
    expect(screen.getByTestId('description-status')).toHaveTextContent('Syncing…');
    socket.onSend = answer;
    // The pending messages arrive now, in order.
    for (const message of socket.sent.slice(mark)) act(() => answer?.(message));
    await waitFor(() =>
      expect(screen.getByTestId('description-status')).toHaveTextContent('Saved'),
    );
    expect(room.text).toBe('a');
  });

  it("applies another person's edit without moving the caret", async () => {
    stubFetch(server('owner', [card(1, cid(1), { description: 'Hello world' })]));
    const user = board(`/projects/${PID}/cards/1`);
    const area = await screen.findByRole('textbox', { name: 'Description' });
    let room!: FakeRoom;
    act(() => {
      room = serveDescription('Hello world');
    });
    await waitFor(() =>
      expect(screen.getByTestId('description-status')).toHaveTextContent('Saved'),
    );
    expect(area).toHaveValue('Hello world');
    await user.click(area);
    (area as HTMLTextAreaElement).setSelectionRange(11, 11);
    act(() => {
      room.doc.getText('description').insert(0, '>> ');
    });
    expect(area).toHaveValue('>> Hello world');
    expect((area as HTMLTextAreaElement).selectionStart).toBe(14);
    await user.type(area, '!');
    expect(room.text).toBe('>> Hello world!');
  });

  it('keeps the editor read-only for a viewer, and still shows live changes', async () => {
    stubFetch(server('viewer', [card(1, cid(1), { description: 'Text' })]));
    board(`/projects/${PID}/cards/1`);
    const area = await screen.findByRole('textbox', { name: 'Description' });
    let room!: FakeRoom;
    act(() => {
      room = serveDescription('Text');
    });
    await waitFor(() =>
      expect(screen.getByTestId('description-status')).toHaveTextContent('Saved'),
    );
    expect(area).toHaveAttribute('aria-readonly', 'true');
    expect(area).toHaveAttribute('readonly');
    act(() => {
      room.doc.getText('description').insert(4, ' and more');
    });
    expect(area).toHaveValue('Text and more');
  });

  it('limits the description to 20,000 characters', async () => {
    stubFetch(server('owner', [card(1)]));
    board(`/projects/${PID}/cards/1`);
    const area = await screen.findByRole('textbox', { name: 'Description' });
    expect(area).toHaveAttribute('maxlength', '20000');
  });

  it('does not trap Tab in the description editor', async () => {
    stubFetch(server('owner', [card(1)]));
    const user = board(`/projects/${PID}/cards/1`);
    const area = await screen.findByRole('textbox', { name: 'Description' });
    act(() => {
      serveDescription('');
    });
    await waitFor(() =>
      expect(screen.getByTestId('description-status')).toHaveTextContent('Saved'),
    );
    await user.click(area);
    await user.keyboard('{Tab}');
    expect(area).not.toHaveFocus();
    expect(area).toHaveValue('');
  });

  it('announces a refused connection assertively', async () => {
    stubFetch(server('owner', [card(1)]));
    board(`/projects/${PID}/cards/1`);
    await screen.findByRole('textbox', { name: 'Description' });
    const socket = descriptionSocket() as FakeWebSocket;
    act(() => socket.close(4403));
    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent(
        'Could not sync the description',
      ),
    );
    expect(screen.getByTestId('description-status')).toHaveTextContent('Description unavailable');
  });

  it('asks for confirmation before deleting, then removes the card and announces it', async () => {
    const cards = [card(1), card(2)];
    const mock = stubFetch({
      ...server('owner', cards),
      [`DELETE /api/cards/${kid(1)}`]: () => {
        cards.splice(0, 1);
        return new Response(null, { status: 204 });
      },
    });
    const user = board(`/projects/${PID}/cards/1`);
    await user.click(await screen.findByRole('button', { name: 'Delete card' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete card KB-1?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog', { name: 'Card KB-1' })).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete card' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Delete card KB-1?' })).getByRole('button', {
        name: 'Delete card',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.queryByRole('link', { name: 'KB-1 Card 1' })).toBeNull());
    expect(screen.getByRole('link', { name: 'KB-2 Card 2' })).toBeVisible();
    await waitFor(() => expect(polite()).toHaveTextContent('Card KB-1 deleted'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add card to To do' })).toHaveFocus(),
    );
  });

  it('shows assignee initials, priority with text and the estimate on the tile', async () => {
    stubFetch(
      server('owner', [
        card(1, cid(1), { assigneeId: GRACE, priority: 'urgent', estimate: 5 }),
        card(2, cid(1)),
      ]),
    );
    board();
    const first = await screen.findByRole('link', { name: /KB-1 Card 1/ });
    expect(await within(first).findByText('GH')).toBeVisible();
    expect(within(first).getByRole('img', { name: 'Assignee: Grace Hopper' })).toBeVisible();
    expect(within(first).getByText('Urgent')).toBeVisible();
    expect(within(first).getByRole('img', { name: 'Estimate: 5 points' })).toHaveTextContent(
      '5 pts',
    );
    // A card without any of the three fields shows no extras.
    expect(screen.getByRole('link', { name: 'KB-2 Card 2' })).toBeVisible();
  });

  it('sets assignee, priority and estimate from the dialog, offering no viewers', async () => {
    const cards = [card(1)];
    const mock = stubFetch({
      ...server('owner', cards),
      [`PATCH /api/cards/${kid(1)}`]: (body) => {
        const target = cards[0] as Cd;
        Object.assign(target, body);
        target.version += 1;
        return jsonResponse(200, { card: full(target) });
      },
    });
    const user = board(`/projects/${PID}/cards/1`);
    const assignee = await screen.findByRole('combobox', { name: 'Assignee' });
    await waitFor(() =>
      expect(within(assignee).getByRole('option', { name: 'Grace Hopper' })).toBeVisible(),
    );
    expect(within(assignee).queryByRole('option', { name: 'Vera Viewer' })).toBeNull();
    await user.selectOptions(assignee, 'Grace Hopper');
    await waitFor(() => expect(polite()).toHaveTextContent('Card assigned to Grace Hopper'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'High');
    await waitFor(() => expect(polite()).toHaveTextContent('Priority set to High'));
    const estimate = screen.getByRole('spinbutton', { name: /Estimate/ });
    await user.type(estimate, '8{Enter}');
    await waitFor(() => expect(polite()).toHaveTextContent('Estimate set to 8 points'));

    const bodies = mock.mock.calls
      .filter(([, init]) => init?.method === 'PATCH')
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toEqual([{ assigneeId: GRACE }, { priority: 'high' }, { estimate: 8 }]);
    // The tile behind the dialog follows.
    expect(screen.getByRole('img', { name: 'Assignee: Grace Hopper' })).toBeVisible();
    const tile = screen.getByRole('link', { name: /KB-1 Card 1/ });
    expect(within(tile).getByText('High')).toBeVisible();
  });

  it('validates the estimate and links the error to the field', async () => {
    const mock = stubFetch(server('owner', [card(1)]));
    const user = board(`/projects/${PID}/cards/1`);
    const estimate = await screen.findByRole('spinbutton', { name: /Estimate/ });
    await user.type(estimate, '101{Enter}');
    expect(await screen.findByText('Estimate must be at most 100')).toBeVisible();
    expect(estimate).toHaveAttribute('aria-invalid', 'true');
    expect(estimate.getAttribute('aria-describedby')).toContain('-error');
    await user.clear(estimate);
    await user.type(estimate, '1.5{Enter}');
    expect(await screen.findByText('Estimate must be a whole number')).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('rolls the priority back and announces when the save fails', async () => {
    stubFetch({
      ...server('owner', [card(1)]),
      [`PATCH /api/cards/${kid(1)}`]: () =>
        jsonResponse(400, { error: { code: 'INVALID_ASSIGNEE', message: 'Not assignable' } }),
    });
    const user = board(`/projects/${PID}/cards/1`);
    const priority = await screen.findByRole('combobox', { name: 'Priority' });
    await user.selectOptions(priority, 'Urgent');
    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent(
        'Could not change the priority: Not assignable',
      ),
    );
    await waitFor(() => expect(priority).toHaveValue('none'));
  });

  it('shows the three fields as text for a viewer', async () => {
    stubFetch(
      server('viewer', [card(1, cid(1), { assigneeId: GRACE, priority: 'low', estimate: 3 })]),
    );
    board(`/projects/${PID}/cards/1`);
    const dialog = await screen.findByRole('dialog', { name: 'Card KB-1' });
    expect(await within(dialog).findByText('Grace Hopper')).toBeVisible();
    expect(within(dialog).getByText('3 points')).toBeVisible();
    expect(within(dialog).queryByRole('combobox', { name: 'Assignee' })).toBeNull();
    expect(within(dialog).queryByRole('spinbutton')).toBeNull();
  });

  it('is read-only for a viewer', async () => {
    stubFetch(server('viewer', [card(1, cid(1), { description: 'Text' })]));
    board(`/projects/${PID}/cards/1`);
    const dialog = await screen.findByRole('dialog', { name: 'Card KB-1' });
    expect(await within(dialog).findByRole('textbox', { name: 'Description' })).toHaveValue('Text');
    expect(within(dialog).queryByRole('button', { name: 'Edit title' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Delete card' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeVisible();
  });
});
