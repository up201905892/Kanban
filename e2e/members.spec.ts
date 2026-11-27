import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { afterWrite, expect, signUpViaApi, test } from './fixtures.js';

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
    await afterWrite(a, 'PATCH', /^\/api\/workspaces\/[^/]+\/members\/[^/]+$/, () =>
      select.selectOption('member'),
    );
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
    await afterWrite(a, 'DELETE', /^\/api\/workspaces\/[^/]+\/members\/[^/]+$/, () =>
      confirm.getByRole('button', { name: 'Remove' }).click(),
    );
    await expect(a.getByRole('combobox', { name: 'Role for Bob Viewer' })).toHaveCount(0);
    await b.goto(`/workspaces/${workspaceId}`);
    await expect(b.getByText(/not found|unavailable/i).first()).toBeVisible();
    await a.goto(`/workspaces/${workspaceId}`);
    await expect(a.getByRole('link', { name: 'Made by Bob' })).toBeVisible();
  });

  test('demoting a member to viewer asks first and unassigns their cards', async ({
    userA,
    userB,
  }) => {
    const a = userA.page;
    const b = userB.page;
    await signUpViaApi(a, { name: 'Olive Owner' });
    await signUpViaApi(b, { name: 'Mark Member' });
    const workspaceId = await createWorkspaceViaApi(a, `Demote ${randomUUID().slice(0, 8)}`);

    const invite = await a.request.post(`/api/workspaces/${workspaceId}/invites`, {
      data: { role: 'member', expiresInDays: 7 },
      headers: { origin: ORIGIN },
    });
    expect(invite.status()).toBe(201);
    const token = ((await invite.json()) as { link: string }).link.split('/invite/')[1];
    const accepted = await b.request.post(`/api/invites/${token}/accept`, {
      headers: { origin: ORIGIN },
    });
    expect(accepted.ok()).toBe(true);
    const me = (await (await b.request.get('/api/auth/me')).json()) as { user: { id: string } };

    const project = await a.request.post(`/api/workspaces/${workspaceId}/projects`, {
      data: { name: 'Demotion', key: 'DM' },
      headers: { origin: ORIGIN },
    });
    const projectId = ((await project.json()) as { project: { id: string } }).project.id;
    const board = await a.request.get(`/api/projects/${projectId}/board`);
    const { columns } = (await board.json()) as { columns: { id: string }[] };
    const created = await a.request.post(`/api/columns/${columns[0]?.id}/cards`, {
      data: { title: 'Assigned to Mark' },
      headers: { origin: ORIGIN },
    });
    const cardId = ((await created.json()) as { card: { id: string } }).card.id;
    const assigned = await a.request.patch(`/api/cards/${cardId}`, {
      data: { assigneeId: me.user.id },
      headers: { origin: ORIGIN },
    });
    expect(assigned.ok()).toBe(true);

    await a.goto(`/workspaces/${workspaceId}/members`);
    const select = a.getByRole('combobox', { name: 'Role for Mark Member' });
    // selectOption does not focus the select, a person using it would have.
    await select.focus();
    await select.selectOption('viewer');
    const dialog = a.getByRole('dialog', { name: 'Change to viewer' });
    await expect(dialog).toContainText(
      'Mark Member will become a viewer and their cards in this workspace will be unassigned.',
    );
    await expectNoBlockingAxeViolations(a);

    // Escape cancels: the role stays and focus returns to the select.
    await a.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(select).toHaveValue('member');
    await expect(select).toBeFocused();

    await select.selectOption('viewer');
    await afterWrite(a, 'PATCH', /^\/api\/workspaces\/[^/]+\/members\/[^/]+$/, () =>
      dialog.getByRole('button', { name: 'Change to viewer' }).click(),
    );
    await expect(select).toHaveValue('viewer');
    await expect(a.getByTestId('live-polite')).toHaveText(/cards were unassigned/);

    await a.goto(`/projects/${projectId}`);
    const tile = a.getByRole('link', { name: /DM-1 Assigned to Mark/ });
    await expect(tile).toBeVisible();
    await expect(tile.getByRole('img', { name: /Assignee/ })).toHaveCount(0);
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
    await a
      .getByRole('dialog', { name: 'Change to viewer' })
      .getByRole('button', { name: 'Change to viewer' })
      .click();
    // Scoped to the members region: the same text is announced (after 50 ms) in the
    // assertive live region, which is asserted separately.
    await expect(
      a
        .getByRole('region', { name: 'People' })
        .getByRole('alert')
        .filter({ hasText: /at least one owner/ }),
    ).toBeVisible();
    await expect(a.getByTestId('live-assertive')).toHaveText(/at least one owner/);
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
    // The revoke is optimistic: wait for the server to confirm before B opens the link.
    await afterWrite(a, 'DELETE', /^\/api\/invites\/[^/]+$/, () =>
      a.getByRole('button', { name: /^Revoke viewer|^Revoke member/ }).click(),
    );
    await expect(a.getByText('No active invite links.')).toBeVisible();
    await userB.page.goto(new URL(link).pathname);
    await expect(userB.page.getByRole('heading', { name: 'Invite not valid' })).toBeVisible();
    await expectNoBlockingAxeViolations(userB.page);
  });
});
