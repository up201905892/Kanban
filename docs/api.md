# API reference

REST endpoints and real-time messages. Error format for every error response: `{ error: { code, message } }`, plus `details` for validation errors. The schemas (`ErrorCode`, `ApiError`) are in `packages/shared`.

## Conventions

- Every response carries an `x-request-id` header; the same id appears in the server logs.
- Unknown routes return `404 NOT_FOUND`; invalid or malformed requests return `400 VALIDATION_ERROR` (with `details` for schema errors); unexpected errors return `500 INTERNAL_ERROR` with a generic message and no stack trace.
- Cookies, authorization headers and passwords are redacted from logs.

## REST

### GET /health

Reports that the API process is running. No authentication.

- Response `200`: `{ "status": "ok" }` (schema `healthResponseSchema` in `packages/shared`)

### GET /health/ready

Reports whether the API can reach its database (used by the hosting healthcheck). No authentication. The response schema is `readyResponseSchema` in `packages/shared`.

- Response `200`: `{ "db": "ok" }` when the database answers
- Response `503`: `{ "db": "unavailable" }` when it does not

## Real-time messages

None yet (see KB-016).
