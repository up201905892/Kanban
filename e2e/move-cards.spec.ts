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

/** A project with the default columns and the given cards (titles) in "To do". */
async function createProjectWithCards(page: Page, titles: string[]): Promise<string> {
  const workspace = await page.request.post('/api/workspaces', {
    data: { name: `Acme ${randomUUID().slice(0, 8)}` },
    headers: { origin: ORIGIN },
  });
  const { workspace: ws } = (await workspace.json()) as { workspace: { id: string } };
  const project = await page.request.post(`/api/workspaces/${ws.id}/projects`, {
    data: { name: 'Move Test', key: 'MV' },
    headers: { origin: ORIGIN },
  });
  const projectId = ((await project.json()) as { project: { id: string } }).project.id;
  const board = (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as {
    columns: { id: string }[];
  };
  for (const title of titles) {
    const res = await page.request.post(`/api/columns/${board.columns[0]?.id}/cards`, {
      data: { title },
      headers: { origin: ORIGIN },
    });
    expect(res.status()).toBe(201);
  }
  return projectId;
}

const tilesIn = (page: Page, column: string) =>
  page.getByRole('region', { name: `Column ${column}` }).getByRole('link');

test.describe('moving cards', () => {
  test('mouse drag between columns persists after reload', async ({ page }) => {
    await signUpViaApi(page);
    const projectId = await createProjectWithCards(page, ['First', 'Second']);
    await page.goto(`/projects/${projectId}`);
    const source = page.getByRole('link', { name: /MV-1 First/ });
    const target = page.getByRole('region', { name: 'Column In progress' });
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error('missing boxes');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, {
      steps: 5,
    });
    await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 15 });
    await page.mouse.up();
    await expect(tilesIn(page, 'In progress')).toHaveText(['MV-1 First']);
    await expect(tilesIn(page, 'To do')).toHaveText(['MV-2 Second']);
    // The drop did not open the card.
    await expect(page).toHaveURL(`/projects/${projectId}`);
    await page.reload();
    await expect(tilesIn(page, 'In progress')).toHaveText(['MV-1 First']);
    await expect(tilesIn(page, 'To do')).toHaveText(['MV-2 Second']);
  });

  test('keyboard move persists, announces every step and Escape cancels', async ({ page }) => {
    await signUpViaApi(page);
    const projectId = await createProjectWithCards(page, ['Fix login', 'Second']);
    await page.goto(`/projects/${projectId}`);
    const live = page.getByTestId('live-polite');

    // Escape first: the card returns to where it started.
    await page.getByRole('button', { name: 'Move card MV-1' }).focus();
    await page.keyboard.press('Space');
    await expect(live).toHaveText(/^Picked up Card MV-1 'Fix login'\. To do, position 1 of 2\./);
    await page.keyboard.press('ArrowRight');
    await expect(live).toHaveText(/^Card MV-1 'Fix login' moved to In progress, position 1 of 1$/);
    await page.keyboard.press('Escape');
    await expect(live).toHaveText(
      "Move cancelled. Card MV-1 'Fix login' returned to To do, position 1 of 2",
    );
    await expect(tilesIn(page, 'To do')).toHaveText(['MV-1 Fix login', 'MV-2 Second']);
    await expect(tilesIn(page, 'In progress')).toHaveCount(0);

    // Now the move itself: Space, ArrowRight, Space.
    await page.getByRole('button', { name: 'Move card MV-1' }).focus();
    await page.keyboard.press('Space');
    await expect(live).toContainText('Picked up');
    await page.keyboard.press('ArrowRight');
    await expect(live).toContainText('moved to In progress');
    await page.keyboard.press('Space');
    await expect(live).toHaveText("Card MV-1 'Fix login' dropped in In progress, position 1 of 1");
    await expect(tilesIn(page, 'In progress')).toHaveText(['MV-1 Fix login']);
    await expect(page.getByRole('button', { name: 'Move card MV-1' })).toBeFocused();

    await page.reload();
    await expect(tilesIn(page, 'In progress')).toHaveText(['MV-1 Fix login']);
    await expect(tilesIn(page, 'To do')).toHaveText(['MV-2 Second']);
  });

  test('Space on the card itself picks it up and ArrowDown reorders in the column', async ({
    page,
  }) => {
    await signUpViaApi(page);
    const projectId = await createProjectWithCards(page, ['One', 'Two', 'Three']);
    await page.goto(`/projects/${projectId}`);
    await page.getByRole('link', { name: /MV-1 One/ }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('live-polite')).toContainText('Picked up');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('live-polite')).toContainText('position 2 of 3');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('live-polite')).toContainText('position 3 of 3');
    await page.keyboard.press('Space');
    await expect(tilesIn(page, 'To do')).toHaveText(['MV-2 Two', 'MV-3 Three', 'MV-1 One']);
    await page.reload();
    await expect(tilesIn(page, 'To do')).toHaveText(['MV-2 Two', 'MV-3 Three', 'MV-1 One']);
  });

  test('"Move to..." in the card dialog moves a card without dragging', async ({ page }) => {
    await signUpViaApi(page);
    const projectId = await createProjectWithCards(page, ['Alpha', 'Beta']);
    await page.goto(`/projects/${projectId}/cards/2`);
    const dialog = page.getByRole('dialog', { name: 'Card MV-2' });
    await dialog.getByLabel('Column').selectOption({ label: 'Done' });
    await dialog.getByLabel('Position').selectOption({ label: 'Top' });
    await dialog.getByRole('button', { name: 'Move card' }).click();
    await expect(page.getByTestId('live-polite')).toHaveText(
      "Card MV-2 'Beta' moved to Done, position 1 of 1",
    );
    await expect(tilesIn(page, 'Done')).toHaveText(['MV-2 Beta']);
    await page.reload();
    await expect(tilesIn(page, 'Done')).toHaveText(['MV-2 Beta']);
    await expect(tilesIn(page, 'To do')).toHaveText(['MV-1 Alpha']);
  });

  test('a failed move rolls back and announces the error', async ({ page }) => {
    await signUpViaApi(page);
    const projectId = await createProjectWithCards(page, ['Rollback me']);
    await page.goto(`/projects/${projectId}`);
    await page.route('**/api/cards/*/move', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Boom' } }),
      }),
    );
    await page.getByRole('button', { name: 'Move card MV-1' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('live-polite')).toContainText('Picked up');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('live-polite')).toContainText('moved to In progress');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('live-assertive')).toContainText('Could not move Card MV-1');
    await expect(tilesIn(page, 'To do')).toHaveText(['MV-1 Rollback me']);
  });

  test('the board has no blocking accessibility violations', async ({ page }) => {
    await signUpViaApi(page);
    const projectId = await createProjectWithCards(page, ['Axe one', 'Axe two']);
    await page.goto(`/projects/${projectId}`);
    await expect(tilesIn(page, 'To do')).toHaveCount(2);
    await expectNoBlockingAxeViolations(page);
  });
});
