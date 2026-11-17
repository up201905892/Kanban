import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, signUpViaApi, test } from './fixtures.js';

const ORIGIN = 'http://localhost:5173';

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking).toEqual([]);
}

async function createProjectWithCard(page: Page): Promise<string> {
  const workspace = await page.request.post('/api/workspaces', {
    data: { name: `Acme ${randomUUID().slice(0, 8)}` },
    headers: { origin: ORIGIN },
  });
  const { workspace: ws } = (await workspace.json()) as { workspace: { id: string } };
  const project = await page.request.post(`/api/workspaces/${ws.id}/projects`, {
    data: { name: 'Activity Test', key: 'AC' },
    headers: { origin: ORIGIN },
  });
  const projectId = ((await project.json()) as { project: { id: string } }).project.id;
  const board = await page.request.get(`/api/projects/${projectId}/board`);
  const { columns } = (await board.json()) as { columns: { id: string }[] };
  const card = await page.request.post(`/api/columns/${columns[0]?.id}/cards`, {
    data: { title: 'Track me' },
    headers: { origin: ORIGIN },
  });
  expect(card.status()).toBe(201);
  return projectId;
}

test.describe('card activity', () => {
  test('title change, move and estimate appear in order, newest first', async ({ page }) => {
    await signUpViaApi(page, { name: 'Ada Lovelace' });
    const projectId = await createProjectWithCard(page);
    await page.goto(`/projects/${projectId}/cards/1`);
    const dialog = page.getByRole('dialog', { name: 'Card AC-1' });
    const items = dialog.getByRole('list').last().getByRole('listitem');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Ada Lovelace created this card in To do');

    await dialog.getByRole('button', { name: 'Edit title' }).click();
    await dialog.getByLabel('Card title').fill('Tracked');
    await dialog.getByLabel('Card title').press('Enter');
    await expect(items).toHaveCount(2);

    await dialog.getByLabel('Column').selectOption({ label: 'In progress' });
    await dialog.getByRole('button', { name: 'Move card' }).click();
    await expect(items).toHaveCount(3);

    const estimate = dialog.getByLabel('Estimate (story points)');
    await estimate.fill('5');
    await estimate.press('Enter');
    await expect(items).toHaveCount(4);

    await expect(items.nth(0)).toContainText('changed the estimate from no estimate to 5 points');
    await expect(items.nth(1)).toContainText('moved this card from To do to In progress');
    await expect(items.nth(2)).toContainText('changed the title from');
    await expect(items.nth(3)).toContainText('created this card');
    await expect(items.nth(0).locator('time')).toHaveAttribute('datetime', /^\d{4}-\d\d-\d\dT/);

    await expectNoBlockingAxeViolations(page);
  });
});
