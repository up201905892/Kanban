import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { readyResponseSchema } from '@kanban/shared';
import { z } from 'zod';
import type { PrismaClient } from '../../db.js';
import { checkDatabase } from './service.js';

const healthResponseSchema = z.object({ status: z.literal('ok') });

/** Reference module: routes validate through shared schemas and delegate to the service. */
export function healthRoutes(prisma: PrismaClient | undefined) {
  return async (app: FastifyInstance): Promise<void> => {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.get('/health', { schema: { response: { 200: healthResponseSchema } } }, async () => ({
      status: 'ok' as const,
    }));

    r.get(
      '/health/ready',
      { schema: { response: { 200: readyResponseSchema, 503: readyResponseSchema } } },
      async (req, reply) => {
        const result = await checkDatabase(prisma);
        if (result.db === 'ok') return result;
        req.log.warn('readiness check failed');
        return reply.code(503).send(result);
      },
    );
  };
}
