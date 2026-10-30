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

const uniqueName = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`;

async function createWorkspaceViaApi(page: Page): Promise<string> {
  const res = await page.request.post('/api/workspaces', {
    data: { name: uniqueName('Acme') },
    headers: { origin: ORIGIN },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { workspace: { id: string } }).workspace.id;
}

test.describe('projects', () => {
  test('create, open, rename and delete a project', async ({ page }) => {
    await signUpViaApi(page);
    const workspaceId = await createWorkspaceViaApi(page);
    const name = `Kanban Board ${randomUUID()
      .slice(0, 4)
      .replace(/[^a-z]/g, 'x')}`;
    const renamed = uniqueName('Renamed');

    await page.goto(`/workspaces/${workspaceId}`);
    await expect(page.getByRole('region', { name: 'No projects yet' })).toBeVisible();
    await expectNoBlockingAxeViolations(page);

    await page.getByRole('button', { name: 'Create project' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create project' });
    await dialog.getByLabel('Name').fill(name);
    await expect(dialog.getByLabel('Key')).toHaveValue(/^KB[A-Z]*$/);
    await dialog.getByLabel('Key').fill('KB');
    await dialog.getByRole('button', { name: 'Create' }).click();

    // Board placeholder.
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Key: KB')).toBeVisible();

    // The list is a list of links.
    await page.getByRole('link', { name: 'Back to the workspace' }).click();
    const list = page.getByRole('list', { name: 'Projects' });
    await expect(list.getByRole('link', { name })).toBeVisible();
    await expectNoBlockingAxeViolations(page);

    // A duplicate key is reported on the key field.
    await page.getByRole('button', { name: 'Create project' }).click();
    const again = page.getByRole('dialog', { name: 'Create project' });
    await again.getByLabel('Name').fill('Second');
    await again.getByLabel('Key').fill('KB');
    await again.getByRole('button', { name: 'Create' }).click();
    await expect(again.getByText('This key is already used in the workspace')).toBeVisible();
    await expect(again.getByLabel('Key')).toBeFocused();
    await page.keyboard.press('Escape');

    // Rename in settings.
    await list.getByRole('link', { name }).click();
    await page.getByRole('link', { name: 'Project settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Project settings' })).toBeVisible();
    await expectNoBlockingAxeViolations(page);
    await page.getByLabel('Project name').fill(renamed);
    await page.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByTestId('live-polite')).toHaveText('Project renamed');
    await page.reload();
    await expect(page.getByLabel('Project name')).toHaveValue(renamed);

    // Delete needs the exact name.
    await page.getByRole('button', { name: 'Delete project' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete project' });
    const submit = confirm.getByRole('button', { name: 'Delete this project' });
    await confirm.getByLabel(/to confirm/).fill('wrong');
    await expect(submit).toBeDisabled();
    await confirm.getByLabel(/to confirm/).fill(renamed);
    await submit.click();
    await expect(page).toHaveURL(`/workspaces/${workspaceId}`);
    await expect(page.getByRole('region', { name: 'No projects yet' })).toBeVisible();
  });

  test('the create dialog works with the keyboard alone', async ({ page }) => {
    await signUpViaApi(page);
    const workspaceId = await createWorkspaceViaApi(page);
    await page.goto(`/workspaces/${workspaceId}`);
    const button = page.getByRole('button', { name: 'Create project' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Create project' })).toBeVisible();
    await expect(page.getByLabel('Name')).toBeFocused();
    await page.keyboard.type('Web Shop');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Key')).toHaveValue('WS');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Web Shop' })).toBeVisible();

    // Escape closes the dialog and returns focus to the trigger.
    await page.goBack();
    await page.getByRole('button', { name: 'Create project' }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Create project' })).toBeFocused();
  });

  test("another user cannot see or open someone else's project", async ({ userA, userB }) => {
    await signUpViaApi(userA.page);
    await signUpViaApi(userB.page);
    const workspaceId = await createWorkspaceViaApi(userA.page);
    const res = await userA.page.request.post(`/api/workspaces/${workspaceId}/projects`, {
      data: { name: 'Secret', key: 'SEC' },
      headers: { origin: ORIGIN },
    });
    expect(res.status()).toBe(201);
    const { project } = (await res.json()) as { project: { id: string } };

    await userB.page.goto(`/projects/${project.id}`);
    await expect(userB.page.getByText('Resource not found')).toBeVisible();
    await expectNoBlockingAxeViolations(userB.page);
  });
});
