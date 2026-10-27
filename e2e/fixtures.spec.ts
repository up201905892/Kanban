import { expect, test } from './fixtures.js';

test('userA and userB do not share cookies or storage', async ({ userA, userB }) => {
  await userA.page.goto('/');
  await userB.page.goto('/');

  await userA.page
    .context()
    .addCookies([{ name: 'who', value: 'a', url: 'http://localhost:5173' }]);
  await userA.page.evaluate(() => localStorage.setItem('who', 'a'));

  const cookiesA = await userA.page.context().cookies();
  const cookiesB = await userB.page.context().cookies();
  expect(cookiesA.map((c) => c.name)).toContain('who');
  expect(cookiesB.map((c) => c.name)).not.toContain('who');
  expect(await userB.page.evaluate(() => localStorage.getItem('who'))).toBeNull();
  expect(userA.page.context()).not.toBe(userB.page.context());
});
