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

/** A workspace and project owned by `page`'s user, with `count` cards in the first column. */
async function createProject(page: Page, count: number) {
  const ws = (await (
    await post(page, '/api/workspaces', { name: `Sprints ${randomUUID().slice(0, 8)}` })
  ).json()) as { workspace: { id: string } };
  const project = (await (
    await post(page, `/api/workspaces/${ws.workspace.id}/projects`, { name: 'Plan', key: 'PL' })
  ).json()) as { project: { id: string } };
  const board = (await (
    await page.request.get(`/api/projects/${project.project.id}/board`)
  ).json()) as { columns: { id: string }[] };
  const todo = board.columns[0];
  if (!todo) throw new Error('default columns missing');
  const cardIds: string[] = [];
  for (let n = 1; n <= count; n += 1) {
    const created = (await (
      await post(page, `/api/columns/${todo.id}/cards`, { title: `Task ${n}` })
    ).json()) as { card: { id: string } };
    cardIds.push(created.card.id);
    await page.request.patch(`/api/cards/${created.card.id}`, {
      data: { estimate: n },
      headers: { origin: ORIGIN },
    });
  }
  return { workspaceId: ws.workspace.id, projectId: project.project.id, cardIds };
}

async function invite(owner: Page, guest: Page, workspaceId: string) {
  const created = await post(owner, `/api/workspaces/${workspaceId}/invites`, {
    role: 'member',
    expiresInDays: 7,
  });
  const { link } = (await created.json()) as { link: string };
  const token = link.split('/invite/')[1];
  expect((await post(guest, `/api/invites/${token}/accept`, {})).status()).toBe(200);
}

test('plans a sprint with the keyboard, starts it, and the board shows only its cards', async ({
  userA,
}) => {
  const page = userA.page;
  await signUpViaApi(page, { name: 'Ana Owner' });
  const { projectId } = await createProject(page, 4);

  await page.goto(`/projects/${projectId}/backlog`);
  await expect(page.getByRole('heading', { level: 1, name: /Backlog: Plan/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No sprints yet' })).toBeVisible();

  // Create a sprint through the dialog.
  await page.getByRole('button', { name: 'Create sprint' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create sprint' });
  await dialog.getByLabel('Name').fill('Sprint Alpha');
  await dialog.getByLabel('Goal (optional)').fill('Plan the first release');
  await dialog.getByRole('button', { name: 'Create' }).click();
  const section = page.getByRole('region', { name: 'Sprint Alpha' });
  await expect(section).toBeVisible();
  await expect(section.getByText('Plan the first release')).toBeVisible();

  // Add three cards: focus the button and press Enter, no mouse.
  for (const n of [1, 2, 3]) {
    const add = page.getByRole('button', { name: `Add to sprint: PL-${n}` });
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(
      section.getByRole('link', { name: `PL-${n} Task ${n}`, exact: false }),
    ).toBeVisible(LIVE);
  }
  await expect(section.getByText(/6 points/)).toBeVisible();
  const backlog = page.getByRole('region', { name: 'Backlog' });
  await expect(backlog.getByRole('link', { name: /PL-4 Task 4/ })).toBeVisible();
  await expect(backlog.getByRole('link', { name: /PL-1 Task 1/ })).toHaveCount(0);

  await expectNoBlockingAxeViolations(page);

  // Start it: confirmation first.
  await page.getByRole('button', { name: 'Start sprint Sprint Alpha' }).click();
  const confirm = page.getByRole('dialog', { name: 'Start Sprint Alpha?' });
  await expect(confirm.getByText(/3 cards, 6 points will be committed/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Start sprint' }).click();
  await expect(confirm).toBeHidden();
  await expect(section.getByText(/Active/)).toBeVisible();

  // The board shows the sprint and only its cards until the filter is turned off.
  await page.getByRole('link', { name: 'Back to the board' }).click();
  const banner = page.getByRole('region', { name: 'Active sprint' });
  await expect(banner.getByText('Sprint Alpha')).toBeVisible();
  const filter = banner.getByRole('checkbox', { name: 'Active sprint only' });
  await expect(filter).toBeChecked();
  const column = page.getByRole('region', { name: 'Column To do' });
  await expect(column.getByRole('link', { name: /PL-1 Task 1/ })).toBeVisible();
  await expect(column.getByRole('link', { name: /PL-3 Task 3/ })).toBeVisible();
  await expect(column.getByRole('link', { name: /PL-4 Task 4/ })).toHaveCount(0);
  await filter.uncheck();
  await expect(column.getByRole('link', { name: /PL-4 Task 4/ })).toBeVisible();
  await expectNoBlockingAxeViolations(page);
});

test('another person sees a card join the active sprint within 2 seconds', async ({
  userA,
  userB,
}) => {
  const a = userA.page;
  const b = userB.page;
  await signUpViaApi(a, { name: 'Ana Owner' });
  await signUpViaApi(b, { name: 'Bea Member' });
  const { workspaceId, projectId } = await createProject(a, 2);
  await invite(a, b, workspaceId);

  // A sprint that is already running, with no cards yet.
  const created = await post(a, `/api/projects/${projectId}/sprints`, {
    name: 'Live sprint',
    startDate: '2026-01-01',
    endDate: '2099-12-31',
  });
  const { sprint } = (await created.json()) as { sprint: { id: string } };
  expect((await post(a, `/api/sprints/${sprint.id}/start`, {})).status()).toBe(200);

  await b.goto(`/projects/${projectId}`);
  const column = b.getByRole('region', { name: 'Column To do' });
  await expect(b.getByRole('region', { name: 'Active sprint' })).toBeVisible();
  await expect(column.getByRole('link', { name: /PL-1 Task 1/ })).toHaveCount(0);

  await a.goto(`/projects/${projectId}/backlog`);
  await a.getByRole('button', { name: 'Add to sprint: PL-1' }).click();
  await expect(column.getByRole('link', { name: /PL-1 Task 1/ })).toBeVisible(LIVE);

  // Removing it again also reaches B live.
  await a.getByRole('button', { name: 'Remove from sprint: PL-1' }).click();
  await expect(column.getByRole('link', { name: /PL-1 Task 1/ })).toHaveCount(0, LIVE);
});
