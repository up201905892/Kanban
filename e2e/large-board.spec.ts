import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { afterWrite, expect, logInViaApi, test } from './fixtures.js';

// Printed by `pnpm db:seed:large` (local and CI databases only; the seed refuses production).
const SEED_USER = {
  email: 'large-board@example.com',
  name: 'Large Board',
  password: 'large-board-demo-1234',
};
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Runs the real seed command and returns the id of the project it created. */
function seedLargeProject(): string {
  const output = execFileSync('pnpm', ['db:seed:large'], { cwd: ROOT, encoding: 'utf8' });
  const projectId = /Board: \/projects\/(\S+)/.exec(output)?.[1];
  if (!projectId) throw new Error('The seed command did not print the project id');
  return projectId;
}

const tilesIn = (page: Page, column: string) =>
  page.getByRole('region', { name: `Column ${column}` }).getByRole('link');

test.describe('board with 600 cards', () => {
  test('loads with a bounded DOM and moves the 300th card with the keyboard', async ({ page }) => {
    test.setTimeout(120_000);
    const projectId = seedLargeProject();
    await logInViaApi(page, SEED_USER);
    await page.goto(`/projects/${projectId}`);

    // Cards 1-120 are in Backlog, 241-360 in In progress (120 per column).
    await expect(tilesIn(page, 'Backlog').first()).toHaveText(/^BIG-1 Seeded card 1/);
    const rendered = await page.locator('.card-tile').count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThanOrEqual(150);
    await expect(page.getByRole('list', { name: 'Cards in In progress' })).toBeVisible();

    // Arrow keys walk down the virtualized column: card 300 is the 60th of "In progress".
    await tilesIn(page, 'In progress').first().focus();
    for (let i = 0; i < 59; i++) {
      await page.keyboard.press('ArrowDown');
    }
    const tile = page.getByRole('link', { name: /^BIG-300 Seeded card 300/ });
    await expect(tile).toBeFocused();

    // Pick it up from the move handle, move it one column right, drop it.
    const live = page.getByTestId('live-polite');
    await page.getByRole('button', { name: 'Move card BIG-300' }).focus();
    await page.keyboard.press('Space');
    await expect(live).toHaveText(
      /^Picked up Card BIG-300 'Seeded card 300'\. In progress, position 60 of 120\./,
    );
    await page.keyboard.press('ArrowRight');
    await expect(live).toHaveText(/moved to Review, position \d+ of 121$/);
    await afterWrite(page, 'POST', /^\/api\/cards\/[^/]+\/move$/, () =>
      page.keyboard.press('Space'),
    );
    await expect(live).toHaveText(/dropped in Review, position \d+ of 121$/);

    // It persisted: after a reload the card is in Review according to the server.
    await page.reload();
    await expect(tilesIn(page, 'Backlog').first()).toBeVisible();
    const board = (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as {
      columns: { id: string; name: string }[];
      cards: { number: number; columnId: string }[];
    };
    const review = board.columns.find((c) => c.name === 'Review');
    expect(board.cards.find((c) => c.number === 300)?.columnId).toBe(review?.id);
  });
});
