import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ErrorCode,
  memberListResponseSchema,
  memberParamsSchema,
  memberResponseSchema,
  updateMemberRequestSchema,
  workspaceScopedParamsSchema,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import { changeMemberRole, listMembers, removeMember } from './service.js';

export function memberRoutes({ prisma }: { prisma: PrismaClient }) {
  return async (app: FastifyInstance): Promise<void> => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    // requireAuth (global guard) guarantees the user; this only narrows the type.
    const userOf = (req: { user: { id: string } | null }) => {
      if (!req.user) throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
      return req.user;
    };

    r.get(
      '/api/workspaces/:wid/members',
      {
        schema: {
          params: workspaceScopedParamsSchema,
          response: { 200: memberListResponseSchema },
        },
      },
      async (req) => ({ members: await listMembers(prisma, userOf(req), req.params.wid) }),
    );

    r.patch(
      '/api/workspaces/:wid/members/:userId',
      {
        schema: {
          params: memberParamsSchema,
          body: updateMemberRequestSchema,
          response: { 200: memberResponseSchema },
        },
      },
      async (req) => ({
        member: await changeMemberRole(
          prisma,
          userOf(req),
          req.params.wid,
          req.params.userId,
          req.body.role,
        ),
      }),
    );

    r.delete(
      '/api/workspaces/:wid/members/:userId',
      { schema: { params: memberParamsSchema, response: { 204: z.null() } } },
      async (req, reply) => {
        await removeMember(prisma, userOf(req), req.params.wid, req.params.userId);
        return reply.code(204).send(null);
      },
    );
  };
}
