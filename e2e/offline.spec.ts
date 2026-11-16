import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, signUpViaApi, test } from './fixtures.js';

const ORIGIN = 'http://localhost:5173';

const post = (page: Page, url: string, data: object) =>
  page.request.post(url, { data, headers: { origin: ORIGIN } });

interface BoardJson {
  columns: { id: string; name: string }[];
  cards: { id: string; columnId: string; number: number; title: string }[];
}

/** A project with one card ("Shared card", OF-1) holding `description`; `guest` joins as member. */
async function setup(owner: Page, guest: Page | null, description: string) {
  const ws = (await (
    await post(owner, '/api/workspaces', { name: `Offline ${randomUUID().slice(0, 8)}` })
  ).json()) as { workspace: { id: string } };
  const project = (await (
    await post(owner, `/api/workspaces/${ws.workspace.id}/projects`, { name: 'Offline', key: 'OF' })
  ).json()) as { project: { id: string } };
  const board = (await (
    await owner.request.get(`/api/projects/${project.project.id}/board`)
  ).json()) as BoardJson;
  const created = (await (
    await post(owner, `/api/columns/${board.columns[0]?.id}/cards`, {
      title: 'Shared card',
      description,
    })
  ).json()) as { card: { id: string } };
  if (guest) {
    const invite = (await (
      await post(owner, `/api/workspaces/${ws.workspace.id}/invites`, {
        role: 'member',
        expiresInDays: 1,
      })
    ).json()) as { link: string };
    const accepted = await post(
      guest,
      `/api/invites/${invite.link.split('/invite/')[1]}/accept`,
      {},
    );
    expect(accepted.status()).toBe(200);
  }
  return { projectId: project.project.id, cardId: created.card.id };
}

const boardOf = async (page: Page, projectId: string): Promise<BoardJson> =>
  (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as BoardJson;

const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Card OF-1' });
const editorOf = (page: Page) => dialogOf(page).getByRole('textbox', { name: 'Description' });
const connection = (page: Page) => page.getByTestId('connection-status');

test('A works offline (description, move, create) while B edits the same description; both converge', async ({
  userA,
  userB,
}) => {
  const a = userA.page;
  const b = userB.page;
  await signUpViaApi(a, { name: 'Ana Owner' });
  await signUpViaApi(b, { name: 'Bea Member' });
  const { projectId, cardId } = await setup(a, b, 'Shared text');

  await Promise.all([
    a.goto(`/projects/${projectId}/cards/1`),
    b.goto(`/projects/${projectId}/cards/1`),
  ]);
  await expect(connection(a)).toHaveText('Connected');
  await expect(editorOf(a)).toHaveValue('Shared text');
  await expect(editorOf(b)).toHaveValue('Shared text');
  await expect(dialogOf(a).getByTestId('description-status')).toHaveText('Saved');

  // A loses the network and keeps working.
  await a.context().setOffline(true);
  await expect(connection(a)).toHaveText('Offline');
  await editorOf(a).focus();
  await a.keyboard.press('Control+Home');
  await a.keyboard.type('A offline. ');
  await expect(editorOf(a)).toHaveValue('A offline. Shared text');

  // Move the card to Done with "Move to...", then close the dialog and add a card.
  await dialogOf(a).getByLabel('Column').selectOption({ label: 'Done' });
  await dialogOf(a).getByRole('button', { name: 'Move card' }).click();
  await a.keyboard.press('Escape');
  await expect(dialogOf(a)).toBeHidden();
  await expect(
    a.getByRole('region', { name: 'Column Done' }).getByRole('link', { name: /OF-1/ }),
  ).toBeVisible();
  await a.getByRole('button', { name: 'Add card to To do' }).click();
  await a.getByLabel('Card title').fill('Created offline');
  await a.keyboard.press('Enter');
  // Shown at once, as a card the server has not numbered yet (so not a link).
  await expect(a.getByText('Created offline')).toBeVisible();
  // The move, the create and the unsent description are all pending, and said so in text.
  await expect(a.getByTestId('pending-changes')).toHaveText('3 changes pending');

  // Meanwhile B edits the same description at the other end.
  await editorOf(b).focus();
  await b.keyboard.press('Control+End');
  await b.keyboard.type(' B meanwhile.');
  await expect(dialogOf(b).getByTestId('description-status')).toHaveText('Saved');
  // Nothing of A's reached B yet.
  await expect(editorOf(b)).toHaveValue('Shared text B meanwhile.');

  // A comes back: everything syncs, nothing is lost or duplicated.
  await a.context().setOffline(false);
  await expect(connection(a)).toHaveText('Connected', { timeout: 15_000 });
  await expect(a.getByTestId('pending-changes')).toHaveCount(0);

  const expected = 'A offline. Shared text B meanwhile.';
  await expect(editorOf(b)).toHaveValue(expected, { timeout: 10_000 });
  await a.getByRole('link', { name: /OF-1/ }).click();
  await expect(editorOf(a)).toHaveValue(expected, { timeout: 10_000 });
  await expect
    .poll(
      async () =>
        (
          (await (await a.request.get(`/api/cards/${cardId}`)).json()) as {
            card: { description: string };
          }
        ).card.description,
      { timeout: 10_000 },
    )
    .toBe(expected);

  // B sees A's move and exactly one new card; the server state equals what both screens show.
  await b.keyboard.press('Escape');
  await expect(
    b.getByRole('region', { name: 'Column Done' }).getByRole('link', { name: /OF-1/ }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(b.getByRole('link', { name: /Created offline/ })).toHaveCount(1);
  const board = await boardOf(a, projectId);
  expect(board.cards.filter((c) => c.title === 'Created offline')).toHaveLength(1);
  const done = board.columns.find((c) => c.name === 'Done');
  expect(board.cards.find((c) => c.id === cardId)?.columnId).toBe(done?.id);
});

test('a session that expired while offline is reported, not silently dropped', async ({
  userA,
}) => {
  const a = userA.page;
  await signUpViaApi(a, { name: 'Ana Owner' });
  const { projectId } = await setup(a, null, '');

  await a.goto(`/projects/${projectId}`);
  await expect(connection(a)).toHaveText('Connected');
  await a.context().setOffline(true);
  await expect(connection(a)).toHaveText('Offline');
  await a.getByRole('button', { name: 'Add card to To do' }).click();
  await a.getByLabel('Card title').fill('Will not be saved');
  await a.keyboard.press('Enter');
  await expect(a.getByTestId('pending-changes')).toHaveText('1 change pending');

  // The session ends meanwhile (the request goes through the test's own network stack).
  const logout = await post(a, '/api/auth/logout', {});
  expect(logout.ok()).toBe(true);
  await a.context().setOffline(false);

  await expect(a.getByRole('heading', { name: 'Log in' })).toBeVisible({ timeout: 15_000 });
  await expect(a.getByTestId('login-notice')).toHaveText(
    'Your session expired; 1 pending change was not saved',
  );
});
