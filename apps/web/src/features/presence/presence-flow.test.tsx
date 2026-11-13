import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { compareByPosition } from '@kanban/shared';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { caretToJSON } from '../../lib/realtime/caret';
import { serveDescription, descriptionSocket } from '../../test-utils/collab';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';
import { awarenessFrame, remoteState, sentAwareness } from '../../test-utils/presence';
import { FakeWebSocket } from '../../test-utils/websocket';

const WID = '0192f000-0000-7000-8000-000000000001';
const PID = '0192f000-0000-7000-8000-0000000000a1';
const BID = '0192f000-0000-7000-8000-0000000000b1';
const COLUMN = '0192f000-0000-7000-8000-0000000000c1';
const CARD1 = '0192f000-0000-7000-8000-0000000000d1';
const NOW = '2026-11-13T10:00:00.000Z';

const card = {
  id: CARD1,
  columnId: COLUMN,
  number: 1,
  title: 'First card',
  position: 'a1',
  version: 1,
  assigneeId: null,
  priority: 'none',
  estimate: null,
};

function server() {
  return {
    'GET /api/auth/me': () => jsonResponse(200, { user: USER }),
    'GET /api/workspaces': () => jsonResponse(200, { workspaces: [] }),
    [`GET /api/workspaces/${WID}/members`]: () => jsonResponse(200, { members: [] }),
    [`GET /api/workspaces/${WID}`]: () =>
      jsonResponse(200, { workspace: { id: WID, name: 'Acme', createdAt: NOW, role: 'owner' } }),
    [`GET /api/projects/${PID}`]: () =>
      jsonResponse(200, {
        project: { id: PID, workspaceId: WID, name: 'Kanban Board', key: 'KB', createdAt: NOW },
      }),
    [`GET /api/projects/${PID}/board`]: () =>
      jsonResponse(200, {
        board: { id: BID, projectId: PID },
        columns: [{ id: COLUMN, boardId: BID, name: 'To do', position: 'a0', isDone: false }],
        cards: [card].sort(compareByPosition),
      }),
    [`GET /api/cards/${CARD1}`]: () =>
      jsonResponse(200, {
        card: {
          ...card,
          boardId: BID,
          description: 'Initial text',
          createdById: USER.id,
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
  };
}

async function openBoard(path = `/projects/${PID}`): Promise<FakeWebSocket> {
  stubFetch(server());
  render(<App router={createTestRouter([path])} />);
  await screen.findByRole('region', { name: 'Column To do' });
  await waitFor(() => expect(FakeWebSocket.boards).toHaveLength(1));
  const socket = FakeWebSocket.boards[0] as FakeWebSocket;
  act(() => socket.open());
  return socket;
}

const tell = (socket: FakeWebSocket, entries: Parameters<typeof awarenessFrame>[0]) =>
  act(() => socket.receiveRaw(awarenessFrame(entries)));

describe('board presence', () => {
  it('shares the current user over the board socket, with its own identity', async () => {
    const socket = await openBoard();
    const mine = [...sentAwareness(socket.sent).values()].at(-1) as Record<string, unknown>;
    expect(mine).toMatchObject({
      userId: USER.id,
      name: 'Ada',
      activeCardId: null,
      editing: false,
    });
    // One socket per room: the board room has exactly one.
    expect(FakeWebSocket.instances.filter((s) => s.url.includes('/ws/board:'))).toHaveLength(1);
  });

  it('lists people as avatars with an accessible list, deduplicated by user', async () => {
    const socket = await openBoard();
    tell(socket, [
      { clientId: 101, state: remoteState('u-ana', 'Ana Silva') },
      { clientId: 102, state: remoteState('u-ana', 'Ana Silva') }, // same person, second tab
      { clientId: 103, state: remoteState('u-bo', 'Bo Lima') },
    ]);
    const list = await screen.findByRole('list', {
      name: '3 people on this board: Ada (you), Ana Silva, Bo Lima',
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(list.textContent).toContain('AS');
  });

  it('shows five avatars and "+N" for the rest, with every name in the accessible name', async () => {
    const socket = await openBoard();
    tell(
      socket,
      [1, 2, 3, 4, 5, 6].map((n) => ({
        clientId: 200 + n,
        state: remoteState(`u-${n}`, `Person ${n}`),
      })),
    );
    const list = await screen.findByRole('list', { name: /^7 people on this board: / });
    expect(within(list).getAllByRole('listitem')).toHaveLength(6); // 5 avatars + "+2"
    expect(list.textContent).toContain('+2');
    expect(list.getAttribute('aria-label')).toContain('Person 6');
  });

  it('shows "Ana is editing" on the tile, not colour-only, and removes it when she leaves', async () => {
    const socket = await openBoard();
    tell(socket, [
      { clientId: 101, state: remoteState('u-ana', 'Ana', { activeCardId: CARD1, editing: true }) },
    ]);
    expect(await screen.findByText('Ana is editing')).toBeVisible();

    tell(socket, [{ clientId: 101, state: null, clock: 2 }]);
    await waitFor(() => expect(screen.queryByText('Ana is editing')).toBeNull());
  });

  it('does not show someone who only has the card open as editing', async () => {
    const socket = await openBoard();
    tell(socket, [{ clientId: 101, state: remoteState('u-ana', 'Ana', { activeCardId: CARD1 }) }]);
    await screen.findByRole('list', { name: /2 people on this board/ });
    expect(screen.queryByText(/is editing/)).toBeNull();
  });

  it('forgets the other people when the connection drops, keeping the user', async () => {
    const socket = await openBoard();
    tell(socket, [{ clientId: 101, state: remoteState('u-ana', 'Ana') }]);
    await screen.findByRole('list', { name: /2 people on this board/ });
    act(() => socket.close(1006));
    await screen.findByRole('list', { name: '1 person on this board: Ada (you)' });
  });

  it('announces nothing when people join or leave', async () => {
    const socket = await openBoard();
    tell(socket, [{ clientId: 101, state: remoteState('u-ana', 'Ana') }]);
    await screen.findByRole('list', { name: /2 people/ });
    tell(socket, [{ clientId: 101, state: null, clock: 2 }]);
    await screen.findByRole('list', { name: /1 person/ });
    expect(screen.getByTestId('live-polite')).toHaveTextContent('');
    expect(screen.getByTestId('live-assertive')).toHaveTextContent('');
  });
});

describe('card presence and remote carets', () => {
  it('tells the board which card is open and who else has it open', async () => {
    const user = userEvent.setup();
    const socket = await openBoard();
    tell(socket, [
      { clientId: 101, state: remoteState('u-ana', 'Ana', { activeCardId: CARD1, editing: true }) },
    ]);
    await user.click(await screen.findByRole('link', { name: /KB-1 First card/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Card KB-1' });
    expect(await within(dialog).findByText(/Also here:/)).toHaveTextContent(
      'Also here: Ana (editing)',
    );

    const mine = [...sentAwareness(socket.sent).values()].at(-1) as Record<string, unknown>;
    expect(mine['activeCardId']).toBe(CARD1);

    // Closing the dialog clears it again.
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      const last = [...sentAwareness(socket.sent).values()].at(-1) as Record<string, unknown>;
      expect(last['activeCardId']).toBeNull();
    });
  });

  it('marks this user as editing while the description has focus', async () => {
    const user = userEvent.setup();
    const socket = await openBoard(`/projects/${PID}/cards/1`);
    const room = await (async () => {
      await waitFor(() => expect(descriptionSocket()).toBeDefined());
      return serveDescription('Initial text');
    })();
    expect(room.text).toBe('Initial text');
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await waitFor(() => expect(editor).not.toHaveAttribute('aria-readonly'));
    await user.click(editor);
    await waitFor(() => {
      const last = [...sentAwareness(socket.sent).values()].at(-1) as Record<string, unknown>;
      expect(last).toMatchObject({ activeCardId: CARD1, editing: true });
    });
    // The card room carries the caret as a relative position.
    const cardSocket = descriptionSocket() as FakeWebSocket;
    await waitFor(() => {
      const state = [...sentAwareness(cardSocket.sent).values()].at(-1) as Record<string, unknown>;
      expect(state['editing']).toBe(true);
      expect(state['caret']).not.toBeNull();
    });
    await user.tab({ shift: true });
    await waitFor(() => {
      const last = [...sentAwareness(socket.sent).values()].at(-1) as Record<string, unknown>;
      expect(last['editing']).toBe(false);
    });
  });

  it('draws another person caret with their name, hidden from assistive technology', async () => {
    await openBoard(`/projects/${PID}/cards/1`);
    await waitFor(() => expect(descriptionSocket()).toBeDefined());
    const room = serveDescription('Initial text');
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await waitFor(() => expect(editor).not.toHaveAttribute('aria-readonly'));
    await act(async () => {
      await Promise.resolve();
    });
    const cardSocket = descriptionSocket() as FakeWebSocket;

    const caret = caretToJSON(room.doc.getText('description'), 8);
    act(() =>
      cardSocket.receiveRaw(
        awarenessFrame([
          {
            clientId: 301,
            state: remoteState('u-ana', 'Ana', { activeCardId: CARD1, editing: true, caret }),
          },
        ]),
      ),
    );
    const drawn = await screen.findByTestId('remote-caret');
    expect(drawn).toHaveTextContent('Ana');
    expect(screen.getByTestId('remote-carets')).toHaveAttribute('aria-hidden', 'true');
    // The overlay (and so the label) is hidden from the accessibility tree.
    expect(drawn.closest('[aria-hidden="true"]')).not.toBeNull();

    // She leaves: the caret goes away.
    act(() => cardSocket.receiveRaw(awarenessFrame([{ clientId: 301, state: null, clock: 2 }])));
    await waitFor(() => expect(screen.queryByTestId('remote-caret')).toBeNull());
  });
});
