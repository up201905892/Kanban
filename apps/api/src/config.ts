import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const configSchema = z.object({
  DATABASE_URL: z
    .string({ error: 'is required' })
    .min(1, 'is required')
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a PostgreSQL connection URL'),
  SESSION_SECRET: z.string({ error: 'is required' }).min(32, 'must be at least 32 characters long'),
  PORT: z.coerce.number({ error: 'must be a number' }).int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  WEB_ORIGIN: z.url({ error: 'must be a valid URL' }).default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Config = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Validates an environment. Messages name the variable and never include its value. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`),
    );
  }
  return result.data;
}

/** Loads the repository-root `.env` (if present) without overriding real environment variables. */
export function loadDotEnv(): void {
  const file = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}

/** Loads config for the server process; prints the problems and exits non-zero when invalid. */
export function loadConfigOrExit(env: Record<string, string | undefined> = process.env): Config {
  try {
    return loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
