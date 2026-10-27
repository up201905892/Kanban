import { test as base, type Page } from '@playwright/test';

export interface User {
  page: Page;
}

interface Fixtures {
  /** First user: own browser context, therefore own cookies and storage. */
  userA: User;
  /** Second user: a context fully independent from `userA`. */
  userB: User;
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
