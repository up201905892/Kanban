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

test('velocity shows a closed sprint in the table; empty state first; keyboard toggle; axe', async ({
  userA,
}) => {
  const page = userA.page;
  await signUpViaApi(page, { name: 'Ana Owner' });
  const ws = (await (
    await post(page, '/api/workspaces', { name: `Vel ${randomUUID().slice(0, 8)}` })
  ).json()) as { workspace: { id: string } };
  const project = (await (
    await post(page, `/api/workspaces/${ws.workspace.id}/projects`, { name: 'Vel', key: 'VL' })
  ).json()) as { project: { id: string } };
  const projectId = project.project.id;
  const board = (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as {
    columns: { id: string; isDone: boolean }[];
  };
  const todo = board.columns[0];
  const done = board.columns.find((c) => c.isDone);
  if (!todo || !done) throw new Error('default columns missing');

  await page.goto(`/projects/${projectId}/reports`);
  await expect(page.getByRole('heading', { name: 'Close a sprint to see velocity' })).toBeVisible();
  await expectNoBlockingAxeViolations(page);

  const cardIds: string[] = [];
  for (const estimate of [3, 5]) {
    const created = (await (
      await post(page, `/api/columns/${todo.id}/cards`, { title: `Card ${estimate}` })
    ).json()) as { card: { id: string } };
    await page.request.patch(`/api/cards/${created.card.id}`, {
      data: { estimate },
      headers: { origin: ORIGIN },
    });
    cardIds.push(created.card.id);
  }
  const sprint = (await (
    await post(page, `/api/projects/${projectId}/sprints`, {
      name: 'Vel sprint',
      startDate: utcDate(0),
      endDate: utcDate(4),
    })
  ).json()) as { sprint: { id: string } };
  for (const id of cardIds) {
    await page.request.put(`/api/cards/${id}/sprint`, {
      data: { sprintId: sprint.sprint.id },
      headers: { origin: ORIGIN },
    });
  }
  await post(page, `/api/sprints/${sprint.sprint.id}/start`, {});
  const finished = cardIds[1];
  if (!finished) throw new Error('missing card');
  await post(page, `/api/cards/${finished}/move`, { columnId: done.id });
  await post(page, `/api/sprints/${sprint.sprint.id}/close`, {});

  await page.reload();
  await expect(page.getByText(/Average velocity: 5 points completed/)).toBeVisible();
  await page.getByRole('button', { name: 'Show velocity as table' }).focus();
  await page.keyboard.press('Enter');
  const table = page.getByRole('table', { name: /Velocity/ });
  const row = table.getByRole('row', { name: /Vel sprint/ });
  await expect(row.getByRole('cell').nth(0)).toHaveText('8');
  await expect(row.getByRole('cell').nth(1)).toHaveText('5');
  await expectNoBlockingAxeViolations(page);
});
