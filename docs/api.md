# API reference

REST endpoints and real-time messages. Error format for every error response: `{ error: { code, message } }`, plus `details` for validation errors. The schemas (`ErrorCode`, `ApiError`) are in `packages/shared`.

## Conventions

- Every response carries an `x-request-id` header; the same id appears in the server logs.
- Unknown routes return `404 NOT_FOUND`; invalid or malformed requests return `400 VALIDATION_ERROR` (with `details` for schema errors); unexpected errors return `500 INTERNAL_ERROR` with a generic message and no stack trace.
- Cookies, authorization headers and passwords are redacted from logs.

- Every route except `GET /health`, `GET /health/ready`, `POST /api/auth/signup` and `POST /api/auth/login` requires the session cookie, otherwise `401 UNAUTHENTICATED`.
- Every POST, PUT, PATCH and DELETE must carry an `Origin` header equal to the web origin, otherwise `403 CSRF_REJECTED`.
- Design details: `docs/adr/0002-authentication-and-sessions.md`.

## REST

### POST /api/auth/signup

Public. Body `{ email, name, password }` (password 10 to 128 characters; unknown fields rejected; schema `signupRequestSchema`). Response `201 { user: { id, email, name, createdAt } }` and a `kanban_session` cookie. Errors: `400 VALIDATION_ERROR`, `409 EMAIL_TAKEN`, `429 RATE_LIMITED` (10 per minute per IP and email, with `Retry-After`).

### POST /api/auth/login

Public. Body `{ email, password }`. Response `200` as signup, with a new session cookie. Unknown email and wrong password both return `401 INVALID_CREDENTIALS` with the same body. Errors: `400`, `429`.

### POST /api/auth/logout

Authenticated. Response `204`; the session is deleted and the cookie cleared.

### GET /api/auth/me

Authenticated. Response `200 { user }`, or `401 UNAUTHENTICATED`.

### Operator command

`pnpm --filter api admin:reset-password <email>` sets a random temporary password, prints it once and deletes all sessions of that user (no email in v1.0).

### GET /health

Reports that the API process is running. No authentication.

- Response `200`: `{ "status": "ok" }` (schema `healthResponseSchema` in `packages/shared`)

### GET /health/ready

Reports whether the API can reach its database (used by the hosting healthcheck). No authentication. The response schema is `readyResponseSchema` in `packages/shared`.

- Response `200`: `{ "db": "ok" }` when the database answers
- Response `503`: `{ "db": "unavailable" }` when it does not

## Real-time messages

None yet (see KB-016).
