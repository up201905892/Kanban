import { describe, expect, it } from 'vitest';
import type { CardSummary, Sprint } from '@kanban/shared';
import {
  backlogCards,
  dateRangeLabel,
  defaultTargetSprint,
  localToday,
  pointsLabel,
  pointsOf,
  sortSprints,
  sprintCards,
} from './planning';

const card = (number: number, estimate: number | null, sprintId: string | null): CardSummary => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  columnId: '00000000-0000-4000-8000-0000000000c1',
  number,
  title: `Card ${number}`,
  position: 'a0',
  version: 1,
  assigneeId: null,
  priority: 'none',
  estimate,
  sprintId,
});

const sprint = (id: string, startDate: string, status: Sprint['status'] = 'planned'): Sprint => ({
  id,
  projectId: '00000000-0000-4000-8000-0000000000a1',
  name: id,
  goal: '',
  startDate,
  endDate: '2026-12-31',
  status,
  committedPoints: null,
  completedPoints: null,
  closedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
});

describe('planning', () => {
  it('splits cards into the backlog and sprints, ordered by number', () => {
    const cards = [card(3, 1, 's1'), card(2, null, null), card(1, 5, null), card(4, 2, 's1')];
    expect(backlogCards(cards).map((c) => c.number)).toEqual([1, 2]);
    expect(sprintCards(cards, 's1').map((c) => c.number)).toEqual([3, 4]);
    expect(sprintCards(cards, 'other')).toEqual([]);
  });

  it('totals points, ignoring unestimated cards but counting them', () => {
    const total = pointsOf([
      card(1, 5, null),
      card(2, null, null),
      card(3, 0, null),
      card(4, 3, null),
    ]);
    expect(total).toEqual({ points: 8, unestimated: 1 });
    expect(pointsOf([])).toEqual({ points: 0, unestimated: 0 });
  });

  it('words the totals', () => {
    expect(pointsLabel({ points: 1, unestimated: 0 })).toBe('1 point');
    expect(pointsLabel({ points: 0, unestimated: 0 })).toBe('0 points');
    expect(pointsLabel({ points: 12, unestimated: 2 })).toBe('12 points, 2 not estimated');
  });

  it('sorts sprints by start date then id', () => {
    const sorted = sortSprints([
      sprint('b', '2026-12-01'),
      sprint('c', '2026-11-01'),
      sprint('a', '2026-12-01'),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('prefers the active sprint as the default target, else the first planned one', () => {
    const planned = sprint('p', '2026-12-01');
    const active = sprint('a', '2026-11-01', 'active');
    expect(defaultTargetSprint([planned, active])).toBe(active);
    expect(defaultTargetSprint([planned])).toBe(planned);
    expect(defaultTargetSprint([])).toBeUndefined();
  });

  it('formats dates without a time-zone shift', () => {
    expect(dateRangeLabel('2026-11-16', '2026-12-04')).toBe('16 Nov 2026 to 4 Dec 2026');
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
