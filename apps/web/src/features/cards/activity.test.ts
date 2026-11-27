import { describe, expect, it } from 'vitest';
import { ACTIVITY_TYPES, type ActivityEntry } from '@kanban/shared';
import {
  describeActivity,
  formatAbsoluteTime,
  formatRelativeTime,
  type ActivityNames,
} from './activity';

const U1 = '0192f000-0000-7000-8000-000000000001';
const U2 = '0192f000-0000-7000-8000-000000000002';
const C1 = '0192f000-0000-7000-8000-0000000000c1';
const C2 = '0192f000-0000-7000-8000-0000000000c2';
const S1 = '0192f000-0000-7000-8000-0000000000e1';

const names: ActivityNames = {
  column: (id) => ({ [C1]: 'To do', [C2]: 'In progress' })[id],
  member: (id) => ({ [U2]: 'Bo' })[id],
};

type Variant = { [T in ActivityEntry['type']]: Extract<ActivityEntry, { type: T }>['data'] };
const base = {
  id: '0192f000-0000-7000-8000-0000000000f1',
  cardId: '0192f000-0000-7000-8000-0000000000d1',
  actorId: U1,
  createdAt: '2026-11-05T10:00:00.000Z',
  actor: { id: U1, name: 'Ana' },
};
const entry = <T extends ActivityEntry['type']>(type: T, data: Variant[T]) =>
  ({ ...base, type, data }) as unknown as ActivityEntry;

const cases: Record<ActivityEntry['type'], [ActivityEntry, string]> = {
  created: [
    entry('created', { title: 'A', column: { columnId: C1, columnName: 'To do' } }),
    'Ana created this card in To do',
  ],
  title_changed: [
    entry('title_changed', { from: 'A', to: 'B' }),
    'Ana changed the title from “A” to “B”',
  ],
  description_changed: [
    entry('description_changed', { from: 0, to: 12 }),
    'Ana edited the description (0 to 12 characters)',
  ],
  deleted: [entry('deleted', { title: 'A' }), 'Ana deleted this card'],
  column_deleted_moved: [
    entry('column_deleted_moved', {
      from: { columnId: C1, columnName: 'Old' },
      to: { columnId: C2, columnName: 'In progress' },
    }),
    'Ana deleted the column “Old”, which moved this card to In progress',
  ],
  moved: [
    entry('moved', { fromColumnId: C1, toColumnId: C2 }),
    'Ana moved this card from To do to In progress',
  ],
  assignee_changed: [
    entry('assignee_changed', { from: null, to: U2 }),
    'Ana assigned this card to Bo',
  ],
  priority_changed: [
    entry('priority_changed', { from: 'none', to: 'high' }),
    'Ana changed the priority from none to high',
  ],
  estimate_changed: [
    entry('estimate_changed', { from: null, to: 5 }),
    'Ana changed the estimate from no estimate to 5 points',
  ],
  sprint_added: [
    entry('sprint_added', { sprintId: S1, sprintName: 'Sprint 1' }),
    'Ana added this card to Sprint 1',
  ],
  sprint_removed: [
    entry('sprint_removed', { sprintId: S1, sprintName: 'Sprint 1' }),
    'Ana removed this card from Sprint 1',
  ],
  labels_changed: [
    entry('labels_changed', { added: [{ id: S1, name: 'Bug' }], removed: [] }),
    'Ana added label “Bug”',
  ],
};

describe('describeActivity', () => {
  it('has a case for every activity type', () => {
    expect(Object.keys(cases).sort()).toEqual([...ACTIVITY_TYPES].sort());
  });

  it.each(Object.entries(cases))('renders %s', (_type, [event, text]) => {
    expect(describeActivity(event, names)).toBe(text);
  });

  it('handles unassigning, reassigning and former members', () => {
    expect(describeActivity(entry('assignee_changed', { from: U2, to: null }), names)).toBe(
      'Ana unassigned Bo from this card',
    );
    expect(describeActivity(entry('assignee_changed', { from: U2, to: U1 }), names)).toBe(
      'Ana reassigned this card from Bo to a former member',
    );
  });

  it('describes added and removed labels together', () => {
    expect(
      describeActivity(
        entry('labels_changed', {
          added: [
            { id: S1, name: 'Bug' },
            { id: C1, name: 'UI' },
          ],
          removed: [{ id: C2, name: 'Old' }],
        }),
        names,
      ),
    ).toBe('Ana added labels “Bug”, “UI” and removed label “Old”');
  });

  it('names a deleted column and the system removal on sprint close', () => {
    expect(describeActivity(entry('moved', { fromColumnId: C1, toColumnId: U1 }), names)).toContain(
      'to a deleted column',
    );
    expect(
      describeActivity(
        entry('sprint_removed', { sprintId: S1, sprintName: 'Sprint 1', reason: 'sprint_closed' }),
        names,
      ),
    ).toBe('Sprint 1 was closed and this card went back to the backlog');
  });

  it('never shows description text, only lengths', () => {
    const text = describeActivity(entry('description_changed', { from: 3, to: 4 }), names);
    expect(text).toBe('Ana edited the description (3 to 4 characters)');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-11-05T12:00:00.000Z');
  it.each([
    ['2026-11-05T11:59:40.000Z', 'just now'],
    ['2026-11-05T11:55:00.000Z', '5 min ago'],
    ['2026-11-05T10:00:00.000Z', '2 h ago'],
    ['2026-11-04T11:00:00.000Z', '1 day ago'],
    ['2026-11-01T12:00:00.000Z', '4 days ago'],
    ['2026-09-01T12:00:00.000Z', '2026-09-01'],
  ])('%s is %s', (iso, text) => {
    expect(formatRelativeTime(iso, now)).toBe(text);
  });

  it('formats the absolute date in UTC', () => {
    expect(formatAbsoluteTime('2026-11-05T10:03:59.000Z')).toBe('2026-11-05 10:03 UTC');
  });
});
