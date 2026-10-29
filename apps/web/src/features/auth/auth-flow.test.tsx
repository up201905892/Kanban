import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';

const unauthenticated = () =>
  jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });

describe('protected routes', () => {
  it('redirects to /login keeping the path in next', async () => {
    stubFetch({ 'GET /api/auth/me': unauthenticated });
    const router = createTestRouter(['/']);
    render(<App router={router} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('shows an error state with Retry when the session check fails', async () => {
    let calls = 0;
    stubFetch({
      'GET /api/auth/me': () =>
        ++calls <= 1
          ? jsonResponse(400, { error: { code: 'VALIDATION_ERROR', message: 'Nope' } })
          : jsonResponse(200, { user: USER }),
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter(['/'])} />);
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Kanban' })).toBeInTheDocument();
  });
});

describe('login page', () => {
  it('logs in and returns to next', async () => {
    const mock = stubFetch({
      'GET /api/auth/me': unauthenticated,
      'POST /api/auth/login': () => jsonResponse(200, { user: USER }),
    });
    const user = userEvent.setup();
    const router = createTestRouter(['/login?next=%2Fprojects%2F1']);
    render(<App router={router} />);
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/1'));
    const call = mock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      email: 'ada@example.com',
      password: 'correct horse battery',
    });
  });

  it('ignores an open-redirect next value', async () => {
    stubFetch({
      'GET /api/auth/me': unauthenticated,
      'POST /api/auth/login': () => jsonResponse(200, { user: USER }),
    });
    const user = userEvent.setup();
    const router = createTestRouter(['/login?next=https%3A%2F%2Fevil.example']);
    render(<App router={router} />);
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('shows the API message for wrong credentials and announces it assertively', async () => {
    stubFetch({
      'GET /api/auth/me': unauthenticated,
      'POST /api/auth/login': () =>
        jsonResponse(401, {
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        }),
    });
    const user = userEvent.setup();
    const router = createTestRouter(['/login']);
    render(<App router={router} />);
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    // A wrong password must not be treated as an expired session.
    expect(router.state.location.pathname).toBe('/login');
    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent('Invalid email or password'),
    );
  });

  it('shows field errors and focuses the first invalid field', async () => {
    const mock = stubFetch({ 'GET /api/auth/me': unauthenticated });
    const user = userEvent.setup();
    render(<App router={createTestRouter(['/login'])} />);
    await user.type(await screen.findByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    const email = screen.getByLabelText('Email');
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Enter a valid email address');
    expect(mock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('shows the API message for 429', async () => {
    stubFetch({
      'GET /api/auth/me': unauthenticated,
      'POST /api/auth/login': () =>
        jsonResponse(429, {
          error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' },
        }),
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter(['/login'])} />);
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Too many attempts, try again later')).toBeInTheDocument();
  });

  it('toggles password visibility with aria-pressed', async () => {
    stubFetch({ 'GET /api/auth/me': unauthenticated });
    const user = userEvent.setup();
    render(<App router={createTestRouter(['/login'])} />);
    const input = await screen.findByLabelText('Password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('signup page', () => {
  it('maps API details to fields and EMAIL_TAKEN to the email field', async () => {
    stubFetch({
      'GET /api/auth/me': unauthenticated,
      'POST /api/auth/signup': () =>
        jsonResponse(409, {
          error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists' },
        }),
    });
    const user = userEvent.setup();
    render(<App router={createTestRouter(['/signup'])} />);
    await user.type(await screen.findByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    const email = screen.getByLabelText('Email');
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAccessibleDescription('An account with this email already exists');
  });

  it('validates the password length before calling the API', async () => {
    const mock = stubFetch({ 'GET /api/auth/me': unauthenticated });
    const user = userEvent.setup();
    render(<App router={createTestRouter(['/signup'])} />);
    await user.type(await screen.findByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    const password = screen.getByLabelText('Password');
    await waitFor(() => expect(password).toHaveFocus());
    expect(password).toHaveAccessibleDescription(/at least 10 characters/i);
    expect(mock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('signs up and lands on the home page', async () => {
    stubFetch({
      'GET /api/auth/me': unauthenticated,
      'POST /api/auth/signup': () => jsonResponse(201, { user: USER }),
    });
    const user = userEvent.setup();
    const router = createTestRouter(['/signup']);
    render(<App router={router} />);
    await user.type(await screen.findByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'long-enough-password');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Kanban' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('log out', () => {
  it('clears the cache and goes to /login', async () => {
    let loggedOut = false;
    stubFetch({
      'GET /api/auth/me': () => (loggedOut ? unauthenticated() : jsonResponse(200, { user: USER })),
      'POST /api/auth/logout': () => {
        loggedOut = true;
        return jsonResponse(204);
      },
    });
    const user = userEvent.setup();
    const router = createTestRouter(['/']);
    render(<App router={router} />);
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
  });
});
