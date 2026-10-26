import { afterAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '../db.js';
import { assertTestDatabase, resetDatabase } from './reset-database.js';

describe('assertTestDatabase', () => {
  it('accepts a database name ending in _test', () => {
    expect(() => assertTestDatabase('postgresql://u:p@localhost:5432/kanban_test')).not.toThrow();
  });

  it.each([
    'postgresql://u:p@localhost:5432/kanban',
    'postgresql://u:p@localhost:5432/kanban_test_backup',
    'postgresql://u:p@localhost:5432/',
    'not a url',
    undefined,
  ])('rejects %s', (url) => {
    expect(() => assertTestDatabase(url)).toThrow();
  });

  it('does not leak credentials', () => {
    expect(() => assertTestDatabase('postgresql://u:hunter2@localhost:5432/kanban')).toThrow(
      /^((?!hunter2).)*$/s,
    );
  });
});

describe('resetDatabase', () => {
  it('throws for a database not ending in _test without touching it', async () => {
    const prisma = { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn() };
    await expect(resetDatabase(prisma, 'postgresql://u:p@localhost:5432/kanban')).rejects.toThrow(
      '_test',
    );
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  describe('against the test database', () => {
    const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
    afterAll(() => prisma.$disconnect());

    it('truncates tables but keeps migration history', async () => {
      await prisma.appMeta.create({ data: { key: 'k', value: 'v' } });
      await resetDatabase(prisma);
      expect(await prisma.appMeta.count()).toBe(0);
      const migrations = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        'SELECT count(*) AS n FROM _prisma_migrations',
      );
      expect(Number(migrations[0]?.n)).toBeGreaterThan(0);
    });
  });
});
