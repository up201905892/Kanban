import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCode } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import { isOriginAllowed } from '../../lib/origin-check.js';
import { getSessionFromCookieHeader, type AuthSession, type AuthUser } from './session.js';
import { SESSION_COOKIE_NAME, readCookie, serializeSessionCookie } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireAuth` on every non-public route. */
    user: AuthUser | null;
    authSession: AuthSession | null;
  }
}

/** Routes that do not need a session. Everything else is authenticated by default. */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'GET /health',
  'GET /health/ready',
  'POST /api/auth/signup',
  'POST /api/auth/login',
]);

export const routeKey = (method: string, url: string): string =>
  `${method === 'HEAD' ? 'GET' : method} ${url}`;

export interface GuardOptions {
  prisma: PrismaClient;
  /** Normalised allowed origin (`scheme://host[:port]`). */
  webOrigin: string;
  nodeEnv: string | undefined;
}

/** Rejects unauthenticated requests with 401 and exposes `request.user`. */
export function createRequireAuth(options: GuardOptions) {
  return async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const result = await getSessionFromCookieHeader(options.prisma, req.headers.cookie);
    if (!result) {
      throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    req.user = result.user;
    req.authSession = result.session;
    if (result.session.renewed) {
      const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME) ?? '';
      reply.header(
        'set-cookie',
        serializeSessionCookie(token, result.session.expiresAt, options.nodeEnv),
      );
    }
  };
}

/**
 * Installs the global guard: Origin check for state-changing requests (A3), then
 * authentication for every route not listed in `PUBLIC_ROUTES`.
 */
export function registerAuthGuard(app: FastifyInstance, options: GuardOptions): void {
  const requireAuth = createRequireAuth(options);
  app.decorateRequest('user', null);
  app.decorateRequest('authSession', null);

  app.addHook('preValidation', async (req, reply) => {
    // No route matched: the not-found handler answers 404 and exposes nothing.
    if (req.is404) return;
    if (!isOriginAllowed(req.method, req.headers.origin, options.webOrigin)) {
      throw new AppError(403, ErrorCode.CSRF_REJECTED, 'Request origin not allowed');
    }
    if (PUBLIC_ROUTES.has(routeKey(req.method, req.routeOptions.url ?? ''))) return;
    await requireAuth(req, reply);
  });
}
