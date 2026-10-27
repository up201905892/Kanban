import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.js';

test.describe('404 page', () => {
  test('renders for an unknown route', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  });

  test('has no serious or critical axe violations', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking).toEqual([]);
  });

  test('tab order is skip link, brand link, back link', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Back to the home page' })).toBeFocused();
  });

  test('is usable at 360px without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/this-route-does-not-exist');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
