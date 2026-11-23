import { statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Paths that belong to the api: they never fall back to the web app. */
const API_PREFIXES = ['/api', '/ws', '/health'];

const isApiPath = (path: string): boolean =>
  API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const decodePath = (url: string): string | null => {
  try {
    return decodeURIComponent(url.split('?')[0] ?? '/');
  } catch {
    return null;
  }
};

type NotFoundHandler = (req: FastifyRequest, reply: FastifyReply) => unknown;

/**
 * Prepares serving of the built web app from `dir` on the same origin as `/api` and `/ws`, and
 * returns a not-found handler: real files are sent as they are, every other GET/HEAD page path
 * gets `index.html` (SPA fallback). Anything under the api prefixes, other methods and missing
 * files with an extension keep the A1 JSON 404.
 *
 * It lives in the not-found handler so it never competes with the api routes and needs no
 * session (the auth guard skips unmatched routes). Throws when `dir` has no `index.html`.
 */
export function webAppNotFound(
  app: FastifyInstance,
  dir: string,
  jsonNotFound: NotFoundHandler,
): NotFoundHandler {
  const root = resolve(dir);
  if (!isFile(resolve(root, 'index.html'))) {
    throw new Error(`WEB_DIST_DIR has no index.html: ${root}`);
  }
  // `serve: false` only adds `reply.sendFile`; routes stay under our control.
  void app.register(fastifyStatic, { root, serve: false, cacheControl: false });

  return (req, reply) => {
    const path = decodePath(req.raw.url ?? '/');
    if (path === null || (req.method !== 'GET' && req.method !== 'HEAD') || isApiPath(path)) {
      return jsonNotFound(req, reply);
    }
    const relative = path.replace(/^\/+/, '');
    const candidate = resolve(root, relative);
    if (candidate !== root && !candidate.startsWith(root + sep)) return jsonNotFound(req, reply);

    if (relative !== '' && isFile(candidate)) {
      // Vite fingerprints everything under /assets/, so it can be cached for good.
      reply.header(
        'cache-control',
        relative.startsWith('assets/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
      );
      return reply.sendFile(relative);
    }
    // A missing file (it has an extension) is a real 404, not a page.
    if (/\.[a-z0-9]+$/i.test(relative)) return jsonNotFound(req, reply);
    reply.header('cache-control', 'no-cache');
    return reply.sendFile('index.html');
  };
}
