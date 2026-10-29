import { loadConfigOrExit, loadDotEnv } from '../config.js';
import { createPrismaClient } from '../db.js';
import { resetPassword } from '../modules/auth/admin.js';

// Usage: pnpm --filter @kanban/api admin:reset-password <email>
loadDotEnv();
const config = loadConfigOrExit();
const email = process.argv[2];

if (!email) {
  console.error('Usage: pnpm --filter @kanban/api admin:reset-password <email>');
  process.exit(2);
}

const prisma = createPrismaClient(config.DATABASE_URL);
try {
  const temporaryPassword = await resetPassword(prisma, email);
  if (temporaryPassword === null) {
    console.error('No account with that email.');
    process.exitCode = 1;
  } else {
    console.log('Temporary password (shown once; all sessions of this user were deleted):');
    console.log(temporaryPassword);
  }
} catch {
  console.error('Could not reset the password: check the email address and the database.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
