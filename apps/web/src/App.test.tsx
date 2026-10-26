import { render, screen } from '@testing-library/react';
import { APP_NAME } from '@kanban/shared';
import { App } from './App';

describe('App', () => {
  it('renders the app name imported from the shared package', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
  });
});
