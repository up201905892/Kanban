import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ErrorCode,
  cardParamsSchema,
  cardResponseSchema,
  createLabelRequestSchema,
  labelListResponseSchema,
  labelParamsSchema,
  labelResponseSchema,
  projectLabelsParamsSchema,
  setCardLabelsRequestSchema,
  updateLabelRequestSchema,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import { mutationMetaOf } from '../../lib/board-events.js';
import { createLabel, deleteLabel, listLabels, setCardLabels, updateLabel } from './service.js';

export function labelRoutes({ prisma }: { prisma: PrismaClient }) {
  return async (app: FastifyInstance): Promise<void> => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    // requireAuth (global guard) guarantees the user; this only narrows the type.
    const userOf = (req: { user: { id: string } | null }) => {
      if (!req.user) throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
      return req.user;
    };

    r.post(
      '/api/projects/:pid/labels',
      {
        schema: {
          params: projectLabelsParamsSchema,
          body: createLabelRequestSchema,
          response: { 200: labelResponseSchema, 201: labelResponseSchema },
        },
      },
      async (req, reply) => {
        const { label, created } = await createLabel(
          prisma,
          userOf(req),
          req.params.pid,
          req.body,
          mutationMetaOf(req),
        );
        return reply.code(created ? 201 : 200).send({ label });
      },
    );

    r.get(
      '/api/projects/:pid/labels',
      {
        schema: {
          params: projectLabelsParamsSchema,
          response: { 200: labelListResponseSchema },
        },
      },
      async (req) => listLabels(prisma, userOf(req), req.params.pid),
    );

    r.patch(
      '/api/labels/:id',
      {
        schema: {
          params: labelParamsSchema,
          body: updateLabelRequestSchema,
          response: { 200: labelResponseSchema },
        },
      },
      async (req) => ({
        label: await updateLabel(prisma, userOf(req), req.params.id, req.body, mutationMetaOf(req)),
      }),
    );

    r.delete(
      '/api/labels/:id',
      { schema: { params: labelParamsSchema, response: { 204: z.null() } } },
      async (req, reply) => {
        await deleteLabel(prisma, userOf(req), req.params.id, mutationMetaOf(req));
        return reply.code(204).send(null);
      },
    );

    r.put(
      '/api/cards/:id/labels',
      {
        schema: {
          params: cardParamsSchema,
          body: setCardLabelsRequestSchema,
          response: { 200: cardResponseSchema },
        },
      },
      async (req) => ({
        card: await setCardLabels(
          prisma,
          userOf(req),
          req.params.id,
          req.body,
          mutationMetaOf(req),
        ),
      }),
    );
  };
}
