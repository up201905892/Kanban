import { randomUUID } from 'node:crypto';
import { test as base, type Page } from '@playwright/test';

/** Must match `WEB_ORIGIN` of the api (default web dev server). */
const WEB_ORIGIN = 'http://localhost:5173';

export interface User {
  page: Page;
}

interface Fixtures {
  /** First user: own browser context, therefore own cookies and storage. */
  userA: User;
  /** Second user: a context fully independent from `userA`. */
  userB: User;
}

export interface LoggedInUser {
  email: string;
  name: string;
  password: string;
}

/**
 * Creates a fresh account through the API and leaves the session cookie in the page's
 * browser context (the page's request context shares the context's cookie jar). No UI is used.
 */
export async function signUpViaApi(
  page: Page,
  overrides: Partial<LoggedInUser> = {},
): Promise<LoggedInUser> {
  const user: LoggedInUser = {
    email: overrides.email ?? `e2e-${randomUUID()}@example.com`,
    name: overrides.name ?? 'E2E User',
    password: overrides.password ?? 'e2e-password-12345',
  };
  const res = await page.request.post('/api/auth/signup', {
    data: user,
    // The API only accepts state-changing requests from the web origin.
    headers: { origin: WEB_ORIGIN },
  });
  if (res.status() !== 201) throw new Error(`E2E signup failed with status ${res.status()}`);
  return user;
}

/** Logs an existing account in through the API and stores the session cookie. */
export async function logInViaApi(page: Page, user: LoggedInUser): Promise<void> {
  const res = await page.request.post('/api/auth/login', {
    data: { email: user.email, password: user.password },
    headers: { origin: WEB_ORIGIN },
  });
  if (res.status() !== 200) throw new Error(`E2E login failed with status ${res.status()}`);
}

export const test = base.extend<Fixtures>({
  userA: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({ baseURL: baseURL ?? '' });
    await use({ page: await context.newPage() });
    await context.close();
  },
  userB: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({ baseURL: baseURL ?? '' });
    await use({ page: await context.newPage() });
    await context.close();
  },
});

export { expect } from '@playwright/test';
