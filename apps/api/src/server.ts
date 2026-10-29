import { buildApp } from './app.js';
import { loadConfigOrExit, loadDotEnv } from './config.js';
import { createPrismaClient } from './db.js';

loadDotEnv();
const config = loadConfigOrExit();

const prisma = createPrismaClient(config.DATABASE_URL);
const app = buildApp({ prisma, webOrigin: config.WEB_ORIGIN });
app.addHook('onClose', async () => {
  await prisma.$disconnect();
});

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
