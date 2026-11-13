import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, signUpViaApi, test } from './fixtures.js';

const ORIGIN = 'http://localhost:5173';

const post = (page: Page, url: string, data: object) =>
  page.request.post(url, { data, headers: { origin: ORIGIN } });

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking).toEqual([]);
}

/** A project with one card, and `guest` joined as a member. */
async function setup(owner: Page, guest: Page) {
  const ws = (await (
    await post(owner, '/api/workspaces', { name: `Presence ${randomUUID().slice(0, 8)}` })
  ).json()) as { workspace: { id: string } };
  const project = (await (
    await post(owner, `/api/workspaces/${ws.workspace.id}/projects`, {
      name: 'Presence',
      key: 'PR',
    })
  ).json()) as { project: { id: string } };
  const board = (await (
    await owner.request.get(`/api/projects/${project.project.id}/board`)
  ).json()) as { columns: { id: string }[] };
  await post(owner, `/api/columns/${board.columns[0]?.id}/cards`, {
    title: 'Shared card',
    description: 'Some words to put a caret in',
  });
  const invite = (await (
    await post(owner, `/api/workspaces/${ws.workspace.id}/invites`, {
      role: 'member',
      expiresInDays: 1,
    })
  ).json()) as { link: string };
  const accepted = await post(guest, `/api/invites/${invite.link.split('/invite/')[1]}/accept`, {});
  expect(accepted.status()).toBe(200);
  return { projectId: project.project.id };
}

const peopleOf = (page: Page) => page.getByRole('list', { name: /(person|people) on this board/ });

test('presence: avatars, "is editing" on the tile, remote caret and removal on leave', async ({
  userA,
  userB,
}) => {
  const a = userA.page;
  const b = userB.page;
  await signUpViaApi(a, { name: 'Ana Owner' });
  await signUpViaApi(b, { name: 'Bea Member' });
  const { projectId } = await setup(a, b);

  // B opens the board first and is alone.
  await b.goto(`/projects/${projectId}`);
  await expect(peopleOf(b)).toHaveAttribute(
    'aria-label',
    '1 person on this board: Bea Member (you)',
  );

  // A opens the board: B sees A's avatar, and the list names both.
  await a.goto(`/projects/${projectId}`);
  await expect(peopleOf(b)).toHaveAttribute(
    'aria-label',
    '2 people on this board: Ana Owner, Bea Member (you)',
  );
  await expect(peopleOf(b).getByRole('listitem').first()).toContainText('AO');
  await expectNoBlockingAxeViolations(b);

  // A opens the card and types: B sees "Ana Owner is editing" on the tile.
  await a.getByRole('link', { name: /PR-1 Shared card/ }).click();
  const editorA = a
    .getByRole('dialog', { name: 'Card PR-1' })
    .getByRole('textbox', { name: 'Description' });
  await expect(a.getByTestId('description-status')).toHaveText('Saved');
  await editorA.click();
  await a.keyboard.press('Control+Home');
  await a.keyboard.type('Hi ');
  await expect(b.getByText('Ana Owner is editing')).toBeVisible({ timeout: 5000 });
  await expectNoBlockingAxeViolations(b);

  // B opens the same card: sees who else has it open and A's caret with her name.
  await b.getByRole('link', { name: /PR-1 Shared card/ }).click();
  const dialogB = b.getByRole('dialog', { name: 'Card PR-1' });
  await expect(dialogB.getByTestId('card-presence')).toHaveText('Also here: Ana Owner (editing)');
  await expect(dialogB.getByTestId('remote-caret')).toContainText('Ana Owner');
  await expect(dialogB.getByTestId('remote-carets')).toHaveAttribute('aria-hidden', 'true');
  await expectNoBlockingAxeViolations(b);

  // The caret follows A's typing.
  const before = await dialogB.getByTestId('remote-caret').boundingBox();
  await a.keyboard.type('there and back ');
  await expect
    .poll(async () => (await dialogB.getByTestId('remote-caret').boundingBox())?.x ?? 0)
    .not.toBe(before?.x);

  // A closes the page: B no longer sees her (a clean close is immediate; 30 s at most).
  await dialogB.getByRole('button', { name: 'Close' }).click();
  await a.close();
  await expect(peopleOf(b)).toHaveAttribute(
    'aria-label',
    '1 person on this board: Bea Member (you)',
    {
      timeout: 30_000,
    },
  );
  await expect(b.getByText('Ana Owner is editing')).toHaveCount(0);
});
