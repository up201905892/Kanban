import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { compareByPosition } from '@kanban/shared';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';

const WID = '0192f000-0000-7000-8000-000000000001';
const PID = '0192f000-0000-7000-8000-0000000000a1';
const BID = '0192f000-0000-7000-8000-0000000000b1';
const cid = (n: number) => `0192f000-0000-7000-8000-0000000000c${n}`;

interface Col {
  id: string;
  boardId: string;
  name: string;
  position: string;
  isDone: boolean;
}

const initialColumns = (): Col[] => [
  { id: cid(1), boardId: BID, name: 'To do', position: 'a0', isDone: false },
  { id: cid(2), boardId: BID, name: 'In progress', position: 'a1', isDone: false },
  { id: cid(3), boardId: BID, name: 'Done', position: 'a2', isDone: true },
];

function server(role: string, columns: Col[] = initialColumns()) {
  const handlers = {
    'GET /api/auth/me': () => jsonResponse(200, { user: USER }),
    'GET /api/workspaces': () => jsonResponse(200, { workspaces: [] }),
    [`GET /api/workspaces/${WID}`]: () =>
      jsonResponse(200, {
        workspace: { id: WID, name: 'Acme', createdAt: '2026-10-30T10:00:00.000Z', role },
      }),
    [`GET /api/projects/${PID}`]: () =>
      jsonResponse(200, {
        project: {
          id: PID,
          workspaceId: WID,
          name: 'Kanban Board',
          key: 'KB',
          createdAt: '2026-10-30T10:00:00.000Z',
        },
      }),
    [`GET /api/projects/${PID}/board`]: () =>
      jsonResponse(200, {
        board: { id: BID, projectId: PID },
        columns: [...columns].sort(compareByPosition),
      }),
  };
  return { handlers, columns };
}

const renderBoard = () => {
  const user = userEvent.setup();
  render(<App router={createTestRouter([`/projects/${PID}`])} />);
  return user;
};

const columnNames = () =>
  screen
    .getAllByRole('heading', { level: 2 })
    .map((h) => h.textContent?.replace(/ \(Done column\)/, ''));

describe('board page', () => {
  it('shows a loading state and then the columns in order', async () => {
    stubFetch(server('owner').handlers);
    renderBoard();
    expect(await screen.findByRole('heading', { level: 1, name: 'Kanban Board' })).toBeVisible();
    await screen.findByRole('button', { name: 'To do' });
    expect(columnNames()).toEqual(['To do', 'In progress', 'Done']);
    expect(screen.getByText('(Done column)')).toBeVisible();
  });

  it('shows an error state with Retry when the board fails to load', async () => {
    const { handlers } = server('owner');
    let fail = true;
    stubFetch({
      ...handlers,
      [`GET /api/projects/${PID}/board`]: () =>
        fail
          ? jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'Boom' } })
          : handlers[`GET /api/projects/${PID}/board`](),
    });
    const user = renderBoard();
    expect(await screen.findByText('Boom')).toBeVisible();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'To do' })).toBeVisible();
  });

  it('is read-only for a viewer', async () => {
    stubFetch(server('viewer').handlers);
    renderBoard();
    await screen.findByRole('heading', { level: 2, name: /To do/ });
    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Actions for column/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'To do' })).toBeNull();
  });

  it('adds a column optimistically with a client-generated id', async () => {
    const { handlers, columns } = server('owner');
    const mock = stubFetch({
      ...handlers,
      [`POST /api/boards/${BID}/columns`]: (body) => {
        const { id, name } = body as { id: string; name: string };
        const column = { id, boardId: BID, name, position: 'a3', isDone: false };
        columns.push(column);
        return jsonResponse(201, { column });
      },
    });
    const user = renderBoard();
    await user.click(await screen.findByRole('button', { name: 'Add column' }));
    await user.type(screen.getByLabelText('Column name'), 'Review{Enter}');
    expect(await screen.findByRole('button', { name: 'Review' })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent('Column Review added'),
    );
    const post = mock.mock.calls.find(([, init]) => init?.method === 'POST');
    const sent = JSON.parse(String(post?.[1]?.body)) as { id: string; name: string };
    expect(sent.name).toBe('Review');
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add column' })).toHaveFocus());
  });

  it('validates the new column name and cancels with Escape', async () => {
    stubFetch(server('owner').handlers);
    const user = renderBoard();
    await user.click(await screen.findByRole('button', { name: 'Add column' }));
    await user.keyboard('{Enter}');
    const input = screen.getByLabelText('Column name');
    expect(input).toHaveAccessibleDescription('Name is required');
    expect(input).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Column name')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add column' })).toHaveFocus());
  });

  it('renames inline: Enter saves, Escape cancels', async () => {
    const { handlers, columns } = server('owner');
    const mock = stubFetch({
      ...handlers,
      [`PATCH /api/columns/${cid(1)}`]: (body) => {
        const { name } = body as { name: string };
        const column = columns[0] as Col;
        column.name = name;
        return jsonResponse(200, { column });
      },
    });
    const user = renderBoard();
    await user.click(await screen.findByRole('button', { name: 'To do' }));
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'To do' })).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'To do' }));
    const input = screen.getByRole('textbox', { name: 'Name of column To do' });
    await user.clear(input);
    await user.type(input, 'Backlog{Enter}');
    expect(await screen.findByRole('button', { name: 'Backlog' })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent('Column renamed to Backlog'),
    );
    const patch = mock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ name: 'Backlog' });
  });

  it('rolls back a rename the server refuses and announces the error', async () => {
    const { handlers } = server('owner');
    stubFetch({
      ...handlers,
      [`PATCH /api/columns/${cid(1)}`]: () =>
        jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'No way' } }),
    });
    const user = renderBoard();
    await user.click(await screen.findByRole('button', { name: 'To do' }));
    await user.keyboard('X{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent(
        'Could not rename the column: No way',
      ),
    );
    expect(await screen.findByRole('button', { name: 'To do' })).toBeVisible();
  });

  it('opens the menu with Enter, moves a column right and announces it', async () => {
    const { handlers, columns } = server('owner');
    const mock = stubFetch({
      ...handlers,
      [`PATCH /api/columns/${cid(1)}`]: () => {
        (columns[0] as Col).position = 'a15';
        return jsonResponse(200, { column: columns[0] });
      },
    });
    const user = renderBoard();
    const trigger = await screen.findByRole('button', { name: 'Actions for column To do' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = screen.getByRole('menu', { name: 'Actions for column To do' });
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: /Move left/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(columnNames()).toEqual(['In progress', 'To do', 'Done']));
    const patch = mock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      afterColumnId: cid(2),
      beforeColumnId: cid(3),
    });
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent(
        'Column To do moved to position 2 of 3',
      ),
    );
    expect(screen.getByRole('button', { name: 'Actions for column To do' })).toHaveFocus();
  });

  it('closes the menu with Escape and returns focus to the trigger', async () => {
    stubFetch(server('owner').handlers);
    const user = renderBoard();
    const trigger = await screen.findByRole('button', { name: 'Actions for column To do' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('disables moves at the edges and deleting the Done column, with reasons', async () => {
    stubFetch(server('owner').handlers);
    const user = renderBoard();
    await user.click(await screen.findByRole('button', { name: 'Actions for column To do' }));
    expect(screen.getByRole('menuitem', { name: /Move left/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Actions for column Done' }));
    expect(screen.getByRole('menuitem', { name: /Move right/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('menuitem', { name: /Mark as Done column/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('marks another column as Done', async () => {
    const { handlers, columns } = server('owner');
    stubFetch({
      ...handlers,
      [`PATCH /api/columns/${cid(2)}`]: () => {
        columns.forEach((c) => {
          c.isDone = c.id === cid(2);
        });
        return jsonResponse(200, { column: columns[1] });
      },
    });
    const user = renderBoard();
    await user.click(await screen.findByRole('button', { name: 'Actions for column In progress' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark as Done column' }));
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent(
        'Column In progress is now the Done column',
      ),
    );
    expect(screen.getAllByText('(Done column)')).toHaveLength(1);
    expect(
      within(screen.getByRole('region', { name: 'Column In progress' })).getByText('(Done column)'),
    ).toBeVisible();
  });

  it('asks for confirmation before deleting and deletes', async () => {
    const { handlers, columns } = server('owner');
    const mock = stubFetch({
      ...handlers,
      [`DELETE /api/columns/${cid(2)}`]: () => {
        columns.splice(1, 1);
        return new Response(null, { status: 204 });
      },
    });
    const user = renderBoard();
    await user.click(await screen.findByRole('button', { name: 'Actions for column In progress' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete column In progress?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Actions for column In progress' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete column' }),
    );
    await waitFor(() => expect(columnNames()).toEqual(['To do', 'Done']));
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent('Column In progress deleted'),
    );
  });
});
