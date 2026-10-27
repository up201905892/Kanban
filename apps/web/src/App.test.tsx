import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { APP_NAME } from '@kanban/shared';
import { App } from './App';
import { createTestRouter } from './router';

describe('App', () => {
  it('renders the app name imported from the shared package', () => {
    render(<App router={createTestRouter(['/'])} />);
    expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
  });

  it('renders the 404 page for unknown routes', () => {
    render(<App router={createTestRouter(['/nope/at/all'])} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('tabs through the 404 page in a logical order', async () => {
    const user = userEvent.setup();
    render(<App router={createTestRouter(['/missing'])} />);
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: APP_NAME })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Back to the home page' })).toHaveFocus();
  });
});
