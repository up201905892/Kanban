# 0002 · Authentication and sessions

- **Status:** Accepted
- **Date:** 2026-10-29
- **Task:** KB-005
- **Technical decisions:** D3 (authentication), D4 (single instance on Railway), D6 (no email in v1.0) in `docs/workflow/01-planning.md`.

## Context

The app needs accounts, sessions that can be revoked on the server (for example when a member is removed), and the same authentication for the REST API and for the WebSocket upgrade (KB-016). João decided (D3) on our own email + password authentication instead of Auth.js, Lucia-as-a-library or Supabase Auth, following the Lucia guide and the Copenhagen Book. There is no email in v1.0 (D6), so there is no verification and no emailed password reset.

## Decision

1. **Password hashing.** argon2id through `@node-rs/argon2` (prebuilt native binaries, no install scripts). Parameters are the OWASP minimum: memory 19456 KiB, 2 passes, 1 lane, 32-byte output, random 16-byte salt per hash. The encoded string (`$argon2id$...`) carries its own parameters, so they can be raised later and old hashes still verify. Passwords are 10 to 128 characters (no composition rules; the upper bound limits hashing cost).
2. **Session token.** 32 random bytes from `crypto.randomBytes`, base64url-encoded (256 bits of entropy). Only its SHA-256 (hex) is stored in `sessions.token_hash` (unique). Because the token is high entropy, a fast unsalted hash is enough; a database leak does not reveal usable tokens. `SESSION_SECRET` is therefore not used for session lookup; it stays reserved for features that need signing.
3. **Cookie.** Name `kanban_session`; `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `NODE_ENV=production`, `Expires` set to the session expiry. No `Domain` attribute (host-only). The web app and the API share one origin (D4) and the Vite dev proxy keeps that true in development, so no CORS is needed.
4. **Expiry and renewal.** Sessions last 30 days. When a session is used and its `last_used_at` is at least one day old, `last_used_at` is set to now, `expires_at` to now + 30 days and the cookie is sent again (sliding expiry, at most one write a day per session). An expired session is rejected and its row deleted. Logout deletes the row and clears the cookie. `ON DELETE CASCADE` removes the sessions of a deleted user.
5. **CSRF.** `SameSite=Lax` plus a mandatory exact `Origin` check on every POST, PUT, PATCH and DELETE: the header must equal the configured `WEB_ORIGIN`, otherwise `403 CSRF_REJECTED`. A missing `Origin` is rejected (browsers always send it on cross-origin and on same-origin unsafe requests). The check runs before authentication. GET requests never change state.
6. **Rate limiting.** Login and signup: 10 attempts per minute per client IP and email, in memory (fixed window), then `429 RATE_LIMITED` with `Retry-After`. Memory is acceptable because the deployment is a single instance (D4); a restart resets the counters. Behind Railway's proxy the client IP is only correct if Fastify's `trustProxy` is enabled; KB-031 must set it, otherwise all users would share one IP bucket.
7. **Account enumeration.** Login answers an unknown email and a wrong password with the identical `401 INVALID_CREDENTIALS` body, and verifies the password against a dummy hash for an unknown email so the response time is similar. Signup, however, answers `409 EMAIL_TAKEN` for an existing email. That reveals that an account exists. We accept it because without email we cannot send a neutral "check your inbox" response, a signup form that silently fails is poor usability, and the endpoint is rate limited. Emails are stored lowercased (a `CHECK` constraint enforces it).
8. **Authorization plumbing.** A global `preValidation` hook (`modules/auth/guard.ts`) performs the Origin check and then `requireAuth` for every route that is not in the explicit `PUBLIC_ROUTES` set (health, signup, login). Unknown paths still answer 404. `request.user` is available to handlers. `getSessionFromCookieHeader()` resolves a session from a raw `Cookie` header and is the one function the WebSocket upgrade must use (KB-016). The guard is installed only when a database client is given to `buildApp` (tests of the bare app).
9. **Password reset.** No email (D6). The operator runs `pnpm --filter api admin:reset-password <email>`: it sets a random 24-character temporary password, prints it once and deletes all of the user's sessions in one transaction.
10. **Logging.** Cookies, authorization headers and password fields are redacted (KB-003); `passwordHash` is never selected into a response type and the response schemas strip unknown fields.

## Alternatives considered

- **Auth.js / Lucia as a library / Supabase Auth:** extra dependency or vendor on a core security path, harder to revoke sessions or to reuse for the WebSocket (rejected in D3).
- **JWT access tokens:** cannot be revoked without a server-side list, which is a session table with extra steps.
- **bcrypt / scrypt:** older or less tunable; argon2id is the OWASP first choice. The pure-JS `argon2` package needs a native build step that pnpm blocks by default.
- **Signed (HMAC) cookie with the session id:** adds nothing over an unguessable random token that is hashed in the database.
- **CSRF tokens (double submit):** more moving parts for the client; `SameSite=Lax` plus the Origin check covers the same-origin deployment.
- **Redis or a database table for rate limits:** unnecessary for one instance.
- **Neutral signup response (no enumeration):** needs email delivery (D6).

## Consequences

- Every later route is authenticated by default; making a route public requires editing `PUBLIC_ROUTES`, visible in review.
- Sessions are revocable at any time (remove the row), which KB-007 uses when members are removed.
- A lost password needs the operator; email reset is a candidate for v1.1.
- The signup endpoint leaks account existence (documented trade-off, point 7).
- Rate limiter state is per process; running more than one instance would multiply the limits.
