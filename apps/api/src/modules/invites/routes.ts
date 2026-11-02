import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ErrorCode,
  acceptInviteResponseSchema,
  createInviteRequestSchema,
  createInviteResponseSchema,
  inviteListResponseSchema,
  inviteParamsSchema,
  invitePreviewSchema,
  inviteTokenParamsSchema,
  workspaceScopedParamsSchema,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import {
  acceptInvite,
  createInvite,
  listActiveInvites,
  previewInvite,
  revokeInvite,
} from './service.js';

export function inviteRoutes({ prisma, webOrigin }: { prisma: PrismaClient; webOrigin: string }) {
  return async (app: FastifyInstance): Promise<void> => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    // requireAuth (global guard) guarantees the user; this only narrows the type.
    const userOf = (req: { user: { id: string } | null }) => {
      if (!req.user) throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
      return req.user;
    };

    r.post(
      '/api/workspaces/:wid/invites',
      {
        schema: {
          params: workspaceScopedParamsSchema,
          body: createInviteRequestSchema,
          response: { 201: createInviteResponseSchema },
        },
      },
      async (req, reply) => {
        const created = await createInvite(
          prisma,
          userOf(req),
          req.params.wid,
          req.body,
          webOrigin,
        );
        // The link is a credential: never cache it.
        return reply.header('cache-control', 'no-store').code(201).send(created);
      },
    );

    r.get(
      '/api/workspaces/:wid/invites',
      {
        schema: {
          params: workspaceScopedParamsSchema,
          response: { 200: inviteListResponseSchema },
        },
      },
      async (req) => ({ invites: await listActiveInvites(prisma, userOf(req), req.params.wid) }),
    );

    r.delete(
      '/api/invites/:id',
      { schema: { params: inviteParamsSchema, response: { 204: z.null() } } },
      async (req, reply) => {
        await revokeInvite(prisma, userOf(req), req.params.id);
        return reply.code(204).send(null);
      },
    );

    // Public (see PUBLIC_ROUTES): the unguessable token is the credential.
    r.get(
      '/api/invites/:token',
      {
        schema: { params: inviteTokenParamsSchema, response: { 200: invitePreviewSchema } },
      },
      async (req, reply) => {
        const preview = await previewInvite(prisma, req.params.token);
        return reply.header('cache-control', 'no-store').send(preview);
      },
    );

    r.post(
      '/api/invites/:token/accept',
      {
        schema: { params: inviteTokenParamsSchema, response: { 200: acceptInviteResponseSchema } },
      },
      async (req) => acceptInvite(prisma, userOf(req), req.params.token),
    );
  };
}
