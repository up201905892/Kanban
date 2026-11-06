import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ErrorCode,
  cardParamsSchema,
  cardResponseSchema,
  columnCardsParamsSchema,
  createCardRequestSchema,
  moveCardRequestSchema,
  updateCardRequestSchema,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import { createCard, deleteCard, getCard, moveCard, updateCard } from './service.js';

export function cardRoutes({ prisma }: { prisma: PrismaClient }) {
  return async (app: FastifyInstance): Promise<void> => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    // requireAuth (global guard) guarantees the user; this only narrows the type.
    const userOf = (req: { user: { id: string } | null }) => {
      if (!req.user) throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
      return req.user;
    };

    r.post(
      '/api/columns/:cid/cards',
      {
        schema: {
          params: columnCardsParamsSchema,
          body: createCardRequestSchema,
          response: { 200: cardResponseSchema, 201: cardResponseSchema },
        },
      },
      async (req, reply) => {
        const { card, created } = await createCard(prisma, userOf(req), req.params.cid, req.body);
        return reply.code(created ? 201 : 200).send({ card });
      },
    );

    r.get(
      '/api/cards/:id',
      { schema: { params: cardParamsSchema, response: { 200: cardResponseSchema } } },
      async (req) => ({ card: await getCard(prisma, userOf(req), req.params.id) }),
    );

    r.patch(
      '/api/cards/:id',
      {
        schema: {
          params: cardParamsSchema,
          body: updateCardRequestSchema,
          response: { 200: cardResponseSchema },
        },
      },
      async (req) => ({
        card: await updateCard(prisma, userOf(req), req.params.id, req.body),
      }),
    );

    r.post(
      '/api/cards/:id/move',
      {
        schema: {
          params: cardParamsSchema,
          body: moveCardRequestSchema,
          response: { 200: cardResponseSchema },
        },
      },
      async (req) => ({
        card: await moveCard(prisma, userOf(req), req.params.id, req.body),
      }),
    );

    r.delete(
      '/api/cards/:id',
      { schema: { params: cardParamsSchema, response: { 204: z.null() } } },
      async (req, reply) => {
        await deleteCard(prisma, userOf(req), req.params.id);
        return reply.code(204).send(null);
      },
    );
  };
}
