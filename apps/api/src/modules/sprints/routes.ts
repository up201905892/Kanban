import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ErrorCode,
  burndownResponseSchema,
  closeSprintResponseSchema,
  createSprintRequestSchema,
  projectSprintsParamsSchema,
  sprintListQuerySchema,
  sprintListResponseSchema,
  sprintParamsSchema,
  sprintResponseSchema,
  updateSprintRequestSchema,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import { mutationMetaOf } from '../../lib/board-events.js';
import { getBurndown } from './burndown.js';
import { closeSprint, createSprint, listSprints, startSprint, updateSprint } from './service.js';

export function sprintRoutes({ prisma }: { prisma: PrismaClient }) {
  return async (app: FastifyInstance): Promise<void> => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    // requireAuth (global guard) guarantees the user; this only narrows the type.
    const userOf = (req: { user: { id: string } | null }) => {
      if (!req.user) throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
      return req.user;
    };

    r.post(
      '/api/projects/:pid/sprints',
      {
        schema: {
          params: projectSprintsParamsSchema,
          body: createSprintRequestSchema,
          response: { 200: sprintResponseSchema, 201: sprintResponseSchema },
        },
      },
      async (req, reply) => {
        const { sprint, created } = await createSprint(
          prisma,
          userOf(req),
          req.params.pid,
          req.body,
          mutationMetaOf(req),
        );
        return reply.code(created ? 201 : 200).send({ sprint });
      },
    );

    r.get(
      '/api/projects/:pid/sprints',
      {
        schema: {
          params: projectSprintsParamsSchema,
          querystring: sprintListQuerySchema,
          response: { 200: sprintListResponseSchema },
        },
      },
      async (req) => listSprints(prisma, userOf(req), req.params.pid, req.query),
    );

    r.patch(
      '/api/sprints/:id',
      {
        schema: {
          params: sprintParamsSchema,
          body: updateSprintRequestSchema,
          response: { 200: sprintResponseSchema },
        },
      },
      async (req) => ({
        sprint: await updateSprint(
          prisma,
          userOf(req),
          req.params.id,
          req.body,
          mutationMetaOf(req),
        ),
      }),
    );

    r.post(
      '/api/sprints/:id/start',
      { schema: { params: sprintParamsSchema, response: { 200: sprintResponseSchema } } },
      async (req) => ({
        sprint: await startSprint(prisma, userOf(req), req.params.id, mutationMetaOf(req)),
      }),
    );

    r.get(
      '/api/sprints/:id/burndown',
      { schema: { params: sprintParamsSchema, response: { 200: burndownResponseSchema } } },
      async (req) => getBurndown(prisma, userOf(req), req.params.id),
    );

    r.post(
      '/api/sprints/:id/close',
      { schema: { params: sprintParamsSchema, response: { 200: closeSprintResponseSchema } } },
      async (req) => closeSprint(prisma, userOf(req), req.params.id, mutationMetaOf(req)),
    );
  };
}
