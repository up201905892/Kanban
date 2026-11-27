import { describe, expect, it } from 'vitest';
import { averageCompleted, velocityResponseSchema, velocitySummary } from './velocity.js';

const s = (completedPoints: number) => ({ completedPoints });

describe('averageCompleted', () => {
  it('is 0 with no sprints', () => expect(averageCompleted([])).toBe(0));
  it('is the value of a single sprint', () => expect(averageCompleted([s(13)])).toBe(13));
  it('averages 6 sprints with one decimal', () => {
    expect(averageCompleted([s(5), s(8), s(13), s(3), s(0), s(2)])).toBe(5.2);
  });
});

describe('velocity schema and summary', () => {
  it('rejects more than 6 sprints', () => {
    const sprint = {
      id: '0194a3c2-0000-7000-8000-000000000000',
      name: 'S',
      committedPoints: 1,
      completedPoints: 1,
    };
    expect(
      velocityResponseSchema.safeParse({ sprints: Array(7).fill(sprint), averageCompleted: 1 })
        .success,
    ).toBe(false);
  });
  it('summarises', () => {
    expect(velocitySummary({ sprints: [], averageCompleted: 0 })).toBe('No closed sprints yet');
    const one = {
      sprints: [{ id: 'x', name: 'S', committedPoints: 3, completedPoints: 1 }],
      averageCompleted: 1,
    };
    expect(velocitySummary(one)).toContain('1 point completed per sprint over the last 1 sprint');
  });
});
