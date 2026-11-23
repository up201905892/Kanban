import { randomUUID } from 'node:crypto';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { ErrorCode } from '@kanban/shared';
import type { PrismaClient } from './db.js';
import { serializeError } from './lib/app-error.js';
import { normalizeOrigin } from './lib/origin-check.js';
import { webAppNotFound } from './lib/web-static.js';
import { warmDummyHash } from './modules/auth/password.js';
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
import { sprintRoutes } from './modules/sprints/routes.js';
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
  /**
   * Reverse proxies whose `X-Forwarded-For` is trusted (`TRUST_PROXY`). 0 (default) ignores the
   * header, so `request.ip` is the socket address.
   */
  trustProxy?: number;
  /** Directory with the built web app to serve with an SPA fallback (`WEB_DIST_DIR`). */
  webDistDir?: string;
  /** Registers extra routes (used by tests for test-only routes). */
  registerRoutes?: (app: FastifyInstance) => void | Promise<void>;
}

/** Largest accepted request body. Cards and descriptions are far smaller (G6). */
export const BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * Content-Security-Policy for the single-origin app: scripts and styles from the same origin
 * (React sets inline style attributes, hence `'unsafe-inline'` for styles only), and the
 * WebSocket on the same host. The explicit ws(s) origin covers browsers that do not treat
 * `'self'` as matching WebSocket schemes.
 */
export function contentSecurityPolicy(webOrigin: string): Record<string, string[] | null> {
  const url = new URL(webOrigin);
  const secure = url.protocol === 'https:';
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", `${secure ? 'wss' : 'ws'}://${url.host}`],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    ...(secure ? { 'upgrade-insecure-requests': [] } : {}),
  };
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
    bodyLimit: BODY_LIMIT_BYTES,
    // A hop count N trusts the N proxies closest to the api (same as Fastify's numeric form).
    trustProxy:
      options.trustProxy && options.trustProxy > 0
        ? (_address: string, hop: number) => hop < (options.trustProxy ?? 0)
        : false,
  });

  const webOrigin = normalizeOrigin(
    options.webOrigin ?? process.env['WEB_ORIGIN'] ?? 'http://localhost:5173',
  );
  const secureOrigin = webOrigin.startsWith('https:');
  void app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: contentSecurityPolicy(webOrigin) },
    // HSTS only makes sense (and is only honoured) over https.
    strictTransportSecurity: secureOrigin ? { maxAge: 15552000, includeSubDomains: true } : false,
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

  const jsonNotFound = (_req: unknown, reply: FastifyReply) =>
    reply.code(404).send({ error: { code: ErrorCode.NOT_FOUND, message: 'Resource not found' } });
  app.setNotFoundHandler(
    options.webDistDir ? webAppNotFound(app, options.webDistDir, jsonNotFound) : jsonNotFound,
  );

  const nodeEnv = process.env['NODE_ENV'];
  if (options.prisma) {
    // Compute the unknown-email dummy hash before the server listens (KB-005 observation).
    app.addHook('onReady', async () => {
      await warmDummyHash();
    });
    registerAuthGuard(app, { prisma: options.prisma, webOrigin, nodeEnv });
    void app.register(inviteRoutes({ prisma: options.prisma, webOrigin }));
    void app.register(memberRoutes({ prisma: options.prisma }));
    void app.register(authRoutes({ prisma: options.prisma, nodeEnv }));
    void app.register(workspaceRoutes({ prisma: options.prisma }));
    void app.register(projectRoutes({ prisma: options.prisma }));
    void app.register(boardRoutes({ prisma: options.prisma }));
    void app.register(cardRoutes({ prisma: options.prisma }));
    void app.register(sprintRoutes({ prisma: options.prisma }));
    // Documents live in PostgreSQL unless a test injects another persistence hook (KB-017).
    const realtimeOptions: RealtimeOptions = {
      ...options.realtime,
      rooms: { log: app.log, ...options.realtime?.rooms },
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
