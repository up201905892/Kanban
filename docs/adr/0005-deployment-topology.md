# 0005 · Deployment topology

- **Status:** Accepted
- **Date:** 2026-11-23
- **Task:** KB-031
- **Technical decisions:** D4 (Railway, one Docker container plus managed PostgreSQL, decided by João on 2026-10-21) in `docs/workflow/01-planning.md`. Builds on ADR 0002 (cookies), ADR 0004 section 10 (single instance) and section 9 (graceful shutdown).

## Context

The app is one Node process (Fastify) with long-lived WebSocket connections and in-memory Yjs rooms, plus PostgreSQL. It must run on Railway, behind Railway's HTTP proxy, with the browser seeing a single origin so the session cookie needs no CORS.

## Decision

1. **One container, one origin.** The api serves the built web app (`apps/web/dist`) as well as `/api`, `/ws` and `/health*`. Real files are sent as they are (`/assets/*` with a one-year immutable cache, since Vite fingerprints them), every other `GET`/`HEAD` page path gets `index.html` (SPA fallback, `no-cache`). The fallback lives in the not-found handler, so it never competes with an api route and needs no session. Paths under `/api`, `/ws` and `/health`, other methods and missing files with an extension keep the A1 JSON `404`. The directory comes from `WEB_DIST_DIR`; without it (development, tests) the api serves no web files and Vite keeps serving the web app and proxying `/api` and `/ws`.
2. **Image.** `Dockerfile` at the root, two stages on `node:22-slim`. The build stage uses pnpm from the `packageManager` field through corepack, installs with the frozen lockfile, runs `pnpm build` and `pnpm deploy --prod --legacy` to produce the api with production dependencies only (`prisma` is a production dependency because the pre-deploy command needs its CLI; the schema engine is fetched at build time). The runtime stage adds OpenSSL (needed by the schema engine), copies the api and the web build, runs as the non-root `node` user and starts with `CMD ["node", "dist/server.js"]` (exec form, no shell), so `node` is PID 1 and receives SIGTERM directly. The graceful shutdown of ADR 0004 section 9 therefore runs on every redeploy. A process-level test (`process-shutdown.integration.test.ts`) sends a real SIGTERM to the built server and checks exit code 0, close code `1012` and the stored edit.
3. **Migrations.** `railway.json` runs `node node_modules/prisma/build/index.js migrate deploy` as the pre-deploy command: it runs once per deploy, before the new container takes traffic, and a failure stops the deploy. No migration runs at application start.
4. **Exactly one replica, no sleeping.** Yjs rooms and the in-process event buses live in one process (ADR 0004 section 10). `railway.json` sets `numReplicas` to 1 and the runbook requires app sleeping to be off (it is a service setting, not part of config as code). Zero-downtime overlap between the old and the new container during a deploy is brief and acceptable: a room can exist in both for seconds, the old one flushes and closes its sockets with `1012`, clients reconnect and re-sync, and Yjs merges.
5. **Proxy.** Railway terminates TLS and forwards `X-Forwarded-For`. `TRUST_PROXY` is a hop count (default 0, off). With it on, Fastify trusts that many proxies counted from the socket, so `request.ip`, the rate-limit key of ADR 0002, is the client address and a spoofed leftmost `X-Forwarded-For` entry does not count. With it off the header is ignored. The value for Railway is `1`.
6. **Cookies and origin.** In production the session cookie is `Secure`, and the configuration refuses a `WEB_ORIGIN` that is not `https` (plain `http` is allowed only for `localhost` and `127.0.0.1`, to try the image on a developer machine; browsers accept `Secure` cookies on localhost). `WEB_ORIGIN` is also the only origin accepted for state-changing requests and WebSocket upgrades.
7. **Headers and limits.** `@fastify/helmet` on every response. The CSP allows only the same origin for scripts, styles, images, fonts and connections, plus the explicit `ws(s)://<host>` of `WEB_ORIGIN` for the WebSocket; styles also allow `'unsafe-inline'` because React writes inline `style` attributes; there is no `unsafe-eval`, no inline script, `object-src 'none'` and `frame-ancestors 'none'`. HSTS and `upgrade-insecure-requests` are sent only when `WEB_ORIGIN` is https. The request body limit is 1 MiB (the WebSocket limit is already 1 MiB). A body over the limit answers the existing framework-level `400` in the A1 format.
8. **Start-up.** The argon2 hash used to equalise unknown-email logins is computed in an `onReady` hook, before the server listens, so the first such login after a deploy is as slow as any other.
9. **Health.** The healthcheck path is `/health/ready` (database reachable). `/health` stays a pure liveness answer.

## Alternatives considered

- *Separate static hosting for the web app.* Rejected: a second origin needs CORS and `SameSite=None` cookies, and the WebSocket would still need the api host.
- *A reverse proxy (nginx, Caddy) in the container.* Rejected: a second process and a shell-style entrypoint, so SIGTERM handling gets harder; the api serves a small static bundle well enough.
- *`migrate deploy` in the start command.* Rejected: it needs a shell wrapper and a failing migration would crash-loop the service instead of stopping the deploy.
- *`@fastify/static` as a plain route.* Rejected: its routes would go through the auth guard; the not-found handler needs no exception list.

## Consequences

- The web app and the api always ship together and are versioned as one image.
- Scaling out needs the Redis path of ADR 0004 section 10 first.
- A database outage keeps unsaved edits in memory (ADR 0004 section 9, KB-037); if it lasts through a redeploy, the shutdown gives them up after its deadline and logs `could not be saved before shutdown`. The runbook tells João to look for that line after a redeploy.
- The image build and `docker run` were not executed by the agents (no permission for `docker build`); the layout the Dockerfile produces was reproduced step by step without Docker and the verification is handed to João (`docs/deployment.md`, "Verify the image locally").
