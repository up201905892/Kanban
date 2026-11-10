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

/** A project with one card holding `description`, and `guest` joined with `role`. */
async function setup(owner: Page, guest: Page, role: 'member' | 'viewer', description: string) {
  const ws = (await (
    await post(owner, '/api/workspaces', { name: `Collab ${randomUUID().slice(0, 8)}` })
  ).json()) as { workspace: { id: string } };
  const project = (await (
    await post(owner, `/api/workspaces/${ws.workspace.id}/projects`, { name: 'Collab', key: 'CO' })
  ).json()) as { project: { id: string } };
  const board = (await (
    await owner.request.get(`/api/projects/${project.project.id}/board`)
  ).json()) as { columns: { id: string }[] };
  const created = (await (
    await post(owner, `/api/columns/${board.columns[0]?.id}/cards`, {
      title: 'Shared card',
      description,
    })
  ).json()) as { card: { id: string } };
  const invite = (await (
    await post(owner, `/api/workspaces/${ws.workspace.id}/invites`, { role, expiresInDays: 1 })
  ).json()) as { link: string };
  const accepted = await post(guest, `/api/invites/${invite.link.split('/invite/')[1]}/accept`, {});
  expect(accepted.status()).toBe(200);
  return { projectId: project.project.id, cardId: created.card.id };
}

const editorOf = (page: Page) =>
  page.getByRole('dialog', { name: 'Card CO-1' }).getByRole('textbox', { name: 'Description' });
const statusOf = (page: Page) =>
  page.getByRole('dialog', { name: 'Card CO-1' }).getByTestId('description-status');

test('two people type at the same time in different places and end with identical text', async ({
  userA,
  userB,
}) => {
  const a = userA.page;
  const b = userB.page;
  await signUpViaApi(a, { name: 'Ana Owner' });
  await signUpViaApi(b, { name: 'Bea Member' });
  const { projectId, cardId } = await setup(a, b, 'member', 'First line\n\nLast line');

  await Promise.all([
    a.goto(`/projects/${projectId}/cards/1`),
    b.goto(`/projects/${projectId}/cards/1`),
  ]);
  await expect(statusOf(a)).toHaveText('Saved');
  await expect(statusOf(b)).toHaveText('Saved');
  // The text the server seeded from the card is shown to both, once.
  await expect(editorOf(a)).toHaveValue('First line\n\nLast line');
  await expect(editorOf(b)).toHaveValue('First line\n\nLast line');
  await expectNoBlockingAxeViolations(a);

  // A types at the start, B at the end, at the same time.
  await editorOf(a).focus();
  await a.keyboard.press('Control+Home');
  await editorOf(b).focus();
  await b.keyboard.press('Control+End');
  await Promise.all([a.keyboard.type('Alpha '), b.keyboard.type(' Omega', { delay: 15 })]);

  const expected = 'Alpha First line\n\nLast line Omega';
  await expect(editorOf(a)).toHaveValue(expected, { timeout: 5000 });
  await expect(editorOf(b)).toHaveValue(expected, { timeout: 5000 });
  await expect(statusOf(a)).toHaveText('Saved');
  await expect(statusOf(b)).toHaveText('Saved');

  // R4: after a reload the text equals what REST serves (the server projected the document).
  await expect
    .poll(
      async () =>
        (
          (await (await a.request.get(`/api/cards/${cardId}`)).json()) as {
            card: { description: string };
          }
        ).card.description,
      { timeout: 5000 },
    )
    .toBe(expected);
  await a.reload();
  await expect(editorOf(a)).toHaveValue(expected);

  // One write path: PATCH refuses the description.
  const patch = await a.request.patch(`/api/cards/${cardId}`, {
    data: { description: 'nope' },
    headers: { origin: ORIGIN },
  });
  expect(patch.status()).toBe(400);
});

test('a viewer sees live changes but cannot type', async ({ userA, userB }) => {
  const a = userA.page;
  const b = userB.page;
  await signUpViaApi(a, { name: 'Ana Owner' });
  await signUpViaApi(b, { name: 'Vera Viewer' });
  const { projectId } = await setup(a, b, 'viewer', 'Read only');

  await a.goto(`/projects/${projectId}/cards/1`);
  await b.goto(`/projects/${projectId}/cards/1`);
  await expect(statusOf(a)).toHaveText('Saved');
  await expect(statusOf(b)).toHaveText('Saved');
  await expect(editorOf(b)).toHaveAttribute('aria-readonly', 'true');

  await editorOf(a).focus();
  await a.keyboard.press('Control+End');
  await a.keyboard.type(' live');
  await expect(editorOf(b)).toHaveValue('Read only live', { timeout: 2000 });

  // B cannot type: the editor keeps its text.
  await editorOf(b).click({ force: true });
  await b.keyboard.type('hacked');
  await expect(editorOf(b)).toHaveValue('Read only live');
  await expect(editorOf(a)).toHaveValue('Read only live');
  await expectNoBlockingAxeViolations(b);
});
