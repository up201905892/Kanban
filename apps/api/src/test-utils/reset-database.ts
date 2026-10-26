import type { PrismaClient } from '../db.js';

/** Throws unless the database named in `url` ends in `_test`. Never includes credentials in the message. */
export function assertTestDatabase(url: string | undefined): void {
  let name: string;
  try {
    name = decodeURIComponent(new URL(url ?? '').pathname.replace(/^\//, ''));
  } catch {
    throw new Error('Refusing to reset: DATABASE_URL is missing or not a valid URL.');
  }
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to reset database "${name}": its name must end in "_test".`);
  }
}

/** Truncates every table (except Prisma's migration history). Only runs against `*_test` databases. */
export async function resetDatabase(
  prisma: Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>,
  url: string | undefined = process.env['DATABASE_URL'],
): Promise<void> {
  assertTestDatabase(url);
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename.replaceAll('"', '""')}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
