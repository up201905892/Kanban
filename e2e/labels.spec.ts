import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, signUpViaApi, test } from './fixtures.js';

const ORIGIN = 'http://localhost:5173';
/** Spec: another person's change shows up within 2 seconds. */
const LIVE = { timeout: 2000 };

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking).toEqual([]);
}

const post = (page: Page, url: string, data: object) =>
  page.request.post(url, { data, headers: { origin: ORIGIN } });

/** A workspace, project and one card owned by `page`'s user. */
async function createProjectWithCard(page: Page) {
  const ws = (await (
    await post(page, '/api/workspaces', { name: `Labels ${randomUUID().slice(0, 8)}` })
  ).json()) as { workspace: { id: string } };
  const project = (await (
    await post(page, `/api/workspaces/${ws.workspace.id}/projects`, { name: 'Labels', key: 'LB' })
  ).json()) as { project: { id: string } };
  const board = (await (
    await page.request.get(`/api/projects/${project.project.id}/board`)
  ).json()) as { columns: { id: string }[] };
  const card = await post(page, `/api/columns/${board.columns[0]?.id}/cards`, {
    title: 'Label me',
  });
  expect(card.status()).toBe(201);
  return { workspaceId: ws.workspace.id, projectId: project.project.id };
}

async function invite(owner: Page, guest: Page, workspaceId: string, role: 'member' | 'viewer') {
  const created = await post(owner, `/api/workspaces/${workspaceId}/invites`, {
    role,
    expiresInDays: 7,
  });
  const { link } = (await created.json()) as { link: string };
  const token = link.split('/invite/')[1];
  expect((await post(guest, `/api/invites/${token}/accept`, {})).status()).toBe(200);
}

test.describe('labels', () => {
  test('A creates a label in settings and assigns it with the keyboard; B sees it on the tile live', async ({
    userA,
    userB,
  }) => {
    const a = userA.page;
    const b = userB.page;
    await signUpViaApi(a, { name: 'Ana Owner' });
    await signUpViaApi(b, { name: 'Bea Member' });
    const { workspaceId, projectId } = await createProjectWithCard(a);
    await invite(a, b, workspaceId, 'member');

    await b.goto(`/projects/${projectId}`);
    const tile = b.getByRole('link', { name: /LB-1 Label me/ });
    await expect(tile).toBeVisible();

    // A creates the label in the project settings.
    await a.goto(`/projects/${projectId}/settings`);
    await expect(a.getByRole('heading', { level: 1, name: 'Project settings' })).toBeVisible();
    await expect(a.getByRole('region', { name: 'No labels yet' })).toBeVisible();
    await a.getByLabel('New label name').fill('Bug');
    await a.getByLabel('Color', { exact: true }).first().selectOption('red');
    await a.getByRole('button', { name: 'Create label' }).click();
    await expect(a.getByTestId('live-polite')).toHaveText('Label Bug created');
    await expect(a.getByRole('form', { name: 'Edit label Bug' })).toBeVisible();

    // A duplicate (any case) is refused with the server message.
    await a.getByLabel('New label name').fill('bug');
    await a.getByRole('button', { name: 'Create label' }).click();
    await expect(a.getByText('A label with this name already exists')).toBeVisible();

    await expectNoBlockingAxeViolations(a);

    // A opens the card and toggles the label with Space.
    await a.goto(`/projects/${projectId}/cards/1`);
    const dialog = a.getByRole('dialog', { name: 'Card LB-1' });
    const bug = dialog.getByRole('checkbox', { name: 'Bug' });
    await expect(bug).toBeVisible();
    await bug.focus();
    await a.keyboard.press('Space');
    await expect(bug).toBeChecked();
    await expect(a.getByTestId('live-polite')).toHaveText('Label Bug added');
    await expectNoBlockingAxeViolations(a);

    // B sees the label on the tile without reloading.
    await expect(tile.getByRole('list', { name: 'Labels' }).getByText('Bug')).toBeVisible(LIVE);

    // Removing it shows up for B as well.
    await bug.focus();
    await a.keyboard.press('Space');
    await expect(bug).not.toBeChecked();
    await expect(tile.getByText('Bug')).toBeHidden(LIVE);

    // Deleting the label removes it from the picker for B's board too.
    await a.keyboard.press('Space');
    await expect(bug).toBeChecked();
    await expect(tile.getByText('Bug')).toBeVisible(LIVE);
    const deleted = await a.request.get(`/api/projects/${projectId}/labels`);
    const [label] = ((await deleted.json()) as { labels: { id: string }[] }).labels;
    const res = await a.request.delete(`/api/labels/${label?.id}`, {
      headers: { origin: ORIGIN },
    });
    expect(res.status()).toBe(204);
    await expect(tile.getByText('Bug')).toBeHidden(LIVE);
  });

  test('a viewer sees the labels but cannot change them', async ({ userA, userB }) => {
    const a = userA.page;
    const b = userB.page;
    await signUpViaApi(a, { name: 'Ana Owner' });
    await signUpViaApi(b, { name: 'Vic Viewer' });
    const { workspaceId, projectId } = await createProjectWithCard(a);
    await invite(a, b, workspaceId, 'viewer');
    const label = (await (
      await post(a, `/api/projects/${projectId}/labels`, { name: 'Docs', color: 'teal' })
    ).json()) as { label: { id: string } };
    const cardId = (
      (await (await a.request.get(`/api/projects/${projectId}/board`)).json()) as {
        cards: { id: string }[];
      }
    ).cards[0]?.id;
    const put = await a.request.put(`/api/cards/${cardId}/labels`, {
      data: { labelIds: [label.label.id] },
      headers: { origin: ORIGIN },
    });
    expect(put.status()).toBe(200);

    await b.goto(`/projects/${projectId}/cards/1`);
    const dialog = b.getByRole('dialog', { name: 'Card LB-1' });
    await expect(dialog.getByText('Docs', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await expectNoBlockingAxeViolations(b);

    await b.goto(`/projects/${projectId}/settings`);
    await expect(b.getByText('Docs')).toBeVisible();
    await expect(b.getByRole('button', { name: 'Create label' })).toHaveCount(0);
  });
});
