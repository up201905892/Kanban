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
import { projectRoutes } from './modules/projects/routes.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';

export interface AppOptions {
  /** Database client. Without it only the unauthenticated health routes exist (tests). */
  prisma?: PrismaClient;
  /** Allowed `Origin` for state-changing requests; defaults to `WEB_ORIGIN` or the Vite dev origin. */
  webOrigin?: string;
  /** Log destination; defaults to stdout. Used by tests to capture log lines. */
  logStream?: { write(line: string): void };
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
    registerAuthGuard(app, {
      prisma: options.prisma,
      webOrigin: normalizeOrigin(
        options.webOrigin ?? process.env['WEB_ORIGIN'] ?? 'http://localhost:5173',
      ),
      nodeEnv,
    });
    void app.register(authRoutes({ prisma: options.prisma, nodeEnv }));
    void app.register(workspaceRoutes({ prisma: options.prisma }));
    void app.register(projectRoutes({ prisma: options.prisma }));
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
