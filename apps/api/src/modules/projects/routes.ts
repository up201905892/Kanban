import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ErrorCode,
  createProjectRequestSchema,
  projectListResponseSchema,
  projectParamsSchema,
  projectResponseSchema,
  updateProjectRequestSchema,
  workspaceProjectsParamsSchema,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  renameProject,
} from './service.js';

export function projectRoutes({ prisma }: { prisma: PrismaClient }) {
  return async (app: FastifyInstance): Promise<void> => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    // requireAuth (global guard) guarantees the user; this only narrows the type.
    const userOf = (req: { user: { id: string } | null }) => {
      if (!req.user) throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
      return req.user;
    };

    r.post(
      '/api/workspaces/:wid/projects',
      {
        schema: {
          params: workspaceProjectsParamsSchema,
          body: createProjectRequestSchema,
          response: { 201: projectResponseSchema },
        },
      },
      async (req, reply) => {
        const project = await createProject(prisma, userOf(req), req.params.wid, req.body);
        return reply.code(201).send({ project });
      },
    );

    r.get(
      '/api/workspaces/:wid/projects',
      {
        schema: {
          params: workspaceProjectsParamsSchema,
          response: { 200: projectListResponseSchema },
        },
      },
      async (req) => ({ projects: await listProjects(prisma, userOf(req), req.params.wid) }),
    );

    r.get(
      '/api/projects/:pid',
      { schema: { params: projectParamsSchema, response: { 200: projectResponseSchema } } },
      async (req) => ({ project: await getProject(prisma, userOf(req), req.params.pid) }),
    );

    r.patch(
      '/api/projects/:pid',
      {
        schema: {
          params: projectParamsSchema,
          body: updateProjectRequestSchema,
          response: { 200: projectResponseSchema },
        },
      },
      async (req) => ({
        project: await renameProject(prisma, userOf(req), req.params.pid, req.body.name),
      }),
    );

    r.delete(
      '/api/projects/:pid',
      { schema: { params: projectParamsSchema, response: { 204: z.null() } } },
      async (req, reply) => {
        await deleteProject(prisma, userOf(req), req.params.pid);
        return reply.code(204).send(null);
      },
    );
  };
}
