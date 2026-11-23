import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures.js';

test('the web app loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

/**
 * Deployment smoke test (KB-031): uses only the UI, so it runs against a deployed instance with
 * `BASE_URL=https://... pnpm test:e2e --grep @smoke`. It covers the static files, the SPA
 * fallback on a deep link, the api on the same origin and the session cookie.
 */
test('sign up, create a workspace and reload on its URL @smoke', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Smoke Test');
  await page.getByLabel('Email').fill(`smoke-${randomUUID()}@example.com`);
  await page.getByLabel('Password').fill('smoke-password-12345');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/');

  const name = `Smoke ${randomUUID().slice(0, 8)}`;
  await page.getByRole('button', { name: 'Create workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create workspace' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  // A deep link served by the SPA fallback, with the session cookie still valid.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
});
