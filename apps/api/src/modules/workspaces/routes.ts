import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ErrorCode,
  createWorkspaceRequestSchema,
  deleteWorkspaceRequestSchema,
  updateWorkspaceRequestSchema,
  workspaceListResponseSchema,
  workspaceParamsSchema,
  workspaceResponseSchema,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  renameWorkspace,
} from './service.js';

export function workspaceRoutes({ prisma }: { prisma: PrismaClient }) {
  return async (app: FastifyInstance): Promise<void> => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    // requireAuth (global guard) guarantees the user; this only narrows the type.
    const userOf = (req: { user: { id: string } | null }) => {
      if (!req.user) throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
      return req.user;
    };

    r.post(
      '/api/workspaces',
      {
        schema: { body: createWorkspaceRequestSchema, response: { 201: workspaceResponseSchema } },
      },
      async (req, reply) => {
        const workspace = await createWorkspace(prisma, userOf(req), req.body.name);
        return reply.code(201).send({ workspace });
      },
    );

    r.get(
      '/api/workspaces',
      { schema: { response: { 200: workspaceListResponseSchema } } },
      async (req) => ({ workspaces: await listWorkspaces(prisma, userOf(req)) }),
    );

    r.get(
      '/api/workspaces/:id',
      { schema: { params: workspaceParamsSchema, response: { 200: workspaceResponseSchema } } },
      async (req) => ({ workspace: await getWorkspace(prisma, userOf(req), req.params.id) }),
    );

    r.patch(
      '/api/workspaces/:id',
      {
        schema: {
          params: workspaceParamsSchema,
          body: updateWorkspaceRequestSchema,
          response: { 200: workspaceResponseSchema },
        },
      },
      async (req) => ({
        workspace: await renameWorkspace(prisma, userOf(req), req.params.id, req.body.name),
      }),
    );

    r.delete(
      '/api/workspaces/:id',
      {
        schema: {
          params: workspaceParamsSchema,
          body: deleteWorkspaceRequestSchema,
          response: { 204: z.null() },
        },
      },
      async (req, reply) => {
        await deleteWorkspace(prisma, userOf(req), req.params.id, req.body.confirmName);
        return reply.code(204).send(null);
      },
    );
  };
}
