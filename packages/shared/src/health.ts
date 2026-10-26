import { z } from 'zod';

/** Body of `GET /health/ready`: 200 with `db: "ok"`, 503 with `db: "unavailable"`. */
export const readyResponseSchema = z.object({
  db: z.enum(['ok', 'unavailable']),
});

export type ReadyResponse = z.infer<typeof readyResponseSchema>;
