import { describe, expect, it } from 'vitest';
import {
  burndownSummary,
  computeBurndown,
  type BurndownEvent,
  type BurndownSprint,
} from './burndown.js';

const SPRINT_ID = 'sprint-1';
const TODO = 'col-todo';
const DONE = 'col-done';
const sprint: BurndownSprint = { startDate: '2026-11-02', endDate: '2026-11-06' };
const doneColumnIds = new Set([DONE]);

let counter = 0;
const ev = (cardId: string, at: string, type: string, data: unknown): BurndownEvent => ({
  id: String(++counter).padStart(4, '0'),
  cardId,
  createdAt: at,
  type,
  data,
});
const added = (cardId: string, at: string) =>
  ev(cardId, at, 'sprint_added', { sprintId: SPRINT_ID, sprintName: 'S' });

const run = (
  cards: { id: string; columnId: string; estimate: number | null }[],
  events: BurndownEvent[],
  today = '2026-11-06',
  s: BurndownSprint = sprint,
) => computeBurndown(s, events, { sprintId: SPRINT_ID, doneColumnIds, cards, today });

describe('computeBurndown', () => {
  it('is empty for a sprint without cards', () => {
    const out = run([], []);
    expect(out.days.map((d) => [d.remainingPoints, d.scopePoints])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(out.ideal.every((p) => p.points === 0)).toBe(true);
    expect(out.unestimatedCount).toBe(0);
  });

  it('covers the start date up to today and the whole range for the ideal line', () => {
    const out = run(
      [{ id: 'a', columnId: TODO, estimate: 8 }],
      [added('a', '2026-11-01T10:00:00Z')],
      '2026-11-04',
    );
    expect(out.days.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(out.ideal.map((p) => p.points)).toEqual([8, 6, 4, 2, 0]);
    expect(out.ideal.map((p) => p.date)[4]).toBe('2026-11-06');
  });

  it('stops at the end date when today is later and has no days before the start', () => {
    expect(run([], [], '2026-12-31').days).toHaveLength(5);
    expect(run([], [], '2026-11-01').days).toEqual([]);
  });

  it('drops the remaining points when a card moves into Done', () => {
    const out = run(
      [
        { id: 'a', columnId: DONE, estimate: 3 },
        { id: 'b', columnId: TODO, estimate: 5 },
      ],
      [
        added('a', '2026-11-01T10:00:00Z'),
        added('b', '2026-11-01T10:00:00Z'),
        ev('a', '2026-11-03T09:00:00Z', 'moved', { fromColumnId: TODO, toColumnId: DONE }),
      ],
      '2026-11-04',
    );
    expect(out.days.map((d) => d.remainingPoints)).toEqual([8, 5, 5]);
    expect(out.days.map((d) => d.scopePoints)).toEqual([8, 8, 8]);
  });

  it('raises the remaining points again when a card moves out of Done', () => {
    const out = run(
      [{ id: 'a', columnId: TODO, estimate: 4 }],
      [
        added('a', '2026-11-01T10:00:00Z'),
        ev('a', '2026-11-02T09:00:00Z', 'moved', { fromColumnId: TODO, toColumnId: DONE }),
        ev('a', '2026-11-04T09:00:00Z', 'moved', { fromColumnId: DONE, toColumnId: TODO }),
      ],
      '2026-11-04',
    );
    expect(out.days.map((d) => d.remainingPoints)).toEqual([0, 0, 4]);
  });

  it('raises the scope line when a card is added mid-sprint', () => {
    const out = run(
      [
        { id: 'a', columnId: TODO, estimate: 3 },
        { id: 'b', columnId: TODO, estimate: 2 },
      ],
      [added('a', '2026-11-01T10:00:00Z'), added('b', '2026-11-03T12:00:00Z')],
      '2026-11-04',
    );
    expect(out.days.map((d) => d.scopePoints)).toEqual([3, 5, 5]);
    expect(out.days.map((d) => d.remainingPoints)).toEqual([3, 5, 5]);
  });

  it('lowers the scope when a card leaves the sprint, ignoring other sprints', () => {
    const out = run(
      [{ id: 'a', columnId: TODO, estimate: 3 }],
      [
        added('a', '2026-11-01T10:00:00Z'),
        ev('a', '2026-11-03T12:00:00Z', 'sprint_removed', { sprintId: 'other', sprintName: 'O' }),
        ev('a', '2026-11-04T12:00:00Z', 'sprint_removed', { sprintId: SPRINT_ID, sprintName: 'S' }),
      ],
      '2026-11-04',
    );
    expect(out.days.map((d) => d.scopePoints)).toEqual([3, 3, 0]);
  });

  it('removes a deleted card from the scope', () => {
    const out = run(
      [{ id: 'a', columnId: TODO, estimate: 3 }],
      [
        added('a', '2026-11-01T10:00:00Z'),
        ev('a', '2026-11-03T08:00:00Z', 'deleted', { title: 'x' }),
      ],
      '2026-11-03',
    );
    expect(out.days.map((d) => d.scopePoints)).toEqual([3, 0]);
    expect(out.unestimatedCount).toBe(0);
  });

  it('uses the estimate in force on each day, also for a card already done', () => {
    const out = run(
      [{ id: 'a', columnId: DONE, estimate: 8 }],
      [
        added('a', '2026-11-01T10:00:00Z'),
        ev('a', '2026-11-02T08:00:00Z', 'estimate_changed', { from: null, to: 3 }),
        ev('a', '2026-11-03T08:00:00Z', 'moved', { fromColumnId: TODO, toColumnId: DONE }),
        ev('a', '2026-11-04T08:00:00Z', 'estimate_changed', { from: 3, to: 8 }),
      ],
      '2026-11-04',
    );
    expect(out.days.map((d) => d.scopePoints)).toEqual([3, 3, 8]);
    expect(out.days.map((d) => d.remainingPoints)).toEqual([3, 0, 0]);
  });

  it('counts unestimated cards as 0 and reports them', () => {
    const out = run(
      [
        { id: 'a', columnId: TODO, estimate: null },
        { id: 'b', columnId: TODO, estimate: 2 },
      ],
      [added('a', '2026-11-01T10:00:00Z'), added('b', '2026-11-01T10:00:00Z')],
    );
    expect(out.days.at(-1)).toMatchObject({ remainingPoints: 2, scopePoints: 2 });
    expect(out.unestimatedCount).toBe(1);
  });

  it('uses UTC day boundaries', () => {
    const out = run(
      [{ id: 'a', columnId: TODO, estimate: 5 }],
      [added('a', '2026-11-02T23:59:59.999Z')],
      '2026-11-03',
    );
    expect(out.days.map((d) => d.scopePoints)).toEqual([5, 5]);
    const late = run(
      [{ id: 'a', columnId: TODO, estimate: 5 }],
      [added('a', '2026-11-03T00:00:00.000Z')],
      '2026-11-03',
    );
    expect(late.days.map((d) => d.scopePoints)).toEqual([0, 5]);
  });

  it('follows a card moved when its column was deleted', () => {
    const ref = (id: string) => ({ columnId: id, columnName: id });
    const out = run(
      [{ id: 'a', columnId: DONE, estimate: 2 }],
      [
        added('a', '2026-11-01T10:00:00Z'),
        ev('a', '2026-11-03T08:00:00Z', 'column_deleted_moved', { from: ref(TODO), to: ref(DONE) }),
      ],
      '2026-11-03',
    );
    expect(out.days.map((d) => d.remainingPoints)).toEqual([2, 0]);
  });

  it('stops at the close date of a closed sprint', () => {
    const out = run([], [], '2026-11-06', { ...sprint, closedAt: '2026-11-04T10:00:00Z' });
    expect(out.days).toHaveLength(3);
  });

  it('gives a one-day sprint a flat ideal line', () => {
    const out = run(
      [{ id: 'a', columnId: TODO, estimate: 4 }],
      [added('a', '2026-11-02T01:00:00Z')],
      '2026-11-02',
      { startDate: '2026-11-02', endDate: '2026-11-02' },
    );
    expect(out.ideal).toEqual([{ date: '2026-11-02', points: 4 }]);
  });
});

describe('burndownSummary', () => {
  it('words the remaining points and the days left', () => {
    const day = { date: '2026-11-02', remainingPoints: 12, scopePoints: 30 };
    expect(burndownSummary(sprint, day, '2026-11-02')).toBe(
      '12 of 30 points remaining, 4 days left',
    );
    expect(burndownSummary(sprint, day, '2026-11-06')).toBe('12 of 30 points remaining, last day');
    expect(burndownSummary(sprint, undefined, '2026-11-01')).toBe('The sprint has not started yet');
  });
});
