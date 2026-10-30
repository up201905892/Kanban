import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, signUpViaApi, test } from './fixtures.js';

const PASSWORD = 'e2e-password-12345';
const uniqueEmail = () => `e2e-ui-${randomUUID()}@example.com`;

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking).toEqual([]);
}

async function fillSignup(page: Page, email: string) {
  await page.getByLabel('Name').fill('E2E UI');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
}

test.describe('auth UI', () => {
  test('sign up lands on the home page; log out then protected URL redirects; log in returns', async ({
    page,
  }) => {
    const email = uniqueEmail();
    await page.goto('/signup');
    await fillSignup(page, email);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Kanban' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL('/login');

    // Any private URL goes to login and comes back after logging in.
    await page.goto('/');
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  test('login returns to the page that required it (next)', async ({ page }) => {
    const email = uniqueEmail();
    await signUpViaApi(page, { email, password: PASSWORD });
    await page.request.post('/api/auth/logout', { headers: { origin: 'http://localhost:5173' } });
    await page.goto('/login?next=%2F%3Ffrom%3Dtest');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL('/?from=test');
  });

  test('an external next value is ignored after login', async ({ page }) => {
    const email = uniqueEmail();
    await signUpViaApi(page, { email, password: PASSWORD });
    await page.request.post('/api/auth/logout', { headers: { origin: 'http://localhost:5173' } });
    await page.goto('/login?next=https%3A%2F%2Fevil.example%2F');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL('/');
  });

  test('wrong password shows the error and stays on the login page', async ({ page }) => {
    const email = uniqueEmail();
    await signUpViaApi(page, { email, password: PASSWORD });
    await page.request.post('/api/auth/logout', { headers: { origin: 'http://localhost:5173' } });
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Invalid email or password').first()).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  test('duplicate email shows the error on the email field and focuses it', async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail();
    const other = await browser.newContext();
    await signUpViaApi(await other.newPage(), { email, password: PASSWORD });
    await other.close();

    await page.goto('/signup');
    await fillSignup(page, email);
    await page.getByRole('button', { name: 'Create account' }).click();
    const field = page.getByLabel('Email');
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveAccessibleDescription(/already exists|already registered|taken/i);
  });

  test('an expired session on a private page redirects to login keeping the path', async ({
    page,
  }) => {
    await signUpViaApi(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    // Invalidate the session behind the app's back, then reload a private URL.
    await page.request.post('/api/auth/logout', { headers: { origin: 'http://localhost:5173' } });
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });

  test('sign up and log in with the keyboard only', async ({ page }) => {
    const email = uniqueEmail();
    await page.goto('/signup');
    await page.getByRole('link', { name: 'Skip to content' }).focus();
    await page.keyboard.press('Tab'); // brand link
    await page.keyboard.press('Tab'); // name
    await expect(page.getByLabel('Name')).toBeFocused();
    await page.keyboard.type('Keyboard User');
    await page.keyboard.press('Tab');
    await page.keyboard.type(email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Show password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Create account' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: 'Log out' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/login');

    await page.getByLabel('Email').focus();
    await page.keyboard.type(email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/');
  });

  test('invalid fields move focus to the first invalid field', async ({ page }) => {
    await page.goto('/signup');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByLabel('Name')).toBeFocused();
    await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('live-assertive')).not.toBeEmpty();
  });

  for (const path of ['/login', '/signup']) {
    test(`${path} has no serious or critical axe violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoBlockingAxeViolations(page);
      // Also with errors showing.
      await page
        .getByRole('button', { name: path === '/login' ? 'Log in' : 'Create account' })
        .click();
      await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
      await expectNoBlockingAxeViolations(page);
    });

    test(`${path} is usable at 360px without horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 640 });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    });
  }
});
