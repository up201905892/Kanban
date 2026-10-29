import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ErrorCode,
  authResponseSchema,
  loginRequestSchema,
  signupRequestSchema,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import { RateLimiter } from '../../lib/rate-limiter.js';
import { deleteSession, type AuthUser } from './session.js';
import { login, signup } from './service.js';
import { serializeClearedSessionCookie, serializeSessionCookie } from './tokens.js';

export interface AuthRoutesOptions {
  prisma: PrismaClient;
  nodeEnv: string | undefined;
  /** Attempts allowed per IP + email per window (default 10 per minute). */
  rateLimiter?: RateLimiter;
}

export const AUTH_RATE_LIMIT = 10;
export const AUTH_RATE_WINDOW_MS = 60_000;

const toUserResponse = (user: AuthUser) => ({
  user: { ...user, createdAt: user.createdAt.toISOString() },
});

export function authRoutes({ prisma, nodeEnv, rateLimiter }: AuthRoutesOptions) {
  const limiter = rateLimiter ?? new RateLimiter(AUTH_RATE_LIMIT, AUTH_RATE_WINDOW_MS);

  return async (app: FastifyInstance): Promise<void> => {
    const r = app.withTypeProvider<ZodTypeProvider>();

    const throttle = (
      scope: string,
      ip: string,
      email: string,
      reply: { header(name: string, value: string): unknown },
    ): void => {
      const result = limiter.hit(`${scope}|${ip}|${email}`);
      if (!result.allowed) {
        reply.header('retry-after', String(result.retryAfterSeconds));
        throw new AppError(429, ErrorCode.RATE_LIMITED, 'Too many attempts, try again later');
      }
    };

    r.post(
      '/api/auth/signup',
      { schema: { body: signupRequestSchema, response: { 201: authResponseSchema } } },
      async (req, reply) => {
        throttle('signup', req.ip, req.body.email, reply);
        const { user, token, expiresAt } = await signup(prisma, req.body);
        reply.header('set-cookie', serializeSessionCookie(token, expiresAt, nodeEnv));
        return reply.code(201).send(toUserResponse(user));
      },
    );

    r.post(
      '/api/auth/login',
      { schema: { body: loginRequestSchema, response: { 200: authResponseSchema } } },
      async (req, reply) => {
        throttle('login', req.ip, req.body.email, reply);
        const { user, token, expiresAt } = await login(prisma, req.body);
        reply.header('set-cookie', serializeSessionCookie(token, expiresAt, nodeEnv));
        return toUserResponse(user);
      },
    );

    r.post('/api/auth/logout', { schema: { response: { 204: z.null() } } }, async (req, reply) => {
      if (req.authSession) await deleteSession(prisma, req.authSession.id);
      reply.header('set-cookie', serializeClearedSessionCookie(nodeEnv));
      return reply.code(204).send(null);
    });

    r.get('/api/auth/me', { schema: { response: { 200: authResponseSchema } } }, async (req) => {
      // requireAuth guarantees the user; the guard below only narrows the type.
      if (!req.user) throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
      return toUserResponse(req.user);
    });
  };
}
