import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { RouteError } from './RouteError';

function Boom(): never {
  throw new Error('boom');
}

describe('RouteError', () => {
  it('shows a Reload action when a route throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    const router = createMemoryRouter([
      { path: '/', element: <Boom />, errorElement: <RouteError /> },
    ]);
    render(<RouterProvider router={router} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();

    Object.defineProperty(window, 'location', { configurable: true, value: original });
    vi.restoreAllMocks();
  });
});
