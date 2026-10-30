import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, signUpViaApi, test } from './fixtures.js';

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking).toEqual([]);
}

const uniqueName = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`;

test.describe('workspaces', () => {
  test('create, see in the list and the switcher, rename, delete with confirmation', async ({
    page,
  }) => {
    await signUpViaApi(page);
    const name = uniqueName('Acme');
    const renamed = uniqueName('Renamed');

    await page.goto('/');
    await expect(page.getByRole('region', { name: 'No workspaces yet' })).toBeVisible();
    await expectNoBlockingAxeViolations(page);

    await page.getByRole('button', { name: 'Create workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create workspace' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    // Visible in the switcher and in the home list.
    await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue(/.+/);
    await expect(
      page.getByLabel('Workspace', { exact: true }).locator('option:checked'),
    ).toHaveText(name);
    await page.getByRole('link', { name: 'Kanban' }).click();
    await expect(
      page.getByRole('list', { name: 'Workspaces' }).getByRole('link', { name }),
    ).toBeVisible();

    // Settings: rename.
    await page.getByRole('list', { name: 'Workspaces' }).getByRole('link', { name }).click();
    await page.getByRole('link', { name: 'Workspace settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Workspace settings' })).toBeVisible();
    await expectNoBlockingAxeViolations(page);
    await page.getByLabel('Workspace name').fill(renamed);
    await page.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByTestId('live-polite')).toHaveText('Workspace renamed');
    await page.reload();
    await expect(page.getByLabel('Workspace name')).toHaveValue(renamed);

    // Delete needs the exact name.
    await page.getByRole('button', { name: 'Delete workspace' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete workspace' });
    const submit = confirm.getByRole('button', { name: 'Delete this workspace' });
    await confirm.getByLabel(`Type "${renamed}" to confirm`).fill('wrong');
    await expect(submit).toBeDisabled();
    await confirm.getByLabel(`Type "${renamed}" to confirm`).fill(renamed);
    await submit.click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('region', { name: 'No workspaces yet' })).toBeVisible();
  });

  test('create dialog: Enter opens it, Escape closes it and returns focus', async ({ page }) => {
    await signUpViaApi(page);
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Create workspace' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Create workspace' })).toBeVisible();
    await expect(page.getByLabel('Name')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('the switcher moves between workspaces with the keyboard', async ({ page }) => {
    await signUpViaApi(page);
    const first = uniqueName('First');
    const second = uniqueName('Second');
    for (const name of [first, second]) {
      const res = await page.request.post('/api/workspaces', {
        data: { name },
        headers: { origin: 'http://localhost:5173' },
      });
      expect(res.status()).toBe(201);
    }
    await page.goto('/');
    const switcher = page.getByLabel('Workspace', { exact: true });
    await switcher.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(first);
  });

  test('another user sees nothing of my workspaces', async ({ userA, userB }) => {
    await signUpViaApi(userA.page);
    await signUpViaApi(userB.page);
    const name = uniqueName('Private');
    const res = await userA.page.request.post('/api/workspaces', {
      data: { name },
      headers: { origin: 'http://localhost:5173' },
    });
    const { workspace } = (await res.json()) as { workspace: { id: string } };

    await userB.page.goto('/');
    await expect(userB.page.getByRole('region', { name: 'No workspaces yet' })).toBeVisible();
    await userB.page.goto(`/workspaces/${workspace.id}/settings`);
    await expect(userB.page.getByText('Resource not found')).toBeVisible();
    await expectNoBlockingAxeViolations(userB.page);
  });
});
