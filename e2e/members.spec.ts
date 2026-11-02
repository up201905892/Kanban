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

async function createWorkspaceViaApi(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/workspaces', {
    data: { name },
    headers: { origin: ORIGIN },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { workspace: { id: string } }).workspace.id;
}

test.describe('invites and members', () => {
  test('A invites B as viewer through a link, promotes B, and B can then create a project', async ({
    userA,
    userB,
  }) => {
    const a = userA.page;
    const b = userB.page;
    const workspaceName = `Team ${randomUUID().slice(0, 8)}`;
    await signUpViaApi(a, { name: 'Alice Owner' });
    const workspaceId = await createWorkspaceViaApi(a, workspaceName);

    // A creates a viewer invite on the members page.
    await a.goto(`/workspaces/${workspaceId}/members`);
    await expect(a.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await expect(a.getByRole('combobox', { name: 'Role for Alice Owner' })).toBeVisible();
    await a.getByRole('button', { name: 'Invite people' }).click();
    const dialog = a.getByRole('dialog', { name: 'Invite people' });
    await dialog.getByLabel('Role').selectOption('viewer');
    await dialog.getByRole('button', { name: 'Create link' }).click();
    const link = await dialog.getByLabel('Invite link', { exact: true }).inputValue();
    expect(link).toContain('/invite/');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(
      a.getByRole('list', { name: 'Active invites' }).getByText(/^viewer, expires/),
    ).toBeVisible();

    // B is logged out: sees the offer, signs up through the link and comes back.
    await b.goto(new URL(link).pathname);
    await expect(
      b.getByRole('heading', { level: 1, name: `You are invited to ${workspaceName}` }),
    ).toBeVisible();
    await expectNoBlockingAxeViolations(b);
    await b.getByRole('link', { name: 'sign up' }).click();
    await b.getByLabel('Name').fill('Bob Viewer');
    await b.getByLabel('Email').fill(`e2e-${randomUUID()}@example.com`);
    await b.getByLabel('Password').fill('e2e-password-12345');
    await b.getByRole('button', { name: 'Create account' }).click();
    await expect(b.getByRole('button', { name: 'Accept' })).toBeVisible();
    await b.getByRole('button', { name: 'Accept' }).click();

    // B sees the workspace read-only.
    await expect(b.getByRole('heading', { level: 1, name: workspaceName })).toBeVisible();
    await expect(b.getByText('Your role: viewer.')).toBeVisible();
    await expect(b.getByRole('button', { name: 'Create project' })).toHaveCount(0);

    // A promotes B to member (role select is reachable and labelled with the name).
    await a.reload();
    const select = a.getByRole('combobox', { name: 'Role for Bob Viewer' });
    await select.selectOption('member');
    await expect(select).toHaveValue('member');
    await expectNoBlockingAxeViolations(a);

    // After a reload B can create a project.
    await b.reload();
    await expect(b.getByText('Your role: member.')).toBeVisible();
    await b.getByRole('button', { name: 'Create project' }).first().click();
    const create = b.getByRole('dialog', { name: 'Create project' });
    await create.getByLabel('Name').fill('Made by Bob');
    await create.getByLabel('Key').fill('MBB');
    await create.getByRole('button', { name: 'Create' }).click();
    await expect(b.getByRole('heading', { level: 1, name: 'Made by Bob' })).toBeVisible();

    // A removes B (with confirmation); B loses access at once but the project stays.
    await a.getByRole('button', { name: 'Remove Bob Viewer' }).click();
    const confirm = a.getByRole('dialog', { name: 'Remove member' });
    await confirm.getByRole('button', { name: 'Remove' }).click();
    await expect(a.getByRole('combobox', { name: 'Role for Bob Viewer' })).toHaveCount(0);
    await b.goto(`/workspaces/${workspaceId}`);
    await expect(b.getByText(/not found|unavailable/i).first()).toBeVisible();
    await a.goto(`/workspaces/${workspaceId}`);
    await expect(a.getByRole('link', { name: 'Made by Bob' })).toBeVisible();
  });

  test('the last owner cannot step down and a revoked link stops working', async ({
    userA,
    userB,
  }) => {
    const a = userA.page;
    await signUpViaApi(a, { name: 'Solo Owner' });
    const workspaceId = await createWorkspaceViaApi(a, `Solo ${randomUUID().slice(0, 8)}`);

    await a.goto(`/workspaces/${workspaceId}/members`);
    await a.getByRole('combobox', { name: 'Role for Solo Owner' }).selectOption('viewer');
    await expect(a.getByText(/at least one owner/)).toBeVisible();
    await expect(a.getByRole('combobox', { name: 'Role for Solo Owner' })).toHaveValue('owner');

    // Keyboard only: open the invite dialog, create, copy.
    await a.getByRole('button', { name: 'Invite people' }).focus();
    await a.keyboard.press('Enter');
    const dialog = a.getByRole('dialog', { name: 'Invite people' });
    await dialog.getByRole('button', { name: 'Create link' }).focus();
    await a.keyboard.press('Enter');
    const link = await dialog.getByLabel('Invite link', { exact: true }).inputValue();
    await a
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'])
      .catch(() => {});
    await dialog.getByRole('button', { name: 'Copy link' }).focus();
    await a.keyboard.press('Enter');
    await expect(a.getByTestId('live-polite')).toHaveText(/Link copied|Could not copy/);
    await a.keyboard.press('Escape');

    // Revoke it; a visitor now sees one generic message.
    await a.getByRole('button', { name: /^Revoke viewer|^Revoke member/ }).click();
    await expect(a.getByText('No active invite links.')).toBeVisible();
    await userB.page.goto(new URL(link).pathname);
    await expect(userB.page.getByRole('heading', { name: 'Invite not valid' })).toBeVisible();
    await expectNoBlockingAxeViolations(userB.page);
  });
});
