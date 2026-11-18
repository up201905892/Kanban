import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, signUpViaApi, test } from './fixtures.js';

const ORIGIN = 'http://localhost:5173';
const DAY = 24 * 60 * 60 * 1000;
const utcDate = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking).toEqual([]);
}

const post = (page: Page, url: string, data: object) =>
  page.request.post(url, { data, headers: { origin: ORIGIN } });

async function createProject(page: Page) {
  const ws = (await (
    await post(page, '/api/workspaces', { name: `Burn ${randomUUID().slice(0, 8)}` })
  ).json()) as { workspace: { id: string } };
  const project = (await (
    await post(page, `/api/workspaces/${ws.workspace.id}/projects`, { name: 'Burn', key: 'BD' })
  ).json()) as { project: { id: string } };
  const board = (await (
    await page.request.get(`/api/projects/${project.project.id}/board`)
  ).json()) as { columns: { id: string; isDone: boolean }[] };
  const todo = board.columns[0];
  const done = board.columns.find((c) => c.isDone);
  if (!todo || !done) throw new Error('default columns missing');
  return { projectId: project.project.id, todo, done };
}

test('burndown shows the remaining points drop after a card moves to Done; table by keyboard; axe', async ({
  userA,
}) => {
  const page = userA.page;
  await signUpViaApi(page, { name: 'Ana Owner' });
  const { projectId, todo, done } = await createProject(page);

  await page.goto(`/projects/${projectId}/reports`);
  await expect(page.getByRole('heading', { name: 'No active sprint' })).toBeVisible();

  const cards: string[] = [];
  for (const estimate of [3, 5]) {
    const created = (await (
      await post(page, `/api/columns/${todo.id}/cards`, { title: `Card ${estimate}` })
    ).json()) as { card: { id: string } };
    await page.request.patch(`/api/cards/${created.card.id}`, {
      data: { estimate },
      headers: { origin: ORIGIN },
    });
    cards.push(created.card.id);
  }
  const sprint = (await (
    await post(page, `/api/projects/${projectId}/sprints`, {
      name: 'Burn sprint',
      startDate: utcDate(0),
      endDate: utcDate(4),
    })
  ).json()) as { sprint: { id: string } };
  for (const id of cards) {
    await page.request.put(`/api/cards/${id}/sprint`, {
      data: { sprintId: sprint.sprint.id },
      headers: { origin: ORIGIN },
    });
  }
  await post(page, `/api/sprints/${sprint.sprint.id}/start`, {});

  await page.reload();
  await expect(page.getByText(/8 of 8 points remaining/)).toBeVisible();
  await expectNoBlockingAxeViolations(page);

  // The toggle works with the keyboard alone.
  await page.getByRole('button', { name: 'Show as table' }).focus();
  await page.keyboard.press('Enter');
  const table = page.getByRole('table', { name: /Burndown of Burn sprint/ });
  const todayRow = table.getByRole('row', { name: new RegExp(utcDate(0)) });
  await expect(todayRow.getByRole('cell').first()).toHaveText('8');
  await expectNoBlockingAxeViolations(page);

  // Finish the 5-point card: today's remaining value drops (the page updates over the board room).
  const first = cards[1];
  if (!first) throw new Error('missing card');
  await post(page, `/api/cards/${first}/move`, { columnId: done.id });
  await expect(todayRow.getByRole('cell').first()).toHaveText('3', { timeout: 5000 });
  await expect(todayRow.getByRole('cell').nth(1)).toHaveText('8');
});
