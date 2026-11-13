import { describe, expect, it } from 'vitest';
import { CARD_PRIORITIES, type Member } from '@kanban/shared';
import { PRIORITY_DISPLAY, assignableMembers, initialsOf, priorityDisplay } from './fields';

describe('priorityDisplay', () => {
  it('gives every priority an icon and a text label', () => {
    for (const priority of CARD_PRIORITIES) {
      const { icon, label } = priorityDisplay(priority);
      expect(icon.length).toBeGreaterThan(0);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('uses distinct icons and labels so colour is never needed', () => {
    const all = Object.values(PRIORITY_DISPLAY);
    expect(new Set(all.map((p) => p.icon)).size).toBe(all.length);
    expect(new Set(all.map((p) => p.label)).size).toBe(all.length);
  });

  it('maps the known values', () => {
    expect(priorityDisplay('urgent')).toEqual({ icon: '!!', label: 'Urgent' });
    expect(priorityDisplay('none').label).toBe('No priority');
  });
});

describe('initialsOf', () => {
  it('takes the first letters of the first and last words', () => {
    expect(initialsOf('Olivia')).toBe('O');
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('  Mary  Jane  Watson ')).toBe('MW');
  });

  it('handles an empty name', () => {
    expect(initialsOf('   ')).toBe('?');
  });
});

describe('assignableMembers', () => {
  it('drops viewers', () => {
    const base = { name: 'N', email: 'e@x.io', joinedAt: '2026-11-05T10:00:00.000Z' };
    const members: Member[] = [
      { ...base, userId: '1', role: 'owner' },
      { ...base, userId: '2', role: 'member' },
      { ...base, userId: '3', role: 'viewer' },
    ];
    expect(assignableMembers(members).map((m) => m.userId)).toEqual(['1', '2']);
  });
});
