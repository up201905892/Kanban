import { describe, expect, it } from 'vitest';
import {
  createSprintRequestSchema,
  daysRemaining,
  daysRemainingLabel,
  isCalendarDate,
  isDateRangeValid,
  sprintListQuerySchema,
  sumPoints,
  toCalendarDate,
  updateSprintRequestSchema,
} from './sprints.js';

describe('calendar dates', () => {
  it('accepts real dates and rejects impossible or malformed ones', () => {
    expect(isCalendarDate('2026-11-16')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-11-31')).toBe(false);
    expect(isCalendarDate('2026-1-5')).toBe(false);
    expect(isCalendarDate('2026-11-16T00:00:00Z')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
  });

  it('formats a Date as its UTC calendar date', () => {
    expect(toCalendarDate(new Date('2026-11-16T23:59:59Z'))).toBe('2026-11-16');
  });

  it('allows an end on or after the start only', () => {
    expect(isDateRangeValid('2026-11-16', '2026-11-16')).toBe(true);
    expect(isDateRangeValid('2026-11-16', '2026-11-30')).toBe(true);
    expect(isDateRangeValid('2026-11-16', '2026-11-15')).toBe(false);
    expect(isDateRangeValid('2026-11-16', 'nope')).toBe(false);
  });
});

describe('create and update requests', () => {
  const valid = { name: ' Sprint 1 ', startDate: '2026-11-16', endDate: '2026-11-27' };

  it('trims the name and keeps the optional goal', () => {
    const parsed = createSprintRequestSchema.parse({ ...valid, goal: ' Ship it ' });
    expect(parsed.name).toBe('Sprint 1');
    expect(parsed.goal).toBe('Ship it');
  });

  it('rejects an end before the start with the error on endDate', () => {
    const result = createSprintRequestSchema.safeParse({ ...valid, endDate: '2026-11-01' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['endDate']);
  });

  it('rejects empty and too long names, a long goal and unknown fields', () => {
    expect(createSprintRequestSchema.safeParse({ ...valid, name: '  ' }).success).toBe(false);
    expect(createSprintRequestSchema.safeParse({ ...valid, name: 'x'.repeat(81) }).success).toBe(
      false,
    );
    expect(createSprintRequestSchema.safeParse({ ...valid, name: 'x'.repeat(80) }).success).toBe(
      true,
    );
    expect(createSprintRequestSchema.safeParse({ ...valid, goal: 'g'.repeat(501) }).success).toBe(
      false,
    );
    expect(createSprintRequestSchema.safeParse({ ...valid, status: 'active' }).success).toBe(false);
  });

  it('needs at least one field to update, and checks the range when both dates come', () => {
    expect(updateSprintRequestSchema.safeParse({}).success).toBe(false);
    expect(updateSprintRequestSchema.safeParse({ name: 'New' }).success).toBe(true);
    expect(updateSprintRequestSchema.safeParse({ endDate: '2020-01-01' }).success).toBe(true);
    expect(
      updateSprintRequestSchema.safeParse({ startDate: '2026-11-10', endDate: '2026-11-01' })
        .success,
    ).toBe(false);
  });
});

describe('list query', () => {
  it('defaults the limit, coerces it and caps it at 100', () => {
    expect(sprintListQuerySchema.parse({}).limit).toBe(50);
    expect(sprintListQuerySchema.parse({ limit: '20' }).limit).toBe(20);
    expect(sprintListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(sprintListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('parses a comma separated status filter', () => {
    expect(sprintListQuerySchema.parse({ status: 'planned,active' }).status).toEqual([
      'planned',
      'active',
    ]);
    expect(sprintListQuerySchema.safeParse({ status: 'planned,bogus' }).success).toBe(false);
  });
});

describe('daysRemaining', () => {
  it('counts whole days to the end date', () => {
    expect(daysRemaining('2026-11-27', '2026-11-16')).toBe(11);
    expect(daysRemaining('2026-11-27', '2026-11-27')).toBe(0);
    expect(daysRemaining('2026-11-27', '2026-11-29')).toBe(-2);
  });

  it('is not confused by month, year and leap-day boundaries', () => {
    expect(daysRemaining('2027-01-02', '2026-12-30')).toBe(3);
    expect(daysRemaining('2028-03-01', '2028-02-28')).toBe(2);
  });

  it('throws on a value that is not a date', () => {
    expect(() => daysRemaining('x', '2026-11-16')).toThrow(RangeError);
  });

  it('words the label for before the start, the middle, the last day and after the end', () => {
    const [start, end] = ['2026-11-16', '2026-11-27'];
    expect(daysRemainingLabel(start, end, '2026-11-13')).toBe('Starts in 3 days');
    expect(daysRemainingLabel(start, end, '2026-11-15')).toBe('Starts in 1 day');
    expect(daysRemainingLabel(start, end, '2026-11-16')).toBe('11 days left');
    expect(daysRemainingLabel(start, end, '2026-11-26')).toBe('1 day left');
    expect(daysRemainingLabel(start, end, '2026-11-27')).toBe('Last day');
    expect(daysRemainingLabel(start, end, '2026-11-28')).toBe('Ended 1 day ago');
    expect(daysRemainingLabel(start, end, '2026-12-01')).toBe('Ended 4 days ago');
  });
});

describe('sumPoints', () => {
  it('adds the estimates and ignores cards without one', () => {
    expect(sumPoints([{ estimate: 3 }, { estimate: null }, { estimate: 5 }, { estimate: 0 }])).toBe(
      8,
    );
  });

  it('is 0 for no cards or only unestimated ones', () => {
    expect(sumPoints([])).toBe(0);
    expect(sumPoints([{ estimate: null }])).toBe(0);
  });
});
