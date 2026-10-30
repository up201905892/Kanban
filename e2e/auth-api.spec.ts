import { expect, logInViaApi, signUpViaApi, test } from './fixtures';

// Exercises the Playwright auth helpers through the web dev proxy (the auth UI is KB-006).
test('signing up through the API leaves a session cookie that survives page loads', async ({
  userA,
}) => {
  const user = await signUpViaApi(userA.page);
  const me = await userA.page.request.get('/api/auth/me');
  expect(me.status()).toBe(200);
  expect((await me.json()).user.email).toBe(user.email);

  const cookies = await userA.page.context().cookies();
  const session = cookies.find((c) => c.name === 'kanban_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
});

test('the two users have independent sessions and logout ends only one', async ({
  userA,
  userB,
}) => {
  const a = await signUpViaApi(userA.page);
  const b = await signUpViaApi(userB.page);
  const meA = await (await userA.page.request.get('/api/auth/me')).json();
  const meB = await (await userB.page.request.get('/api/auth/me')).json();
  expect(meA.user.email).toBe(a.email);
  expect(meB.user.email).toBe(b.email);

  const out = await userA.page.request.post('/api/auth/logout', {
    headers: { origin: 'http://localhost:5173' },
  });
  expect(out.status()).toBe(204);
  expect((await userA.page.request.get('/api/auth/me')).status()).toBe(401);
  expect((await userB.page.request.get('/api/auth/me')).status()).toBe(200);

  await logInViaApi(userA.page, a);
  expect((await userA.page.request.get('/api/auth/me')).status()).toBe(200);
});
