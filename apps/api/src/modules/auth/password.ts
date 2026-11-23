import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id with the OWASP minimum recommendation (19 MiB, 2 passes, 1 lane).
 * The library's default algorithm is argon2id; the encoded hash starts with `$argon2id$`.
 */
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Returns false (never throws) for a wrong password or a malformed hash. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
let dummyHashReady = false;

/**
 * Computes the throwaway hash once. Called before the server listens (`onReady`) so the first
 * unknown-email login after a deploy is as slow as any other.
 */
export function warmDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex')).then((h) => {
    dummyHashReady = true;
    return h;
  });
  return dummyHash;
}

/** True once the throwaway hash has been computed. */
export const isDummyHashReady = (): boolean => dummyHashReady;

/**
 * Verifies `password` against a throwaway hash. Used when the email is unknown so that
 * the response time matches a real verification (timing equalisation).
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  await verifyPassword(await warmDummyHash(), password);
}
