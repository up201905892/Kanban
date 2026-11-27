# Deployment (Railway)

Topology and reasons: `docs/adr/0005-deployment-topology.md`. One Docker container serves the web app, `/api` and `/ws` on one origin; PostgreSQL is the Railway database service in the same project. **Run exactly one instance** (Yjs rooms live in memory) and keep app sleeping off.

Agents prepare the files; João connects and runs the deploy. Nothing here has been deployed.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile`, `.dockerignore` | Production image (Node 22, pnpm through corepack, production dependencies only, non-root user, `node dist/server.js`). |
| `railway.json` | Config as code: Dockerfile builder, healthcheck `/health/ready`, pre-deploy `prisma migrate deploy`, restart on failure, 1 replica. |
| `docs/deploy/railway-deploy.yml` | Proposed GitHub Actions workflow. João copies it to `.github/workflows/` (agents cannot). |

## Variables

Set these on the Railway **app service** (Variables tab). Never commit real values.

| Name | Required | Example | Where it comes from |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | `${{Postgres.DATABASE_URL}}` | Reference to the Railway PostgreSQL service. Prefer the private-network URL (`DATABASE_PRIVATE_URL`-style reference, host `*.railway.internal`) so traffic stays inside the project. |
| `SESSION_SECRET` | yes | output of `openssl rand -hex 32` | Generate once; at least 32 characters. Changing it does not log users out (sessions are database rows) but keep it secret. |
| `WEB_ORIGIN` | yes | `https://kanban-production.up.railway.app` | The public URL of the service, exactly `https://host` with no path or trailing slash. Must be https in production (checked at start-up). Used for the Origin check on state-changing requests and WebSocket upgrades, and for the CSP. |
| `NODE_ENV` | set by the image | `production` | Baked into the image; makes cookies `Secure`. |
| `TRUST_PROXY` | yes on Railway | `1` | Number of proxies in front of the app whose `X-Forwarded-For` is trusted. Railway has one. Default 0 (off): the header is ignored. Without it every user shares the proxy's IP and the login rate limit becomes global. Must be a non-negative integer (at most 32). |
| `PORT` | provided by Railway | `8080` | Railway injects it; the image defaults to 8080. |
| `HOST` | no | `0.0.0.0` | Baked into the image. |
| `WEB_DIST_DIR` | set by the image | `/app/web` | Directory of the built web app. |
| `LOG_LEVEL` | no | `info` | Pino level. |

`.env.example` lists the same names with fake values for local use.

## Railway setup

1. In a new Railway project, add a **PostgreSQL** database service.
2. Add a service from this GitHub repository (branch `main`). Railway reads `railway.json` and builds the `Dockerfile`; do not set a custom start command (the image starts `node` directly so SIGTERM reaches the process).
3. Set the variables above. For `DATABASE_URL` use a variable reference to the PostgreSQL service and its private-network host.
4. Under **Settings**: Serverless (app sleeping) **off**; replicas **1** (`railway.json` also says 1); region as close to the users as possible, and the database in the same region.
5. Generate a public domain, then set `WEB_ORIGIN` to it and redeploy. A custom domain and DNS are out of scope: when added, update `WEB_ORIGIN` first.
6. Deploy. The sequence per deploy is: build image, **pre-deploy** `prisma migrate deploy` (a failure stops the deploy and the old container keeps running), start the container, healthcheck `GET /health/ready` (database reachable), switch traffic.
7. Create the first account through the sign-up page. A forgotten password is reset with the CLI: open a shell in the service and run `node dist/cli/reset-password.js <email>` (the compiled version of the CLI in `docs/api.md`; `tsx` is a development dependency and is not in the image). This was not run in a container by the agents.

Redeploys: the old container gets SIGTERM, flushes pending collaborative edits, closes sockets with code 1012 (clients reconnect and re-sync) and exits 0. If the logs of the old container contain `could not be saved before shutdown`, the database was unreachable at that moment and the last edits of that document were lost (ADR 0004 section 9).

## Verify the image locally

Agents have no permission for `docker build`, so this step is for João. It uses the compose database.

```sh
pnpm db:up
docker build -t kanban .
docker images kanban --format '{{.Size}}'      # record the size here
docker run --rm --network host \
  -e DATABASE_URL=postgresql://kanban:kanban@localhost:5432/kanban \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e WEB_ORIGIN=http://localhost:8080 \
  -e PORT=8080 \
  kanban
```

Open `http://localhost:8080` (production mode accepts an http origin on localhost only; the cookie is still `Secure`, which browsers allow on localhost). Apply migrations first if the database is new: `pnpm db:migrate`, or run the pre-deploy command in the image:
`docker run --rm --network host -e DATABASE_URL=... kanban node node_modules/prisma/build/index.js migrate deploy`.

Smoke test the running container with the browser tests:

```sh
pnpm test:e2e:setup
BASE_URL=http://localhost:8080 pnpm test:e2e --grep @smoke
```

`BASE_URL` makes Playwright skip its own development servers. Check graceful shutdown with `docker stop <container>`: the log shows `shutting down` and the exit code is 0 (`docker inspect --format '{{.State.ExitCode}}' <container>` on a container started without `--rm`).

Image size: _not recorded yet (docker build was not available to the agents); record it here after the first build._

What was verified without Docker: the production layout (`pnpm deploy --prod --legacy`, `prisma migrate deploy` from the deployed folder, `node dist/server.js` with `WEB_DIST_DIR`, `TRUST_PROXY` and a production `NODE_ENV`) served the app, the SPA fallback and the A1 404, and exited 0 on SIGTERM.

## Backups

- **Railway backups:** enable scheduled backups on the PostgreSQL service where the plan offers them (Service, Backups tab). They cover the collaborative documents too, because they live in the same database (ADR 0004).
- **Manual `pg_dump`** (portable, keep at least one copy off Railway). Use the public connection URL of the database (`DATABASE_PUBLIC_URL`) from your machine; the PostgreSQL client tools must be the same major version as the server (17).

```sh
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_PUBLIC_URL" -f kanban-$(date +%F).dump
```

- **Restore into an empty database** (a new Railway database, or a local one for a drill):

```sh
createdb kanban_restore
pg_restore --no-owner --no-privileges --exit-on-error -d kanban_restore kanban-YYYY-MM-DD.dump
psql kanban_restore -c 'select count(*) from _prisma_migrations'   # matches the source
```

  To restore into production, point the service's `DATABASE_URL` at the restored database (or restore into the existing one after stopping the service) and redeploy; the pre-deploy step applies any migration newer than the dump.
- Restoring brings back at most everything up to the last stored batch; after a crash, up to the last 500 ms of description edits can be missing (ADR 0004 section 9).
- **Drill:** the dump and restore commands were not run by the agents (no permission for them in this environment). Run the drill once against a throwaway database before relying on it, and note the date here.

## Rollback

1. **Application only:** in Railway, Deployments, pick the last good deployment and **Redeploy** it. The database is not touched.
2. **A bad migration:** Prisma migrations are forward-only. Fix forward with a new migration. If data was damaged, stop the service, restore the last good backup (see above), then redeploy a version whose migrations match the backup (migrations not in the dump are re-applied by the pre-deploy step, so redeploy the old image only if its schema matches).
3. **Bad configuration:** restore the previous value in Variables; Railway redeploys.
4. A failed pre-deploy or healthcheck leaves the previous deployment running; read the deployment logs before doing anything else.
