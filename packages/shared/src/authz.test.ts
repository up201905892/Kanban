import { describe, expect, it } from 'vitest';
import { ACTIONS, ROLES, ROLE_PERMISSIONS, can, type Action, type Role } from './authz.js';

/** The matrix of ADR 0003, written out in full so a change must be deliberate. */
const MATRIX: Record<Action, Record<Role, boolean>> = {
  'workspace:read': { owner: true, member: true, viewer: true },
  'card:edit': { owner: true, member: true, viewer: false },
  'board:manage': { owner: true, member: true, viewer: false },
  'project:manage': { owner: true, member: true, viewer: false },
  'project:delete': { owner: true, member: false, viewer: false },
  'members:manage': { owner: true, member: false, viewer: false },
  'workspace:update': { owner: true, member: false, viewer: false },
  'workspace:delete': { owner: true, member: false, viewer: false },
};

describe('authorization matrix', () => {
  it('lists every action of the ADR', () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(MATRIX).sort());
  });

  const cases = ACTIONS.flatMap((action) =>
    ROLES.map((role) => [role, action, MATRIX[action][role]] as const),
  );

  it.each(cases)('%s / %s -> %s', (role, action, expected) => {
    expect(can(role, action)).toBe(expected);
  });

  it('gives the owner every permission and the viewer read only', () => {
    expect(ROLE_PERMISSIONS.owner.size).toBe(ACTIONS.length);
    expect([...ROLE_PERMISSIONS.viewer]).toEqual(['workspace:read']);
  });

  it('never grants a member more than the owner', () => {
    for (const action of ROLE_PERMISSIONS.member) expect(can('owner', action)).toBe(true);
    for (const action of ROLE_PERMISSIONS.viewer) expect(can('member', action)).toBe(true);
  });
});
