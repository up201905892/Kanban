import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { APP_NAME } from '@kanban/shared';
import { App } from './App';
import { createTestRouter } from './router';
import { jsonResponse, stubFetch, USER } from './test-utils/fetch';

describe('App', () => {
  it('renders the app name imported from the shared package for a logged-in user', async () => {
    stubFetch({ 'GET /api/auth/me': () => jsonResponse(200, { user: USER }) });
    render(<App router={createTestRouter(['/'])} />);
    expect(await screen.findByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
  });

  it('renders the 404 page for unknown routes', async () => {
    stubFetch({ 'GET /api/auth/me': () => jsonResponse(401, unauthenticated()) });
    render(<App router={createTestRouter(['/nope/at/all'])} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
  });

  it('tabs through the 404 page in a logical order', async () => {
    stubFetch({ 'GET /api/auth/me': () => jsonResponse(401, unauthenticated()) });
    const user = userEvent.setup();
    render(<App router={createTestRouter(['/missing'])} />);
    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: APP_NAME })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Back to the home page' })).toHaveFocus();
  });
});

function unauthenticated() {
  return { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } };
}
