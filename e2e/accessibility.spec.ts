import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, signUpViaApi, test } from './fixtures.js';

const ORIGIN = 'http://localhost:5173';
const DAY = 24 * 60 * 60 * 1000;
const utcDate = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** WCAG 2.x A and AA rules (including colour contrast); only serious and critical block. */
async function expectNoBlockingAxeViolations(page: Page, where: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ where, id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) }));
  expect(blocking).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, `${where} scrolls horizontally at 360px`).toBe(false);
}

const post = (page: Page, url: string, data: object) =>
  page.request.post(url, { data, headers: { origin: ORIGIN } });

interface Seed {
  workspaceId: string;
  projectId: string;
  inviteToken: string;
}

/** A workspace with a project, three cards (one in a started sprint) and an invite link. */
async function seed(page: Page): Promise<Seed> {
  const ws = (await (
    await post(page, '/api/workspaces', { name: `A11y ${randomUUID().slice(0, 8)}` })
  ).json()) as { workspace: { id: string } };
  const workspaceId = ws.workspace.id;
  const project = (await (
    await post(page, `/api/workspaces/${workspaceId}/projects`, { name: 'Sweep', key: 'AX' })
  ).json()) as { project: { id: string } };
  const projectId = project.project.id;
  const board = (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as {
    columns: { id: string }[];
  };
  const ids: string[] = [];
  for (const title of ['First card', 'Second card', 'Third card']) {
    const created = (await (
      await post(page, `/api/columns/${board.columns[0]?.id}/cards`, { title })
    ).json()) as { card: { id: string } };
    ids.push(created.card.id);
  }
  await page.request.patch(`/api/cards/${ids[0]}`, {
    data: { estimate: 3, priority: 'high' },
    headers: { origin: ORIGIN },
  });
  const sprint = (await (
    await post(page, `/api/projects/${projectId}/sprints`, {
      name: 'Sweep sprint',
      startDate: utcDate(0),
      endDate: utcDate(5),
    })
  ).json()) as { sprint: { id: string } };
  await page.request.put(`/api/cards/${ids[0]}/sprint`, {
    data: { sprintId: sprint.sprint.id },
    headers: { origin: ORIGIN },
  });
  await post(page, `/api/sprints/${sprint.sprint.id}/start`, {});
  const invite = (await (
    await post(page, `/api/workspaces/${workspaceId}/invites`, {
      role: 'member',
      expiresInDays: 1,
    })
  ).json()) as { link: string };
  return { workspaceId, projectId, inviteToken: invite.link.split('/invite/')[1] ?? '' };
}

test.describe('accessibility sweep (KB-030)', () => {
  test('every route has no serious or critical axe violations and fits 360px', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    // Public routes, logged out.
    const guestContext = await browser.newContext({ baseURL: baseURL ?? '' });
    const guest = await guestContext.newPage();
    for (const path of ['/login', '/signup', '/invite/not-a-real-token', '/no-such-page']) {
      await guest.goto(path);
      await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoBlockingAxeViolations(guest, path);
    }

    await signUpViaApi(page, { name: 'Ana Sweep' });
    const { workspaceId, projectId, inviteToken } = await seed(page);

    // Logged-out view of a real invite.
    await guest.goto(`/invite/${inviteToken}`);
    await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoBlockingAxeViolations(guest, 'invite (logged out)');
    await guestContext.close();

    const paths: [string, string][] = [
      ['home', '/'],
      ['workspace', `/workspaces/${workspaceId}`],
      ['workspace settings', `/workspaces/${workspaceId}/settings`],
      ['members', `/workspaces/${workspaceId}/members`],
      ['board', `/projects/${projectId}`],
      ['card dialog', `/projects/${projectId}/cards/1`],
      ['backlog', `/projects/${projectId}/backlog`],
      ['reports', `/projects/${projectId}/reports`],
      ['project settings', `/projects/${projectId}/settings`],
      // Error states replace the page and must still carry the page's h1.
      ['project unavailable', '/projects/00000000-0000-7000-8000-000000000000'],
      ['workspace unavailable', '/workspaces/00000000-0000-7000-8000-000000000000/members'],
    ];
    for (const [name, path] of paths) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(page.getByText(/^Loading/)).toHaveCount(0);
      // SC 2.4.2: the title says what the page is.
      await expect(page).toHaveTitle(/^.+ - Kanban$/);
      await expectNoBlockingAxeViolations(page, name);
    }

    await page.setViewportSize({ width: 360, height: 700 });
    for (const [name, path] of paths) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(page.getByText(/^Loading/)).toHaveCount(0);
      await expectNoHorizontalScroll(page, name);
    }
  });

  test('keyboard-only critical path: create card, move, open, edit, close', async ({ page }) => {
    await signUpViaApi(page, { name: 'Kay Board' });
    const { projectId } = await seed(page);
    await page.goto(`/projects/${projectId}`);
    const live = page.getByTestId('live-polite');
    await expect(page.getByRole('link', { name: /AX-1 First card/ })).toBeVisible();

    // The started sprint filters the board; show every card so the new one is visible.
    await page.getByRole('checkbox', { name: 'Active sprint only' }).focus();
    await page.keyboard.press('Space');

    // Create a card (no mouse: focus is placed by script, everything else is key presses).
    await page.getByRole('button', { name: 'Add card to To do' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Card title')).toBeFocused();
    await page.keyboard.type('Keyboard card');
    await page.keyboard.press('Enter');
    await expect(live).toHaveText('Card AX-4 created in To do');

    // Move it with the keyboard: Space, ArrowRight, Space.
    await page.getByRole('button', { name: 'Move card AX-4' }).focus();
    await page.keyboard.press('Space');
    await expect(live).toContainText('Picked up');
    await page.keyboard.press('ArrowRight');
    await expect(live).toContainText('moved to In progress');
    await page.keyboard.press('Space');
    await expect(live).toContainText('dropped in In progress');
    await expect(
      page
        .getByRole('region', { name: 'Column In progress' })
        .getByRole('link', { name: /AX-4 Keyboard card/ }),
    ).toBeVisible();

    // Open with Enter, edit the title, close with Escape; focus returns to the tile.
    await page.getByRole('link', { name: /AX-4 Keyboard card/ }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Card AX-4' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Edit title' }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Keyboard card edited');
    await page.keyboard.press('Enter');
    await expect(live).toHaveText('Card title saved');
    await expect(
      dialog.getByRole('heading', { level: 3, name: 'Keyboard card edited' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('link', { name: /AX-4 Keyboard card edited/ })).toBeFocused();
  });
});
