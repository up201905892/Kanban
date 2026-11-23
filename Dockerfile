# syntax=docker/dockerfile:1
#
# Production image (KB-031, docs/deployment.md). One container serves the web app, /api and /ws.
#   docker build -t kanban .
#   docker run --rm -p 8080:8080 --env-file .env.production kanban
#
# Exactly one instance may run: Yjs rooms live in memory (ADR 0005).

# ---- build: install everything, build shared + api + web, keep production dependencies only ----
FROM node:22-slim AS build
ENV CI=true
WORKDIR /repo
# pnpm comes from the `packageManager` field of package.json (corepack).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install

COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm build \
 && pnpm --filter @kanban/api deploy --prod --legacy /out/api \
 && rm -rf /out/api/src \
 # pnpm skips the Prisma install scripts, so fetch the schema engine now: the pre-deploy
 # `prisma migrate deploy` then needs no network access.
 && cd /out/api && node node_modules/prisma/build/index.js version

# ---- runtime ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    WEB_DIST_DIR=/app/web
# The Prisma schema engine (used by `prisma migrate deploy`) needs OpenSSL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/api
COPY --from=build --chown=node:node /out/api /app/api
COPY --from=build --chown=node:node /repo/apps/web/dist /app/web
USER node
EXPOSE 8080
# Exec form: node is PID 1 and receives SIGTERM itself, so the graceful shutdown (pending
# collaborative edits flushed, sockets closed with 1012) runs on every redeploy.
CMD ["node", "dist/server.js"]
