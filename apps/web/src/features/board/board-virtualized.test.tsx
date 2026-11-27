import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { compareByPosition, type BoardEvent } from '@kanban/shared';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';
import { FakeWebSocket } from '../../test-utils/websocket';
import { setTileRenderProbe } from './CardList';

const WID = '0192f000-0000-7000-8000-000000000001';
const PID = '0192f000-0000-7000-8000-0000000000a1';
const BID = '0192f000-0000-7000-8000-0000000000b1';
const COLUMN = '0192f000-0000-7000-8000-0000000000c1';
const NOW = '2026-11-10T10:00:00.000Z';
const COUNT = 300;

const kid = (n: number) => `0192f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const card = (n: number, extra: Record<string, unknown> = {}) => ({
  id: kid(n),
  columnId: COLUMN,
  number: n,
  title: `Card ${n}`,
  position: `a${String(n).padStart(4, '0')}`,
  version: 1,
  assigneeId: null,
  priority: 'none',
  estimate: null,
  sprintId: null,
  labelIds: [],
  ...extra,
});

function server(cards: ReturnType<typeof card>[]) {
  return {
    'GET /api/auth/me': () => jsonResponse(200, { user: USER }),
    'GET /api/workspaces': () => jsonResponse(200, { workspaces: [] }),
    [`GET /api/workspaces/${WID}/members`]: () => jsonResponse(200, { members: [] }),
    [`GET /api/workspaces/${WID}`]: () =>
      jsonResponse(200, { workspace: { id: WID, name: 'Acme', createdAt: NOW, role: 'owner' } }),
    [`GET /api/projects/${PID}`]: () =>
      jsonResponse(200, {
        project: { id: PID, workspaceId: WID, name: 'Big', key: 'KB', createdAt: NOW },
      }),
    [`GET /api/projects/${PID}/board`]: () =>
      jsonResponse(200, {
        board: { id: BID, projectId: PID },
        columns: [{ id: COLUMN, boardId: BID, name: 'To do', position: 'a0', isDone: true }],
        cards: [...cards].sort(compareByPosition),
        sprints: [],
        labels: [],
      }),
  };
}

const allCards = Array.from({ length: COUNT }, (_, i) => card(i + 1));

async function openBoard() {
  stubFetch(server(allCards));
  const user = userEvent.setup();
  render(<App router={createTestRouter([`/projects/${PID}`])} />);
  const column = await screen.findByRole('region', { name: 'Column To do' });
  return { user, column };
}

beforeAll(() => {
  // jsdom has no layout; scrolling an element just sets its offset and fires `scroll`.
  Element.prototype.scrollTo = function scrollTo(this: Element, options?: unknown) {
    const top = typeof options === 'object' && options ? (options as { top?: number }).top : 0;
    Object.defineProperty(this, 'scrollTop', { value: top ?? 0, configurable: true });
    this.dispatchEvent(new Event('scroll'));
  };
  // The scrollable extent is the height the virtual list sets on its `ul`.
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('card-scroll')
        ? Number.parseFloat(this.querySelector('ul')?.style.height ?? '0')
        : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('card-scroll') ? 640 : 0;
    },
  });
});

afterEach(() => setTileRenderProbe(undefined));

describe('virtualized column', () => {
  it('renders a bounded number of tiles and reports the full count to assistive technology', async () => {
    const { column } = await openBoard();
    const tiles = await within(column).findAllByRole('link');
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(50);
    const rows = within(column).getAllByRole('listitem');
    expect(rows[0]).toHaveAttribute('aria-setsize', String(COUNT));
    expect(rows[0]).toHaveAttribute('aria-posinset', '1');
  });

  it('re-renders only the affected tile when one board event is applied', async () => {
    const { column } = await openBoard();
    await within(column).findByRole('link', { name: 'KB-5 Card 5' });
    await waitFor(() => expect(FakeWebSocket.boards).toHaveLength(1));
    const socket = FakeWebSocket.boards[0] as FakeWebSocket;
    act(() => socket.open());
    // Let the refetch that follows connecting settle before counting.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const renders = new Map<string, number>();
    setTileRenderProbe((id) => renders.set(id, (renders.get(id) ?? 0) + 1));
    const event = {
      type: 'card_updated',
      boardId: BID,
      actorId: USER.id,
      at: NOW,
      entity: card(5, { title: 'Renamed', version: 2 }),
      version: 2,
    } as BoardEvent;
    act(() => socket.receive(event));

    expect(await within(column).findByRole('link', { name: 'KB-5 Renamed' })).toBeVisible();
    expect(renders.get(kid(5))).toBeGreaterThan(0);
    const others = [...renders.keys()].filter((id) => id !== kid(5));
    expect(others).toEqual([]);
  });

  it('reaches the last card with the keyboard (End), and back (Home)', async () => {
    const { user, column } = await openBoard();
    const first = await within(column).findByRole('link', { name: 'KB-1 Card 1' });
    first.focus();

    await user.keyboard('{End}');
    await waitFor(() =>
      expect(within(column).getByRole('link', { name: `KB-${COUNT} Card ${COUNT}` })).toHaveFocus(),
    );
    expect(within(column).getAllByRole('link').length).toBeLessThanOrEqual(50);

    await user.keyboard('{ArrowUp}');
    await waitFor(() =>
      expect(
        within(column).getByRole('link', { name: `KB-${COUNT - 1} Card ${COUNT - 1}` }),
      ).toHaveFocus(),
    );

    await user.keyboard('{Home}');
    await waitFor(() =>
      expect(within(column).getByRole('link', { name: 'KB-1 Card 1' })).toHaveFocus(),
    );
  });
});
