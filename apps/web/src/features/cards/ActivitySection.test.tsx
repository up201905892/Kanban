import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubFetch } from '../../test-utils/fetch';
import { ActivitySection } from './ActivitySection';

const CARD = '0192f000-0000-7000-8000-0000000000d1';
const USER = '0192f000-0000-7000-8000-000000000001';
const eid = (n: number) => `0192f000-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;

const event = (n: number) => ({
  id: eid(n),
  cardId: CARD,
  actorId: USER,
  createdAt: `2026-11-05T10:0${n}:00.000Z`,
  type: 'title_changed',
  data: { from: `T${n}`, to: `T${n + 1}` },
  actor: { id: USER, name: 'Ana' },
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActivitySection cardId={CARD} columns={[]} members={[]} />
    </QueryClientProvider>,
  );
}

describe('ActivitySection', () => {
  it('shows a list with time elements and moves focus to the first new item on Load more', async () => {
    const mock = stubFetch({
      [`GET /api/cards/${CARD}/activity`]: () =>
        jsonResponse(200, { events: [event(3), event(2)], nextCursor: 'next' }),
      [`GET /api/cards/${CARD}/activity?cursor=next`]: () =>
        jsonResponse(200, { events: [event(1)], nextCursor: null }),
    });
    renderSection();
    const list = await screen.findByRole('list');
    const first = within(list).getAllByRole('listitem');
    expect(first).toHaveLength(2);
    expect(first[0]).toHaveTextContent('Ana changed the title from “T3”');
    const time = first[0]?.querySelector('time');
    expect(time).toHaveAttribute('datetime', '2026-11-05T10:03:00.000Z');

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
    await waitFor(() => expect(within(list).getAllByRole('listitem')[2]).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('shows an error with retry when the request fails', async () => {
    stubFetch({
      [`GET /api/cards/${CARD}/activity`]: () =>
        jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Boom' } }),
    });
    renderSection();
    expect(await screen.findByText('Activity unavailable')).toBeInTheDocument();
  });
});
