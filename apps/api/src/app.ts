import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { ErrorCode } from '@kanban/shared';
import type { PrismaClient } from './db.js';
import { serializeError } from './lib/app-error.js';
import { normalizeOrigin } from './lib/origin-check.js';
import { registerAuthGuard } from './modules/auth/guard.js';
import { authRoutes } from './modules/auth/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { inviteRoutes } from './modules/invites/routes.js';
import { memberRoutes } from './modules/members/routes.js';
import { boardRoutes } from './modules/boards/routes.js';
import { cardRoutes } from './modules/cards/routes.js';
import { createRealtime, realtimeRoutes, type RealtimeOptions } from './modules/realtime/routes.js';
import { createDescriptionPersistence } from './modules/realtime/description.js';
import { createPrismaDocumentStore, createYjsPersistence } from './modules/realtime/persistence.js';
import { projectRoutes } from './modules/projects/routes.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';

export interface AppOptions {
  /** Database client. Without it only the unauthenticated health routes exist (tests). */
  prisma?: PrismaClient;
  /** Allowed `Origin` for state-changing requests; defaults to `WEB_ORIGIN` or the Vite dev origin. */
  webOrigin?: string;
  /** Log destination; defaults to stdout. Used by tests to capture log lines. */
  logStream?: { write(line: string): void };
  /** WebSocket layer options (persistence hook, heartbeat interval). */
  realtime?: RealtimeOptions;
  /** Registers extra routes (used by tests for test-only routes). */
  registerRoutes?: (app: FastifyInstance) => void | Promise<void>;
}

/** Paths whose values must never reach the logs. */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  '*.password',
];

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const silent = process.env['NODE_ENV'] === 'test' && !options.logStream;
  const app = Fastify({
    logger: silent
      ? false
      : {
          level: process.env['LOG_LEVEL'] ?? 'info',
          redact: { paths: LOG_REDACT_PATHS, censor: '[Redacted]' },
          ...(options.logStream ? { stream: options.logStream } : {}),
        },
    genReqId: () => randomUUID(),
    requestIdHeader: false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    const { statusCode, body, unexpected } = serializeError(err);
    if (unexpected) req.log.error({ err }, 'unhandled error');
    return reply.code(statusCode).send(body);
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: ErrorCode.NOT_FOUND, message: 'Resource not found' } }),
  );

  const nodeEnv = process.env['NODE_ENV'];
  if (options.prisma) {
    const webOrigin = normalizeOrigin(
      options.webOrigin ?? process.env['WEB_ORIGIN'] ?? 'http://localhost:5173',
    );
    registerAuthGuard(app, { prisma: options.prisma, webOrigin, nodeEnv });
    void app.register(inviteRoutes({ prisma: options.prisma, webOrigin }));
    void app.register(memberRoutes({ prisma: options.prisma }));
    void app.register(authRoutes({ prisma: options.prisma, nodeEnv }));
    void app.register(workspaceRoutes({ prisma: options.prisma }));
    void app.register(projectRoutes({ prisma: options.prisma }));
    void app.register(boardRoutes({ prisma: options.prisma }));
    void app.register(cardRoutes({ prisma: options.prisma }));
    // Documents live in PostgreSQL unless a test injects another persistence hook (KB-017).
    const realtimeOptions: RealtimeOptions = {
      ...options.realtime,
      persistence:
        options.realtime?.persistence ??
        createDescriptionPersistence(
          options.prisma,
          createYjsPersistence(createPrismaDocumentStore(options.prisma), { log: app.log }),
          { log: app.log },
        ),
    };
    const realtime = createRealtime(realtimeOptions);
    app.decorate('realtime', realtime);
    void app.register(
      realtimeRoutes({
        prisma: options.prisma,
        webOrigin,
        realtime,
        options: realtimeOptions,
      }),
    );
  }

  void app.register(healthRoutes(options.prisma));
  const extra = options.registerRoutes;
  if (extra) {
    void app.register(async (instance) => {
      await extra(instance);
    });
  }

  return app;
}
