import Fastify, { type FastifyInstance } from 'fastify';
import type { ReadyResponse } from '@kanban/shared';
import type { PrismaClient } from './db.js';

export interface AppOptions {
  prisma?: PrismaClient;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: process.env['NODE_ENV'] !== 'test' });

  app.get('/health', async () => ({ status: 'ok' as const }));

  app.get('/health/ready', async (_req, reply) => {
    try {
      if (!options.prisma) throw new Error('database not configured');
      await options.prisma.$queryRaw`SELECT 1`;
      return { db: 'ok' } satisfies ReadyResponse;
    } catch (err) {
      app.log.warn({ err }, 'readiness check failed');
      return reply.code(503).send({ db: 'unavailable' } satisfies ReadyResponse);
    }
  });

  return app;
}
