# API reference

REST endpoints and real-time messages. Error format (to be applied by KB-003): `{ error: { code, message } }`.

## REST

### GET /health

Reports that the API process is running. No authentication.

- Response `200`: `{ "status": "ok" }`

### GET /health/ready

Reports whether the API can reach its database (used by the hosting healthcheck). No authentication. The response schema is `readyResponseSchema` in `packages/shared`.

- Response `200`: `{ "db": "ok" }` when the database answers
- Response `503`: `{ "db": "unavailable" }` when it does not

## Real-time messages

None yet (see KB-016).
