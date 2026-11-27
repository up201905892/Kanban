import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { afterWrite, expect, test } from '../fixtures.js';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'e2e-password-12345';
const MOVE_URL = /^\/api\/cards\/[^/]+\/move$/;
const MEMBER_URL = /^\/api\/workspaces\/[^/]+\/members\/[^/]+$/;
/** Spec: another person's change shows up within a few seconds (generous for CI). */
const LIVE = { timeout: 5000 };

interface BoardJson {
  columns: { id: string; name: string; isDone: boolean }[];
  cards: { id: string; columnId: string; number: number; title: string }[];
}

/** Signs up through the form (no API shortcut: this is the start of the journey). */
async function signUpInUi(page: Page, name: string): Promise<void> {
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(`e2e-${randomUUID()}@example.com`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
}

const dialogOf = (page: Page, key: string) => page.getByRole('dialog', { name: `Card ${key}` });
const editorOf = (page: Page) =>
  dialogOf(page, 'JR-1').getByRole('textbox', { name: 'Description' });
const statusOf = (page: Page) => dialogOf(page, 'JR-1').getByTestId('description-status');
const connection = (page: Page) => page.getByTestId('connection-status');
const tilesIn = (page: Page, column: string) =>
  page.getByRole('region', { name: `Column ${column}` }).getByRole('link');
const tile = (page: Page, text: RegExp) => page.getByRole('link', { name: text });
const assigneeOf = (page: Page, text: RegExp) =>
  tile(page, text).getByRole('img', { name: /Assignee/ });

test('two people run a whole project together: move, edit, offline, sprint and demotion', async ({
  userA,
  userB,
}) => {
  const a = userA.page;
  const b = userB.page;
  const workspaceName = `Journey ${randomUUID().slice(0, 8)}`;

  // --- A signs up, creates a workspace and a project, and invites B. ---
  await a.goto('/signup');
  await signUpInUi(a, 'Ana Owner');
  await expect(a.getByRole('heading', { level: 1, name: 'Kanban' })).toBeVisible();
  await a.getByRole('button', { name: 'Create workspace' }).click();
  const wsDialog = a.getByRole('dialog', { name: 'Create workspace' });
  await wsDialog.getByLabel('Name').fill(workspaceName);
  await wsDialog.getByRole('button', { name: 'Create' }).click();
  await expect(a.getByRole('heading', { level: 1, name: workspaceName })).toBeVisible();
  const workspaceId = new URL(a.url()).pathname.split('/')[2] ?? '';
  expect(workspaceId).not.toBe('');

  await a.getByRole('button', { name: 'Create project' }).first().click();
  const projDialog = a.getByRole('dialog', { name: 'Create project' });
  await projDialog.getByLabel('Name').fill('Journey');
  await projDialog.getByLabel('Key').fill('JR');
  await projDialog.getByRole('button', { name: 'Create' }).click();
  await expect(a.getByRole('heading', { level: 1, name: 'Journey' })).toBeVisible();
  await expect(a).toHaveURL(/\/projects\/[^/]+$/);
  const projectId = new URL(a.url()).pathname.split('/')[2] ?? '';

  await a.goto(`/workspaces/${workspaceId}/members`);
  await a.getByRole('button', { name: 'Invite people' }).click();
  const invite = a.getByRole('dialog', { name: 'Invite people' });
  await invite.getByLabel('Role').selectOption('member');
  await invite.getByRole('button', { name: 'Create link' }).click();
  const link = await invite.getByLabel('Invite link', { exact: true }).inputValue();
  expect(link).toContain('/invite/');
  await invite.getByRole('button', { name: 'Done' }).click();

  // --- B signs up through the link and joins. ---
  await b.goto(new URL(link).pathname);
  await b.getByRole('link', { name: 'sign up' }).click();
  await signUpInUi(b, 'Bea Member');
  await b.getByRole('button', { name: 'Accept' }).click();
  await expect(b.getByRole('heading', { level: 1, name: workspaceName })).toBeVisible();
  await expect(b.getByText('Your role: member.')).toBeVisible();

  // Seed the board through the API: two cards assigned to B, one with text in it.
  const me = (await (await b.request.get('/api/auth/me')).json()) as { user: { id: string } };
  const board = (await (
    await a.request.get(`/api/projects/${projectId}/board`)
  ).json()) as BoardJson;
  const todo = board.columns[0];
  if (!todo) throw new Error('default columns missing');
  for (const [title, description] of [
    ['Move me', 'First line\n\nLast line'],
    ['Stay put', ''],
  ] as const) {
    const created = await a.request.post(`/api/columns/${todo.id}/cards`, {
      data: { title, description },
      headers: { origin: ORIGIN },
    });
    expect(created.status()).toBe(201);
    const { card } = (await created.json()) as { card: { id: string } };
    const assigned = await a.request.patch(`/api/cards/${card.id}`, {
      data: { assigneeId: me.user.id },
      headers: { origin: ORIGIN },
    });
    expect(assigned.ok()).toBe(true);
  }

  // --- Both open the board. B opens the card A is about to move. ---
  await Promise.all([a.goto(`/projects/${projectId}`), b.goto(`/projects/${projectId}/cards/1`)]);
  await expect(connection(a)).toHaveText('Connected');
  await expect(connection(b)).toHaveText('Connected');
  await expect(tilesIn(a, 'To do')).toHaveText([/JR-1 Move me/, /JR-2 Stay put/]);
  await expect(dialogOf(b, 'JR-1')).toBeVisible();

  // --- A moves the card with the keyboard while B edits its fields. ---
  await a.getByRole('button', { name: 'Move card JR-1' }).focus();
  await a.keyboard.press('Space');
  await expect(a.getByTestId('live-polite')).toContainText('Picked up');
  await a.keyboard.press('ArrowRight');
  await expect(a.getByTestId('live-polite')).toContainText('moved to In progress');
  await Promise.all([
    afterWrite(a, 'POST', MOVE_URL, () => a.keyboard.press('Space')),
    dialogOf(b, 'JR-1').getByLabel('Priority').selectOption('urgent'),
  ]);
  await expect(tilesIn(a, 'In progress')).toHaveText([/JR-1 Move me/]);
  await expect(tile(a, /JR-1 Move me/).getByText('Urgent')).toBeVisible(LIVE);

  // B's dialog survived the move; closing it shows the card in its new column.
  await expect(dialogOf(b, 'JR-1').getByLabel('Priority')).toHaveValue('urgent');
  await b.keyboard.press('Escape');
  await expect(dialogOf(b, 'JR-1')).toBeHidden();
  await expect(tilesIn(b, 'In progress')).toHaveText([/JR-1 Move me/], LIVE);
  await expect(tilesIn(b, 'To do')).toHaveText([/JR-2 Stay put/]);

  // --- Both edit the same description at the same time. ---
  await Promise.all([
    a.goto(`/projects/${projectId}/cards/1`),
    b.goto(`/projects/${projectId}/cards/1`),
  ]);
  await expect(connection(a)).toHaveText('Connected');
  await expect(connection(b)).toHaveText('Connected');
  await expect(statusOf(a)).toHaveText('Saved');
  await expect(statusOf(b)).toHaveText('Saved');
  await expect(editorOf(a)).toHaveValue('First line\n\nLast line');
  await expect(editorOf(b)).toHaveValue('First line\n\nLast line');
  await editorOf(a).focus();
  await a.keyboard.press('Control+Home');
  await editorOf(b).focus();
  await b.keyboard.press('Control+End');
  await Promise.all([a.keyboard.type('Alpha '), b.keyboard.type(' Omega', { delay: 15 })]);
  const shared = 'Alpha First line\n\nLast line Omega';
  await expect(editorOf(a)).toHaveValue(shared, { timeout: 10_000 });
  await expect(editorOf(b)).toHaveValue(shared, { timeout: 10_000 });
  await expect(statusOf(a)).toHaveText('Saved');
  await expect(statusOf(b)).toHaveText('Saved');

  // --- B goes offline, edits the description and adds a card; A keeps editing. ---
  await b.context().setOffline(true);
  await expect(connection(b)).toHaveText('Offline');
  await editorOf(b).focus();
  await b.keyboard.press('Control+End');
  await b.keyboard.type(' B offline.');
  await expect(editorOf(b)).toHaveValue(`${shared} B offline.`);
  await b.keyboard.press('Escape');
  await expect(dialogOf(b, 'JR-1')).toBeHidden();
  await b.getByRole('button', { name: 'Add card to To do' }).click();
  await b.getByLabel('Card title').fill('Made offline');
  await b.keyboard.press('Enter');
  await expect(b.getByText('Made offline')).toBeVisible();
  await expect(b.getByTestId('pending-changes')).toContainText('pending');

  await editorOf(a).focus();
  await a.keyboard.press('Control+Home');
  await a.keyboard.type('A online. ');
  await expect(statusOf(a)).toHaveText('Saved');

  await b.context().setOffline(false);
  await expect(connection(b)).toHaveText('Connected', { timeout: 15_000 });
  await expect(b.getByTestId('pending-changes')).toHaveCount(0, { timeout: 15_000 });

  const merged = `A online. ${shared} B offline.`;
  await expect(editorOf(a)).toHaveValue(merged, { timeout: 10_000 });
  await b.getByRole('link', { name: /JR-1 Move me/ }).click();
  await expect(editorOf(b)).toHaveValue(merged, { timeout: 10_000 });
  // Exactly one new card, on both screens and on the server.
  await a.keyboard.press('Escape');
  await expect(tile(a, /Made offline/)).toHaveCount(1, { timeout: 10_000 });
  await b.keyboard.press('Escape');
  await expect(tile(b, /Made offline/)).toHaveCount(1);
  const afterOffline = (await (
    await a.request.get(`/api/projects/${projectId}/board`)
  ).json()) as BoardJson;
  expect(afterOffline.cards.filter((c) => c.title === 'Made offline')).toHaveLength(1);
  const jr1 = afterOffline.cards.find((c) => c.number === 1);
  const doneColumn = afterOffline.columns.find((c) => c.isDone);
  if (!doneColumn || !jr1) throw new Error('board data missing');
  await expect
    .poll(
      async () =>
        (
          (await (await a.request.get(`/api/cards/${jr1.id}`)).json()) as {
            card: { description: string };
          }
        ).card.description,
      { timeout: 10_000 },
    )
    .toBe(merged);

  // --- A plans, starts and completes a sprint; B sees it. ---
  await a.goto(`/projects/${projectId}/backlog`);
  await a.getByRole('button', { name: 'Create sprint' }).click();
  const sprintDialog = a.getByRole('dialog', { name: 'Create sprint' });
  await sprintDialog.getByLabel('Name').fill('Sprint One');
  await sprintDialog.getByRole('button', { name: 'Create' }).click();
  // The dialog traps focus while it is closing; wait for it before using the keyboard.
  await expect(sprintDialog).toBeHidden();
  const section = a.getByRole('region', { name: 'Sprint One' });
  await expect(section).toBeVisible();
  for (const n of [1, 2]) {
    await a.getByRole('button', { name: `Add to sprint: JR-${n}` }).focus();
    await a.keyboard.press('Enter');
    await expect(section.getByRole('link', { name: new RegExp(`JR-${n} `) })).toBeVisible(LIVE);
  }
  await a.getByRole('button', { name: 'Start sprint Sprint One' }).click();
  const start = a.getByRole('dialog', { name: 'Start Sprint One?' });
  await start.getByRole('button', { name: 'Start sprint' }).click();
  await expect(start).toBeHidden();
  await expect(
    b.getByRole('region', { name: 'Active sprint' }).getByText('Sprint One'),
  ).toBeVisible(LIVE);

  // JR-1 is finished, JR-2 is not.
  const moved = await a.request.post(`/api/cards/${jr1.id}/move`, {
    data: { columnId: doneColumn.id },
    headers: { origin: ORIGIN },
  });
  expect(moved.ok()).toBe(true);
  await a.getByRole('button', { name: 'Complete sprint Sprint One' }).click();
  const complete = a.getByRole('dialog', { name: 'Complete Sprint One?' });
  await expect(complete.getByText(/1 done/)).toBeVisible();
  await complete.getByRole('button', { name: 'Complete sprint' }).click();
  const summary = a.getByRole('dialog', { name: 'Sprint One completed' });
  await expect(summary.getByText(/1 returned to the backlog/)).toBeVisible();
  await summary.getByRole('button', { name: 'Close' }).click();
  await expect(summary).toBeHidden();
  await expect(b.getByRole('region', { name: 'Active sprint' })).toHaveCount(0, LIVE);

  // --- A demotes B to viewer; B's cards lose their assignee on both screens. ---
  await b.goto(`/projects/${projectId}`);
  await expect(connection(b)).toHaveText('Connected');
  await expect(assigneeOf(b, /JR-1 Move me/)).toBeVisible();
  await expect(assigneeOf(b, /JR-2 Stay put/)).toBeVisible();

  await a.goto(`/workspaces/${workspaceId}/members`);
  const select = a.getByRole('combobox', { name: 'Role for Bea Member' });
  await select.focus();
  await select.selectOption('viewer');
  const demote = a.getByRole('dialog', { name: 'Change to viewer' });
  await expect(demote).toContainText('their cards in this workspace will be unassigned');
  await afterWrite(a, 'PATCH', MEMBER_URL, () =>
    demote.getByRole('button', { name: 'Change to viewer' }).click(),
  );
  await expect(select).toHaveValue('viewer');

  await expect(assigneeOf(b, /JR-1 Move me/)).toHaveCount(0, LIVE);
  await expect(assigneeOf(b, /JR-2 Stay put/)).toHaveCount(0, LIVE);
  await a.goto(`/projects/${projectId}`);
  await expect(tile(a, /JR-1 Move me/)).toBeVisible();
  await expect(assigneeOf(a, /JR-1 Move me/)).toHaveCount(0);
  await expect(assigneeOf(a, /JR-2 Stay put/)).toHaveCount(0);

  // B is read-only in the UI and refused by the API.
  await b.goto(`/projects/${projectId}/cards/1`);
  await expect(editorOf(b)).toHaveAttribute('aria-readonly', 'true');
  await expect(dialogOf(b, 'JR-1').getByRole('button', { name: 'Edit title' })).toHaveCount(0);
  await b.keyboard.press('Escape');
  await expect(b.getByRole('button', { name: /Add card/ })).toHaveCount(0);
  const refused = await b.request.patch(`/api/cards/${jr1.id}`, {
    data: { title: 'Hijacked' },
    headers: { origin: ORIGIN },
  });
  expect(refused.status()).toBe(403);
});
