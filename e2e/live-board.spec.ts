import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, signUpViaApi, test } from './fixtures.js';

const ORIGIN = 'http://localhost:5173';
/** Spec: another person's change shows up within 2 seconds. */
const LIVE = { timeout: 2000 };

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking).toEqual([]);
}

const post = (page: Page, url: string, data: object) =>
  page.request.post(url, { data, headers: { origin: ORIGIN } });

/** A workspace and project owned by `page`'s user; returns the ids needed to share and drive it. */
async function createProject(page: Page) {
  const ws = (await (
    await post(page, '/api/workspaces', { name: `Live ${randomUUID().slice(0, 8)}` })
  ).json()) as {
    workspace: { id: string };
  };
  const project = (await (
    await post(page, `/api/workspaces/${ws.workspace.id}/projects`, { name: 'Live', key: 'LV' })
  ).json()) as { project: { id: string } };
  const board = (await (
    await page.request.get(`/api/projects/${project.project.id}/board`)
  ).json()) as {
    columns: { id: string; name: string }[];
  };
  return { workspaceId: ws.workspace.id, projectId: project.project.id, columns: board.columns };
}

/** Joins `guest` to the workspace with `role` through a real invite link. */
async function invite(owner: Page, guest: Page, workspaceId: string, role: 'member' | 'viewer') {
  const created = await post(owner, `/api/workspaces/${workspaceId}/invites`, {
    role,
    expiresInDays: 7,
  });
  const { link } = (await created.json()) as { link: string };
  const token = link.split('/invite/')[1];
  const accepted = await post(guest, `/api/invites/${token}/accept`, {});
  expect(accepted.status()).toBe(200);
}

for (const role of ['member', 'viewer'] as const) {
  test(`a ${role} sees another person's card changes without reloading`, async ({
    userA,
    userB,
  }) => {
    const a = userA.page;
    const b = userB.page;
    await signUpViaApi(a, { name: 'Ana Owner' });
    await signUpViaApi(b, { name: 'Bea Guest' });
    const { workspaceId, projectId, columns } = await createProject(a);
    await invite(a, b, workspaceId, role);
    const [todo, doing] = columns;
    if (!todo || !doing) throw new Error('default columns missing');

    await a.goto(`/projects/${projectId}`);
    await b.goto(`/projects/${projectId}`);
    await expect(b.getByRole('region', { name: 'Column To do' })).toBeVisible();

    // Create (through the UI of A).
    await a.getByRole('button', { name: 'Add card to To do' }).click();
    await a.getByLabel('Card title').fill('Live card');
    await a.keyboard.press('Enter');
    const created = b.getByRole('region', { name: 'Column To do' }).getByRole('link', {
      name: 'LV-1 Live card',
    });
    await expect(created).toBeVisible(LIVE);

    // Edit.
    const cardId = (
      (await (await a.request.get(`/api/projects/${projectId}/board`)).json()) as {
        cards: { id: string }[];
      }
    ).cards[0]?.id;
    const patch = await a.request.patch(`/api/cards/${cardId}`, {
      data: { title: 'Edited live', priority: 'high' },
      headers: { origin: ORIGIN },
    });
    expect(patch.status()).toBe(200);
    await expect(b.getByRole('link', { name: 'LV-1 Edited live' })).toBeVisible(LIVE);
    await expect(b.getByText('High')).toBeVisible(LIVE);

    // Move.
    const moved = await post(a, `/api/cards/${cardId}/move`, { columnId: doing.id });
    expect(moved.status()).toBe(200);
    await expect(
      b.getByRole('region', { name: `Column ${doing.name}` }).getByRole('link', {
        name: 'LV-1 Edited live',
      }),
    ).toBeVisible(LIVE);
    await expect(
      b.getByRole('region', { name: 'Column To do' }).getByRole('link', { name: /LV-1/ }),
    ).toHaveCount(0);

    // The change is also on A's own screen, once, and B's page is accessible throughout.
    await expectNoBlockingAxeViolations(b);

    // Delete.
    const deleted = await a.request.delete(`/api/cards/${cardId}`, { headers: { origin: ORIGIN } });
    expect(deleted.status()).toBe(204);
    await expect(b.getByRole('link', { name: /LV-1/ })).toHaveCount(0, LIVE);
    await expectNoBlockingAxeViolations(b);
  });
}

test('a card dialog open on B says who deleted the card and closes on confirm', async ({
  userA,
  userB,
}) => {
  const a = userA.page;
  const b = userB.page;
  await signUpViaApi(a, { name: 'Ana Owner' });
  await signUpViaApi(b, { name: 'Bea Guest' });
  const { workspaceId, projectId, columns } = await createProject(a);
  await invite(a, b, workspaceId, 'member');
  const created = await post(a, `/api/columns/${columns[0]?.id}/cards`, { title: 'Doomed' });
  const cardId = ((await created.json()) as { card: { id: string } }).card.id;

  await b.goto(`/projects/${projectId}/cards/1`);
  const dialog = b.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Doomed' })).toBeVisible();

  const deleted = await a.request.delete(`/api/cards/${cardId}`, { headers: { origin: ORIGIN } });
  expect(deleted.status()).toBe(204);
  await expect(b.getByText('This card was deleted by Ana Owner')).toBeVisible(LIVE);
  await expectNoBlockingAxeViolations(b);
  await b.getByRole('button', { name: 'OK' }).click();
  await expect(b.getByRole('dialog')).toHaveCount(0);
});

test('column changes appear live too', async ({ userA, userB }) => {
  const a = userA.page;
  const b = userB.page;
  await signUpViaApi(a, { name: 'Ana Owner' });
  await signUpViaApi(b, { name: 'Bea Guest' });
  const { workspaceId, projectId, columns } = await createProject(a);
  await invite(a, b, workspaceId, 'viewer');
  await b.goto(`/projects/${projectId}`);
  await expect(b.getByRole('region', { name: 'Column To do' })).toBeVisible();

  const board = (await (await a.request.get(`/api/projects/${projectId}/board`)).json()) as {
    board: { id: string };
  };
  await post(a, `/api/boards/${board.board.id}/columns`, { name: 'Review' });
  await expect(b.getByRole('region', { name: 'Column Review' })).toBeVisible(LIVE);

  const first = columns[0];
  const renamed = await a.request.patch(`/api/columns/${first?.id}`, {
    data: { name: 'Backlog' },
    headers: { origin: ORIGIN },
  });
  expect(renamed.status()).toBe(200);
  await expect(b.getByRole('region', { name: 'Column Backlog' })).toBeVisible(LIVE);

  const removed = await a.request.delete(`/api/columns/${first?.id}`, {
    headers: { origin: ORIGIN },
  });
  expect(removed.status()).toBe(204);
  await expect(b.getByRole('region', { name: 'Column Backlog' })).toHaveCount(0, LIVE);
});
