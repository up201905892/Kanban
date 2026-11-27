import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { Label } from '@kanban/shared';
import { AnnouncerProvider } from '../../components';
import { jsonResponse, stubFetch } from '../../test-utils/fetch';
import { boardKey } from '../board/api';
import { CardLabels } from './LabelChip';
import { LabelPicker } from './LabelPicker';

const PID = '0192f000-0000-7000-8000-0000000000a1';
const CARD = '0192f000-0000-7000-8000-0000000000d1';
const L1 = '0192f000-0000-7000-8000-0000000000b1';
const L2 = '0192f000-0000-7000-8000-0000000000b2';

const labels: Label[] = [
  { id: L1, projectId: PID, name: 'Bug', color: 'red' },
  { id: L2, projectId: PID, name: 'Feature', color: 'blue' },
];

const cardResponse = (labelIds: string[]) => ({
  card: {
    id: CARD,
    boardId: '0192f000-0000-7000-8000-0000000000c0',
    columnId: '0192f000-0000-7000-8000-0000000000c1',
    number: 1,
    title: 'One',
    position: 'a0',
    version: 2,
    assigneeId: null,
    priority: 'none',
    estimate: null,
    sprintId: null,
    labelIds,
    description: '',
    createdById: '0192f000-0000-7000-8000-000000000001',
    createdAt: '2026-11-27T10:00:00.000Z',
    updatedAt: '2026-11-27T10:00:00.000Z',
  },
});

function renderPicker(props: { labelIds?: string[]; labels?: Label[]; canEdit?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(boardKey(PID), undefined);
  return render(
    <QueryClientProvider client={client}>
      <AnnouncerProvider>
        <LabelPicker
          projectId={PID}
          cardId={CARD}
          labelIds={props.labelIds ?? []}
          labels={props.labels ?? labels}
          canEdit={props.canEdit ?? true}
        />
      </AnnouncerProvider>
    </QueryClientProvider>,
  );
}

describe('LabelPicker', () => {
  it('toggles a label with Space, saves the whole set and announces it', async () => {
    let sent: unknown;
    stubFetch({
      [`PUT /api/cards/${CARD}/labels`]: (body) => {
        sent = body;
        return jsonResponse(200, cardResponse([L1]));
      },
      [`GET /api/cards/${CARD}`]: () => jsonResponse(200, cardResponse([L1])),
      [`GET /api/cards/${CARD}/activity`]: () =>
        jsonResponse(200, { events: [], nextCursor: null }),
      [`GET /api/projects/${PID}/board`]: () => jsonResponse(500, {}),
    });
    const user = userEvent.setup();
    renderPicker();
    const group = screen.getByRole('group', { name: 'Labels' });
    expect(group).toBeVisible();
    const bug = screen.getByRole('checkbox', { name: 'Bug' });
    bug.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(sent).toEqual({ labelIds: [L1] }));
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent('Label Bug added'),
    );
  });

  it('announces a failure assertively', async () => {
    stubFetch({
      [`PUT /api/cards/${CARD}/labels`]: () =>
        jsonResponse(400, { error: { code: 'INVALID_LABEL', message: 'Nope' } }),
      [`GET /api/projects/${PID}/board`]: () => jsonResponse(500, {}),
    });
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('checkbox', { name: 'Feature' }));
    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent(
        'Could not change the labels: Nope',
      ),
    );
  });

  it('shows the checked state of the card labels', () => {
    renderPicker({ labelIds: [L2] });
    expect(screen.getByRole('checkbox', { name: 'Feature' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Bug' })).not.toBeChecked();
  });

  it('is read-only for viewers', () => {
    renderPicker({ labelIds: [L1], canEdit: false });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Labels' })).toBeVisible();
    expect(screen.getByText('Bug')).toBeVisible();
  });

  it('explains when the project has no labels', () => {
    renderPicker({ labels: [] });
    expect(screen.getByText(/No labels in this project yet/)).toBeVisible();
  });
});

describe('CardLabels on a tile', () => {
  it('shows the names as text and nothing without labels', () => {
    const { rerender, container } = render(<CardLabels labelIds={[L1, L2]} labels={labels} />);
    expect(screen.getByRole('list', { name: 'Labels' })).toBeVisible();
    expect(screen.getByText('Bug')).toBeVisible();
    expect(screen.getByText('Feature')).toBeVisible();
    rerender(<CardLabels labelIds={[]} labels={labels} />);
    expect(container).toBeEmptyDOMElement();
  });
});
