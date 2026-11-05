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

async function createProjectViaApi(page: Page): Promise<string> {
  const workspace = await page.request.post('/api/workspaces', {
    data: { name: `Acme ${randomUUID().slice(0, 8)}` },
    headers: { origin: ORIGIN },
  });
  const { workspace: ws } = (await workspace.json()) as { workspace: { id: string } };
  const project = await page.request.post(`/api/workspaces/${ws.id}/projects`, {
    data: { name: 'Board Test', key: 'BT' },
    headers: { origin: ORIGIN },
  });
  expect(project.status()).toBe(201);
  return ((await project.json()) as { project: { id: string } }).project.id;
}

const columnTitles = (page: Page) => page.locator('.board-column h2');

test.describe('board and columns', () => {
  test('add, rename, reorder by keyboard and delete a column; state survives a reload', async ({
    page,
  }) => {
    await signUpViaApi(page);
    const projectId = await createProjectViaApi(page);
    await page.goto(`/projects/${projectId}`);

    // A new project starts with the three default columns.
    await expect(columnTitles(page)).toHaveText(['To do', 'In progress', 'Done (Done column)']);
    await expectNoBlockingAxeViolations(page);

    // Add a column.
    await page.getByRole('button', { name: 'Add column' }).click();
    await page.getByLabel('Column name').fill('Review');
    await page.keyboard.press('Enter');
    await expect(columnTitles(page)).toHaveText([
      'To do',
      'In progress',
      'Done (Done column)',
      'Review',
    ]);
    await expect(page.getByTestId('live-polite')).toHaveText('Column Review added');
    await expect(page.getByRole('button', { name: 'Add column' })).toBeFocused();

    // Rename inline: Escape cancels, Enter saves.
    await page.getByRole('button', { name: 'To do', exact: true }).click();
    await page.keyboard.type('Ignored');
    await page.keyboard.press('Escape');
    await expect(columnTitles(page).first()).toHaveText('To do');
    await page.getByRole('button', { name: 'To do', exact: true }).click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Backlog');
    await page.keyboard.press('Enter');
    await expect(columnTitles(page).first()).toHaveText('Backlog');

    // Reorder with the keyboard alone: menu trigger, Enter, arrows, Enter.
    const trigger = page.getByRole('button', { name: 'Actions for column Backlog' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Actions for column Backlog' })).toBeVisible();
    await expectNoBlockingAxeViolations(page);
    await page.keyboard.press('ArrowDown'); // Move left (disabled at the edge)
    await page.keyboard.press('ArrowDown'); // Move right
    await page.keyboard.press('Enter');
    await expect(columnTitles(page)).toHaveText([
      'In progress',
      'Backlog',
      'Done (Done column)',
      'Review',
    ]);
    await expect(page.getByTestId('live-polite')).toHaveText(
      'Column Backlog moved to position 2 of 4',
    );
    await expect(trigger).toBeFocused();

    // Mark Review as the Done column.
    await page.getByRole('button', { name: 'Actions for column Review' }).click();
    await page.getByRole('menuitem', { name: 'Mark as Done column' }).click();
    await expect(columnTitles(page)).toHaveText([
      'In progress',
      'Backlog',
      'Done',
      'Review (Done column)',
    ]);

    // The state is on the server.
    await page.reload();
    await expect(columnTitles(page)).toHaveText([
      'In progress',
      'Backlog',
      'Done',
      'Review (Done column)',
    ]);

    // Delete needs a confirmation; the Done column cannot be deleted.
    await page.getByRole('button', { name: 'Actions for column Review' }).click();
    await expect(page.getByRole('menuitem', { name: /Delete/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Actions for column Done' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete column Done?' });
    await expectNoBlockingAxeViolations(page);
    await dialog.getByRole('button', { name: 'Delete column' }).click();
    await expect(columnTitles(page)).toHaveText(['In progress', 'Backlog', 'Review (Done column)']);
    await page.reload();
    await expect(columnTitles(page)).toHaveText(['In progress', 'Backlog', 'Review (Done column)']);
  });

  test('a viewer sees the board without editing controls', async ({ userA, userB }) => {
    await signUpViaApi(userA.page);
    const viewer = await signUpViaApi(userB.page);
    const projectId = await createProjectViaApi(userA.page);
    const project = await userA.page.request.get(`/api/projects/${projectId}`);
    const { project: p } = (await project.json()) as { project: { workspaceId: string } };
    const invite = await userA.page.request.post(`/api/workspaces/${p.workspaceId}/invites`, {
      data: { role: 'viewer', expiresInDays: 1 },
      headers: { origin: ORIGIN },
    });
    const { link } = (await invite.json()) as { link: string };
    expect(viewer.email).toContain('@');

    await userB.page.goto(new URL(link).pathname);
    await userB.page.getByRole('button', { name: 'Accept' }).click();
    await userB.page.goto(`/projects/${projectId}`);
    await expect(columnTitles(userB.page)).toHaveText([
      'To do',
      'In progress',
      'Done (Done column)',
    ]);
    await expect(userB.page.getByRole('button', { name: 'Add column' })).toHaveCount(0);
    await expect(userB.page.getByRole('button', { name: /Actions for column/ })).toHaveCount(0);
    await expectNoBlockingAxeViolations(userB.page);
  });
});
