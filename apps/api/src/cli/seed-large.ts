import { loadConfigOrExit, loadDotEnv } from '../config.js';
import { createPrismaClient } from '../db.js';
import { SEED_EMAIL, SEED_PASSWORD, seedLargeBoard } from '../seed/large-board.js';

// Usage: pnpm db:seed:large (local development only; refuses to run in production)
loadDotEnv();
if (process.env['NODE_ENV'] === 'production') {
  console.error('Refusing to seed demo data when NODE_ENV=production.');
  process.exit(2);
}
const config = loadConfigOrExit();
const prisma = createPrismaClient(config.DATABASE_URL);
try {
  const seed = await seedLargeBoard(prisma);
  console.log(`Created a project with ${seed.cardCount} cards over 5 columns.`);
  console.log(`Log in as ${SEED_EMAIL} with password ${SEED_PASSWORD}`);
  console.log(`Board: /projects/${seed.projectId}`);
} catch {
  console.error('Could not seed the database: check DATABASE_URL and that migrations are applied.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
