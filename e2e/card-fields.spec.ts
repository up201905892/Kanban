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

/** Creates a workspace, a project and one card through the API; returns the project id. */
async function createProjectWithCard(page: Page): Promise<string> {
  const workspace = await page.request.post('/api/workspaces', {
    data: { name: `Acme ${randomUUID().slice(0, 8)}` },
    headers: { origin: ORIGIN },
  });
  const { workspace: ws } = (await workspace.json()) as { workspace: { id: string } };
  const project = await page.request.post(`/api/workspaces/${ws.id}/projects`, {
    data: { name: 'Fields Test', key: 'FT' },
    headers: { origin: ORIGIN },
  });
  const projectId = ((await project.json()) as { project: { id: string } }).project.id;
  const board = await page.request.get(`/api/projects/${projectId}/board`);
  const { columns } = (await board.json()) as { columns: { id: string }[] };
  const card = await page.request.post(`/api/columns/${columns[0]?.id}/cards`, {
    data: { title: 'Estimate me' },
    headers: { origin: ORIGIN },
  });
  expect(card.status()).toBe(201);
  return projectId;
}

test.describe('card fields', () => {
  test('set assignee, priority and estimate with the keyboard; they persist and show on the tile', async ({
    page,
  }) => {
    await signUpViaApi(page, { name: 'Ada Lovelace' });
    const projectId = await createProjectWithCard(page);
    await page.goto(`/projects/${projectId}/cards/1`);
    const dialog = page.getByRole('dialog', { name: 'Card FT-1' });

    const assignee = dialog.getByLabel('Assignee');
    await expect(assignee.getByRole('option', { name: 'Ada Lovelace' })).toBeAttached();
    await assignee.selectOption({ label: 'Ada Lovelace' });
    await expect(page.getByTestId('live-polite')).toHaveText('Card assigned to Ada Lovelace');

    await dialog.getByLabel('Priority').selectOption('urgent');
    await expect(page.getByTestId('live-polite')).toHaveText('Priority set to Urgent');

    // Invalid values are explained and not sent.
    const estimate = dialog.getByLabel('Estimate (story points)');
    await estimate.fill('101');
    await estimate.press('Enter');
    await expect(dialog.getByText('Estimate must be at most 100')).toBeVisible();
    await expect(estimate).toHaveAttribute('aria-invalid', 'true');
    await estimate.fill('13');
    await estimate.press('Enter');
    await expect(page.getByTestId('live-polite')).toHaveText('Estimate set to 13 points');

    await expectNoBlockingAxeViolations(page);

    await page.reload();
    const reloaded = page.getByRole('dialog', { name: 'Card FT-1' });
    await expect(reloaded.getByLabel('Assignee')).toHaveValue(/.+/);
    await expect(reloaded.getByLabel('Priority')).toHaveValue('urgent');
    await expect(reloaded.getByLabel('Estimate (story points)')).toHaveValue('13');

    await page.keyboard.press('Escape');
    const tile = page.getByRole('link', { name: /FT-1 Estimate me/ });
    await expect(tile.getByRole('img', { name: 'Assignee: Ada Lovelace' })).toHaveText('AL');
    await expect(tile.getByText('Urgent')).toBeVisible();
    await expect(tile.getByRole('img', { name: 'Estimate: 13 points' })).toHaveText('13 pts');
    await expectNoBlockingAxeViolations(page);
  });
});
