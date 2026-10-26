# 02 · Development

Implementation record. Only the `developer` writes here. One entry per task; if a task comes back failed from testing, a new **Iteration** is added to the same entry.

Entry rule: the task must be `Planned` in `01-planning.md` and every dependency `Done`.

## Entries

<!--
Entry template:

### KB-000 · Title (same as Planning)

**Iteration 1 — YYYY-MM-DD**
- **Status at the end:** Ready for test
- **What was done:** 2–4 line summary
- **Changed files:** list of paths
- **Migrations:** names (or "none")
- **Commit(s):** short hash + message
- **Acceptance criteria covered:** which ones and where (file or test)
- **Tests written by the developer:** test files created/changed
- **Local checks:** build ✔ · lint ✔ · typecheck ✔ · test ✔ · test:e2e ✔ / n.a.
- **Notes for the tester:** how to verify, known edge cases

**Iteration 2 — YYYY-MM-DD** (only if failed)
- **Failures received:** reference to the report in 03-testing.md
- **Fixes:** …
-->

### KB-001 · Monorepo scaffold and tooling

**Iteration 1 — 2026-10-26**

- **Status at the end:** Ready for test
- **What was done:** Created the pnpm monorepo (`apps/web` React + Vite, `apps/api` Fastify, `packages/shared` built to `dist` with declarations, all consumed through `workspace:*`). Added strict base tsconfig (`strict`, `noUncheckedIndexedAccess`), ESLint flat config, Prettier, root scripts, `GET /health` and a web placeholder rendering `APP_NAME` from `@kanban/shared`.
- **Changed files:** `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.nvmrc`, `.gitignore`, `.prettierrc.json`, `.prettierignore`, `eslint.config.js`, `tsconfig.base.json`, `packages/shared/**`, `apps/api/**`, `apps/web/**`
- **Migrations:** none
- **Commit(s):** `34bb1ee` feat(shared): KB-001 scaffold pnpm monorepo with web, api and shared packages
- **Acceptance criteria covered:** root config and lockfile (`package.json`, `pnpm-workspace.yaml`, `.nvmrc`); three packages; base tsconfig; root scripts; `/health` (`apps/api/src/health.test.ts`) and shared constant in web (`apps/web/src/App.test.tsx`); `.gitignore`; G1, G9.
- **Tests written by the developer:** `packages/shared/src/slugify.test.ts`, `apps/api/src/health.test.ts`, `apps/web/src/App.test.tsx`
- **Local checks:** build ✔ · lint ✔ · typecheck ✔ · test ✔ · test:e2e n.a.
- **New dependencies (G9):** root dev: typescript ~6.0, eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, globals, prettier, vitest, @types/node. api: fastify; dev tsx, vitest, @types/node. web: react, react-dom; dev vite, @vitejs/plugin-react, vitest, jsdom, @testing-library/{react,dom,jest-dom}, @types/react, @types/react-dom. shared: dev vitest.
- **Notes for the tester:**
  - Run `pnpm install --frozen-lockfile`, then `pnpm build` before `typecheck`/`test` (web and api resolve `@kanban/shared` from its `dist`).
  - TypeScript is pinned to `~6.0` because `typescript-eslint` does not yet support TypeScript 7 (the latest).
  - `pnpm install` reports "Ignored build scripts: esbuild"; everything works without approving it.
  - I could not start the api server and curl `/health` here (the sandbox blocked the compound command); `/health` is covered through `app.inject`. Please check `pnpm dev` manually.
  - Suggestion for the planner: the `dev` script needs `shared` built once; a watch mode for `shared` could be added later.
