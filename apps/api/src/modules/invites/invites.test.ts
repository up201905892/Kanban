import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acceptInviteResponseSchema,
  apiErrorSchema,
  createInviteResponseSchema,
  inviteListResponseSchema,
  invitePreviewSchema,
  memberListResponseSchema,
  memberResponseSchema,
  workspaceResponseSchema,
} from '@kanban/shared';
import { buildApp } from '../../app.js';
import { createPrismaClient } from '../../db.js';
import { TEST_ORIGIN, createUserAndLogin, type TestUser } from '../../test-utils/auth.js';
import { resetDatabase } from '../../test-utils/reset-database.js';

const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase(prisma);
  app = buildApp({ prisma, webOrigin: TEST_ORIGIN });
  await app.ready();
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  who?: TestUser,
  body?: object,
) {
  return app.inject({
    method,
    url,
    headers: who ? who.headers : { origin: TEST_ORIGIN },
    ...(body ? { payload: body } : {}),
  });
}

async function setup() {
  const [owner, member, viewer, outsider] = await Promise.all([
    createUserAndLogin(app, { name: 'Olivia' }),
    createUserAndLogin(app, { name: 'Mark' }),
    createUserAndLogin(app, { name: 'Vera' }),
    createUserAndLogin(app, { name: 'Eve' }),
  ]);
  const res = await call('POST', '/api/workspaces', owner, { name: 'Acme' });
  const workspace = workspaceResponseSchema.parse(res.json()).workspace;
  await prisma.membership.createMany({
    data: [
      { workspaceId: workspace.id, userId: member.user.id, role: 'member' },
      { workspaceId: workspace.id, userId: viewer.user.id, role: 'viewer' },
    ],
  });
  return { owner, member, viewer, outsider, workspace };
}

async function invite(
  who: TestUser,
  workspaceId: string,
  body: object = { role: 'viewer', expiresInDays: 7 },
) {
  const res = await call('POST', `/api/workspaces/${workspaceId}/invites`, who, body);
  expect(res.statusCode).toBe(201);
  const parsed = createInviteResponseSchema.parse(res.json());
  const token = parsed.link.split('/invite/')[1] ?? '';
  return { ...parsed, token };
}

const errorOf = (res: { json: () => unknown }) => apiErrorSchema.parse(res.json()).error;

describe('POST /api/workspaces/:wid/invites', () => {
  it('creates an invite and returns the link once (201), storing only a hash', async () => {
    const { owner, workspace } = await setup();
    const res = await call('POST', `/api/workspaces/${workspace.id}/invites`, owner, {
      role: 'member',
      expiresInDays: 3,
      maxUses: 5,
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = createInviteResponseSchema.parse(res.json());
    expect(body.link).toMatch(new RegExp(`^${TEST_ORIGIN}/invite/[\\w-]{43}$`));
    expect(body.invite).toMatchObject({ role: 'member', maxUses: 5, uses: 0 });
    const days =
      (Date.parse(body.invite.expiresAt) - Date.parse(body.invite.createdAt)) / 86_400_000;
    expect(days).toBeCloseTo(3, 1);

    const token = body.link.split('/invite/')[1] ?? '';
    const row = await prisma.invite.findUniqueOrThrow({ where: { id: body.invite.id } });
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // The list never contains the link or the token.
    const list = await call('GET', `/api/workspaces/${workspace.id}/invites`, owner);
    expect(JSON.stringify(list.json())).not.toContain(token);
  });

  it.each([
    [{ role: 'owner', expiresInDays: 7 }],
    [{ role: 'member', expiresInDays: 0 }],
    [{ role: 'member', expiresInDays: 31 }],
    [{ role: 'member', expiresInDays: 7, maxUses: 0 }],
    [{ role: 'member' }],
    [{ role: 'member', expiresInDays: 7, uses: 3 }],
  ])('rejects invalid body %j (400)', async (body) => {
    const { owner, workspace } = await setup();
    const res = await call('POST', `/api/workspaces/${workspace.id}/invites`, owner, body);
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_ERROR');
  });

  it('401 without a session, 404 for a non-member, 403 for member and viewer', async () => {
    const { member, viewer, outsider, workspace } = await setup();
    const url = `/api/workspaces/${workspace.id}/invites`;
    const body = { role: 'viewer', expiresInDays: 7 };
    expect((await call('POST', url, undefined, body)).statusCode).toBe(401);
    const hidden = await call('POST', url, outsider, body);
    expect(hidden.statusCode).toBe(404);
    const unknown = await call(
      'POST',
      '/api/workspaces/0192f000-0000-7000-8000-000000000099/invites',
      outsider,
      body,
    );
    expect(hidden.json()).toEqual(unknown.json());
    expect((await call('POST', url, member, body)).statusCode).toBe(403);
    expect((await call('POST', url, viewer, body)).statusCode).toBe(403);
  });
});

describe('GET /api/workspaces/:wid/invites and DELETE /api/invites/:id', () => {
  it('lists only active invites to owners; others get 403 or 404', async () => {
    const { owner, member, outsider, workspace } = await setup();
    const keep = await invite(owner, workspace.id);
    const revoked = await invite(owner, workspace.id);
    const exhausted = await invite(owner, workspace.id, {
      role: 'viewer',
      expiresInDays: 1,
      maxUses: 1,
    });
    const expired = await invite(owner, workspace.id);
    await call('DELETE', `/api/invites/${revoked.invite.id}`, owner);
    await prisma.invite.update({ where: { id: exhausted.invite.id }, data: { uses: 1 } });
    await prisma.invite.update({
      where: { id: expired.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const url = `/api/workspaces/${workspace.id}/invites`;
    const res = await call('GET', url, owner);
    expect(res.statusCode).toBe(200);
    expect(inviteListResponseSchema.parse(res.json()).invites.map((i) => i.id)).toEqual([
      keep.invite.id,
    ]);
    expect((await call('GET', url, member)).statusCode).toBe(403);
    expect((await call('GET', url, outsider)).statusCode).toBe(404);
    expect((await call('GET', url)).statusCode).toBe(401);
  });

  it('revokes (204), is idempotent and then the link is invalid', async () => {
    const { owner, workspace } = await setup();
    const made = await invite(owner, workspace.id);
    expect((await call('DELETE', `/api/invites/${made.invite.id}`, owner)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/invites/${made.invite.id}`, owner)).statusCode).toBe(204);
    const res = await call('GET', `/api/invites/${made.token}`);
    expect(res.statusCode).toBe(404);
    expect(errorOf(res).code).toBe('INVITE_INVALID');
  });

  it('403 for a member, identical 404 for a non-member and an unknown id, 401 anonymous', async () => {
    const { owner, member, outsider, workspace } = await setup();
    const made = await invite(owner, workspace.id);
    const url = `/api/invites/${made.invite.id}`;
    expect((await call('DELETE', url, member)).statusCode).toBe(403);
    const hidden = await call('DELETE', url, outsider);
    const unknown = await call(
      'DELETE',
      '/api/invites/0192f000-0000-7000-8000-000000000099',
      outsider,
    );
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual(unknown.json());
    expect((await call('DELETE', url)).statusCode).toBe(401);
    // Still active after all the refused attempts.
    expect((await call('GET', `/api/invites/${made.token}`)).statusCode).toBe(200);
  });
});

describe('GET /api/invites/:token (public preview)', () => {
  it('shows workspace name, role and expiry without a session', async () => {
    const { owner, workspace } = await setup();
    const made = await invite(owner, workspace.id, { role: 'member', expiresInDays: 2 });
    const res = await call('GET', `/api/invites/${made.token}`);
    expect(res.statusCode).toBe(200);
    expect(invitePreviewSchema.parse(res.json())).toEqual({
      workspaceName: 'Acme',
      role: 'member',
      expiresAt: made.invite.expiresAt,
    });
  });

  it('gives the identical 404 INVITE_INVALID for unknown, expired, revoked and exhausted', async () => {
    const { owner, workspace } = await setup();
    const expired = await invite(owner, workspace.id);
    const revoked = await invite(owner, workspace.id);
    const exhausted = await invite(owner, workspace.id, {
      role: 'viewer',
      expiresInDays: 1,
      maxUses: 1,
    });
    await prisma.invite.update({
      where: { id: expired.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await call('DELETE', `/api/invites/${revoked.invite.id}`, owner);
    await prisma.invite.update({ where: { id: exhausted.invite.id }, data: { uses: 1 } });

    const bodies = [];
    for (const token of ['nope', expired.token, revoked.token, exhausted.token]) {
      const res = await call('GET', `/api/invites/${token}`);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('INVITE_INVALID');
      bodies.push(res.json());
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });
});

describe('POST /api/invites/:token/accept', () => {
  it('creates the membership with the invited role (200) and counts the use', async () => {
    const { owner, outsider, workspace } = await setup();
    const made = await invite(owner, workspace.id, { role: 'member', expiresInDays: 7 });
    const res = await call('POST', `/api/invites/${made.token}/accept`, outsider);
    expect(res.statusCode).toBe(200);
    expect(acceptInviteResponseSchema.parse(res.json()).workspaceId).toBe(workspace.id);
    const membership = await prisma.membership.findFirstOrThrow({
      where: { workspaceId: workspace.id, userId: outsider.user.id },
    });
    expect(membership.role).toBe('member');
    expect((await prisma.invite.findUniqueOrThrow({ where: { id: made.invite.id } })).uses).toBe(1);
    // The new member now sees the workspace.
    expect((await call('GET', `/api/workspaces/${workspace.id}`, outsider)).statusCode).toBe(200);
  });

  it('401 without a session, 404 INVITE_INVALID for every invalid token', async () => {
    const { owner, outsider, workspace } = await setup();
    const made = await invite(owner, workspace.id);
    expect((await call('POST', `/api/invites/${made.token}/accept`)).statusCode).toBe(401);
    const unknown = await call('POST', '/api/invites/nope/accept', outsider);
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown).code).toBe('INVITE_INVALID');
    await call('DELETE', `/api/invites/${made.invite.id}`, owner);
    const revoked = await call('POST', `/api/invites/${made.token}/accept`, outsider);
    expect(revoked.json()).toEqual(unknown.json());
    expect(await prisma.membership.count({ where: { userId: outsider.user.id } })).toBe(0);
  });

  it('keeps the role and the use counter of someone who is already a member', async () => {
    const { owner, member, workspace } = await setup();
    const made = await invite(owner, workspace.id, { role: 'viewer', expiresInDays: 7 });
    for (const who of [member, owner]) {
      const res = await call('POST', `/api/invites/${made.token}/accept`, who);
      expect(res.statusCode).toBe(200);
      expect(acceptInviteResponseSchema.parse(res.json()).workspaceId).toBe(workspace.id);
    }
    const roles = await prisma.membership.findMany({
      where: { workspaceId: workspace.id, userId: { in: [member.user.id, owner.user.id] } },
      orderBy: { role: 'asc' },
    });
    expect(roles.map((m) => m.role).sort()).toEqual(['member', 'owner']);
    expect((await prisma.invite.findUniqueOrThrow({ where: { id: made.invite.id } })).uses).toBe(0);
  });

  it('two parallel accepts on maxUses=1 create exactly one membership', async () => {
    const { owner, workspace } = await setup();
    const made = await invite(owner, workspace.id, {
      role: 'viewer',
      expiresInDays: 1,
      maxUses: 1,
    });
    const [a, b] = await Promise.all([
      createUserAndLogin(app, { name: 'A' }),
      createUserAndLogin(app, { name: 'B' }),
    ]);
    const results = await Promise.all([
      call('POST', `/api/invites/${made.token}/accept`, a),
      call('POST', `/api/invites/${made.token}/accept`, b),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    expect(
      await prisma.membership.count({
        where: { workspaceId: workspace.id, userId: { in: [a.user.id, b.user.id] } },
      }),
    ).toBe(1);
    expect((await prisma.invite.findUniqueOrThrow({ where: { id: made.invite.id } })).uses).toBe(1);
  });

  it('the same user accepting twice in parallel uses the invite once', async () => {
    const { owner, outsider, workspace } = await setup();
    const made = await invite(owner, workspace.id);
    const results = await Promise.all([
      call('POST', `/api/invites/${made.token}/accept`, outsider),
      call('POST', `/api/invites/${made.token}/accept`, outsider),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect((await prisma.invite.findUniqueOrThrow({ where: { id: made.invite.id } })).uses).toBe(1);
    expect(await prisma.membership.count({ where: { userId: outsider.user.id } })).toBe(1);
  });
});

describe('members', () => {
  it('lists members for any role, 404 for a non-member', async () => {
    const { owner, member, viewer, outsider, workspace } = await setup();
    const url = `/api/workspaces/${workspace.id}/members`;
    for (const who of [owner, member, viewer]) {
      const res = await call('GET', url, who);
      expect(res.statusCode).toBe(200);
      const { members } = memberListResponseSchema.parse(res.json());
      expect(members.map((m) => [m.name, m.role])).toEqual([
        ['Olivia', 'owner'],
        ['Mark', 'member'],
        ['Vera', 'viewer'],
      ]);
    }
    const hidden = await call('GET', url, outsider);
    expect(hidden.statusCode).toBe(404);
    expect((await call('GET', url)).statusCode).toBe(401);
    expect(JSON.stringify(hidden.json())).not.toContain('Olivia');
  });

  it('changes a role as owner; 403 for member and viewer; 404 for non-member and non-target', async () => {
    const { owner, member, viewer, outsider, workspace } = await setup();
    const url = `/api/workspaces/${workspace.id}/members/${viewer.user.id}`;
    const ok = await call('PATCH', url, owner, { role: 'member' });
    expect(ok.statusCode).toBe(200);
    expect(memberResponseSchema.parse(ok.json()).member.role).toBe('member');
    expect((await call('PATCH', url, member, { role: 'owner' })).statusCode).toBe(403);
    expect((await call('PATCH', url, viewer, { role: 'owner' })).statusCode).toBe(403);
    expect((await call('PATCH', url, outsider, { role: 'owner' })).statusCode).toBe(404);
    expect((await call('PATCH', url, undefined, { role: 'owner' })).statusCode).toBe(401);
    expect((await call('PATCH', url, owner, { role: 'admin' })).statusCode).toBe(400);
    const notMember = await call(
      'PATCH',
      `/api/workspaces/${workspace.id}/members/${outsider.user.id}`,
      owner,
      { role: 'member' },
    );
    expect(notMember.statusCode).toBe(404);
  });

  it('refuses to demote, remove or leave as the last owner (409 LAST_OWNER)', async () => {
    const { owner, workspace } = await setup();
    const url = `/api/workspaces/${workspace.id}/members/${owner.user.id}`;
    for (const res of [
      await call('PATCH', url, owner, { role: 'member' }),
      await call('DELETE', url, owner),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).code).toBe('LAST_OWNER');
    }
    expect(
      (await call('PATCH', url, owner, { role: 'owner' })).statusCode,
      'same role is fine',
    ).toBe(200);
  });

  it('allows the owner to step down once another owner exists', async () => {
    const { owner, member, workspace } = await setup();
    const base = `/api/workspaces/${workspace.id}/members`;
    expect(
      (await call('PATCH', `${base}/${member.user.id}`, owner, { role: 'owner' })).statusCode,
    ).toBe(200);
    expect(
      (await call('PATCH', `${base}/${owner.user.id}`, owner, { role: 'viewer' })).statusCode,
    ).toBe(200);
    // Mark is now the last owner.
    const res = await call('DELETE', `${base}/${member.user.id}`, member);
    expect(res.statusCode).toBe(409);
  });

  it('two owners demoting each other at once leave exactly one owner', async () => {
    const { owner, member, workspace } = await setup();
    const base = `/api/workspaces/${workspace.id}/members`;
    await call('PATCH', `${base}/${member.user.id}`, owner, { role: 'owner' });
    const results = await Promise.all([
      call('PATCH', `${base}/${member.user.id}`, owner, { role: 'viewer' }),
      call('PATCH', `${base}/${owner.user.id}`, member, { role: 'viewer' }),
    ]);
    // The loser was demoted by the winner, so it is no longer allowed to manage members.
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    expect(
      await prisma.membership.count({ where: { workspaceId: workspace.id, role: 'owner' } }),
    ).toBe(1);
  });

  it('owner removes a member (204) and the member loses access at once (404)', async () => {
    const { owner, member, workspace } = await setup();
    const project = await call('POST', `/api/workspaces/${workspace.id}/projects`, member, {
      name: 'Made by Mark',
      key: 'MM',
    });
    expect(project.statusCode).toBe(201);
    const url = `/api/workspaces/${workspace.id}/members/${member.user.id}`;
    expect((await call('DELETE', url, owner)).statusCode).toBe(204);
    // Same session, no access any more.
    expect((await call('GET', `/api/workspaces/${workspace.id}`, member)).statusCode).toBe(404);
    expect((await call('GET', '/api/auth/me', member)).statusCode).toBe(200);
    // What they created stays.
    const projects = await call('GET', `/api/workspaces/${workspace.id}/projects`, owner);
    expect(JSON.stringify(projects.json())).toContain('Made by Mark');
  });

  it('only owners remove others (403 member and viewer); a member may leave (204 then 404)', async () => {
    const { owner, member, viewer, workspace } = await setup();
    const base = `/api/workspaces/${workspace.id}/members`;
    expect((await call('DELETE', `${base}/${viewer.user.id}`, member)).statusCode).toBe(403);
    expect((await call('DELETE', `${base}/${owner.user.id}`, viewer)).statusCode).toBe(403);
    expect((await call('DELETE', `${base}/${member.user.id}`, member)).statusCode).toBe(204);
    expect((await call('GET', `/api/workspaces/${workspace.id}`, member)).statusCode).toBe(404);
    expect((await call('DELETE', `${base}/${viewer.user.id}`, viewer)).statusCode).toBe(204);
    expect((await call('DELETE', `${base}/${viewer.user.id}`, viewer)).statusCode).toBe(404);
  });

  it('a non-member cannot remove anyone and learns nothing (identical 404)', async () => {
    const { member, outsider, workspace } = await setup();
    const real = await call(
      'DELETE',
      `/api/workspaces/${workspace.id}/members/${member.user.id}`,
      outsider,
    );
    const fake = await call(
      'DELETE',
      '/api/workspaces/0192f000-0000-7000-8000-000000000099/members/0192f000-0000-7000-8000-000000000098',
      outsider,
    );
    expect(real.statusCode).toBe(404);
    expect(real.json()).toEqual(fake.json());
  });
});
