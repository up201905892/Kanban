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
    data: { name: 'Cards Test', key: 'CT' },
    headers: { origin: ORIGIN },
  });
  expect(project.status()).toBe(201);
  return ((await project.json()) as { project: { id: string } }).project.id;
}

const tilesIn = (page: Page, column: string) =>
  page.getByRole('region', { name: `Column ${column}` }).getByRole('link');

test.describe('cards', () => {
  test('create with the keyboard only, open by deep link, edit, delete; state survives a reload', async ({
    page,
  }) => {
    await signUpViaApi(page);
    const projectId = await createProjectViaApi(page);
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByRole('heading', { level: 2, name: 'To do' })).toBeVisible();
    await expectNoBlockingAxeViolations(page);

    // Keyboard only: focus the button, open the form, create three cards in a row.
    await page.getByRole('button', { name: 'Add card to To do' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Card title')).toBeFocused();
    for (const title of ['Write spec', 'Build it', 'Ship it']) {
      await page.keyboard.type(title);
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Card title')).toBeFocused();
      await expect(page.getByLabel('Card title')).toHaveValue('');
    }
    await expect(tilesIn(page, 'To do')).toHaveText([
      'CT-1 Write spec',
      'CT-2 Build it',
      'CT-3 Ship it',
    ]);
    await expect(page.getByTestId('live-polite')).toHaveText('Card CT-3 created in To do');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Add card to To do' })).toBeFocused();

    // Reload: the cards are persisted in the same order.
    await page.reload();
    await expect(tilesIn(page, 'To do')).toHaveText([
      'CT-1 Write spec',
      'CT-2 Build it',
      'CT-3 Ship it',
    ]);

    // Deep link opens the dialog on top of the board.
    await page.goto(`/projects/${projectId}/cards/2`);
    const dialog = page.getByRole('dialog', { name: 'Card CT-2' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 3, name: 'Build it' })).toBeVisible();
    await expectNoBlockingAxeViolations(page);

    // Edit the title inline (Enter saves).
    await dialog.getByRole('button', { name: 'Edit title' }).click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Build it well');
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('heading', { level: 3, name: 'Build it well' })).toBeVisible();
    await expect(page.getByTestId('live-polite')).toHaveText('Card title saved');

    // Edit the description live (no Save button) with preview; raw HTML stays inert.
    const editor = dialog.getByRole('textbox', { name: 'Description' });
    await expect(dialog.getByTestId('description-status')).toHaveText('Saved');
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await editor.click();
    await page.keyboard.type('# Steps\n\n- one\n- two <script>window.__pwned = 1</script>');
    await expect(dialog.getByTestId('description-status')).toHaveText('Saved');
    await dialog.getByRole('button', { name: 'Preview' }).click();
    await expect(
      dialog.getByRole('group', { name: 'Description preview' }).getByRole('listitem'),
    ).toHaveCount(2);
    await expect(dialog.getByRole('heading', { level: 1, name: 'Steps' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
      undefined,
    );

    // Escape closes the dialog and returns focus to the tile.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(`/projects/${projectId}`);
    await expect(page.getByRole('link', { name: 'CT-2 Build it well' })).toBeFocused();

    // Persisted after a reload.
    await page.reload();
    await page.getByRole('link', { name: 'CT-2 Build it well' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Card CT-2' }).getByRole('textbox', { name: 'Description' }),
    ).toHaveValue(/^# Steps/);
    await expect(page).toHaveURL(`/projects/${projectId}/cards/2`);

    // Delete with confirmation.
    await page.getByRole('button', { name: 'Delete card' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete card CT-2?' });
    await expectNoBlockingAxeViolations(page);
    await confirm.getByRole('button', { name: 'Delete card' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(tilesIn(page, 'To do')).toHaveText(['CT-1 Write spec', 'CT-3 Ship it']);
    await expect(page.getByTestId('live-polite')).toHaveText('Card CT-2 deleted');
    await page.reload();
    await expect(tilesIn(page, 'To do')).toHaveText(['CT-1 Write spec', 'CT-3 Ship it']);

    // The deleted card's address no longer opens a card.
    await page.goto(`/projects/${projectId}/cards/2`);
    await expect(
      page.getByRole('dialog', { name: 'Card CT-2' }).getByText(/does not exist or was deleted/),
    ).toBeVisible();
  });

  test('deleting a column with cards asks where they go and keeps them', async ({ page }) => {
    await signUpViaApi(page);
    const projectId = await createProjectViaApi(page);
    await page.goto(`/projects/${projectId}`);
    await page.getByRole('button', { name: 'Add card to In progress' }).click();
    await page.keyboard.type('Moving card');
    await page.keyboard.press('Enter');
    await expect(tilesIn(page, 'In progress')).toHaveText(['CT-1 Moving card']);

    await page.getByRole('button', { name: 'Actions for column In progress' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete column In progress?' });
    await expect(dialog.getByText(/This column has 1 card/)).toBeVisible();
    await dialog.getByLabel('Move cards to').selectOption({ label: 'Done' });
    await dialog.getByRole('button', { name: 'Delete column' }).click();
    await expect(tilesIn(page, 'Done')).toHaveText(['CT-1 Moving card']);
    await expect(page.getByTestId('live-polite')).toHaveText(
      'Column In progress deleted; 1 card moved to Done',
    );
    await page.reload();
    await expect(tilesIn(page, 'Done')).toHaveText(['CT-1 Moving card']);
  });

  test('a viewer reads cards but cannot add or edit them', async ({ userA, userB }) => {
    await signUpViaApi(userA.page);
    const projectId = await createProjectViaApi(userA.page);
    const column = (
      (await (await userA.page.request.get(`/api/projects/${projectId}/board`)).json()) as {
        columns: { id: string }[];
      }
    ).columns[0];
    const created = await userA.page.request.post(`/api/columns/${column?.id}/cards`, {
      data: { title: 'Readable', description: 'Some *text*' },
      headers: { origin: ORIGIN },
    });
    expect(created.status()).toBe(201);

    // B joins as a viewer through an invite link.
    const workspaces = (await (await userA.page.request.get('/api/workspaces')).json()) as {
      workspaces: { id: string }[];
    };
    const wid = workspaces.workspaces[0]?.id;
    const invite = await userA.page.request.post(`/api/workspaces/${wid}/invites`, {
      data: { role: 'viewer', expiresInDays: 1 },
      headers: { origin: ORIGIN },
    });
    const { link } = (await invite.json()) as { link: string };
    await signUpViaApi(userB.page);
    const token = link.split('/').pop();
    const accepted = await userB.page.request.post(`/api/invites/${token}/accept`, {
      headers: { origin: ORIGIN },
    });
    expect(accepted.status()).toBe(200);

    await userB.page.goto(`/projects/${projectId}/cards/1`);
    const dialog = userB.page.getByRole('dialog', { name: 'Card CT-1' });
    await expect(dialog.getByRole('heading', { level: 3, name: 'Readable' })).toBeVisible();
    const readOnly = dialog.getByRole('textbox', { name: 'Description' });
    await expect(readOnly).toHaveValue('Some *text*');
    await expect(readOnly).toHaveAttribute('aria-readonly', 'true');
    await expect(dialog.getByRole('button', { name: 'Edit title' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Delete card' })).toHaveCount(0);
    await expectNoBlockingAxeViolations(userB.page);
    await userB.page.keyboard.press('Escape');
    await expect(userB.page.getByRole('button', { name: /Add card/ })).toHaveCount(0);
  });
});
