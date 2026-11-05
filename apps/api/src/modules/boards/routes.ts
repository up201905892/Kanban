import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ErrorCode,
  boardParamsSchema,
  boardResponseSchema,
  columnParamsSchema,
  columnResponseSchema,
  createColumnRequestSchema,
  deleteColumnQuerySchema,
  projectBoardParamsSchema,
  updateColumnRequestSchema,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import { createColumn, deleteColumn, getBoard, updateColumn } from './service.js';

export function boardRoutes({ prisma }: { prisma: PrismaClient }) {
  return async (app: FastifyInstance): Promise<void> => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    // requireAuth (global guard) guarantees the user; this only narrows the type.
    const userOf = (req: { user: { id: string } | null }) => {
      if (!req.user) throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
      return req.user;
    };

    r.get(
      '/api/projects/:pid/board',
      { schema: { params: projectBoardParamsSchema, response: { 200: boardResponseSchema } } },
      async (req) => getBoard(prisma, userOf(req), req.params.pid),
    );

    r.post(
      '/api/boards/:bid/columns',
      {
        schema: {
          params: boardParamsSchema,
          body: createColumnRequestSchema,
          response: { 200: columnResponseSchema, 201: columnResponseSchema },
        },
      },
      async (req, reply) => {
        const { column, created } = await createColumn(
          prisma,
          userOf(req),
          req.params.bid,
          req.body,
        );
        return reply.code(created ? 201 : 200).send({ column });
      },
    );

    r.patch(
      '/api/columns/:id',
      {
        schema: {
          params: columnParamsSchema,
          body: updateColumnRequestSchema,
          response: { 200: columnResponseSchema },
        },
      },
      async (req) => ({ column: await updateColumn(prisma, userOf(req), req.params.id, req.body) }),
    );

    r.delete(
      '/api/columns/:id',
      {
        schema: {
          params: columnParamsSchema,
          querystring: deleteColumnQuerySchema,
          response: { 204: z.null() },
        },
      },
      async (req, reply) => {
        await deleteColumn(prisma, userOf(req), req.params.id, req.query.moveCardsTo);
        return reply.code(204).send(null);
      },
    );
  };
}
