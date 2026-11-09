import type { FastifyInstance } from 'fastify';

/**
 * Stops the server in order: no new connections, pending document batches written, sockets
 * closed with 1012, then the app (and its onClose hooks, such as the database) closes.
 * Returns the process exit code.
 */
export async function gracefulShutdown(app: FastifyInstance, signal: string): Promise<number> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.realtime.shutdown();
    await app.close();
    return 0;
  } catch (err) {
    app.log.error({ err }, 'error during shutdown');
    return 1;
  }
}

/** Registers SIGTERM and SIGINT handlers that run `gracefulShutdown` once and exit. */
export function installShutdownHandlers(
  app: FastifyInstance,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  let running = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (running) return;
      running = true;
      void gracefulShutdown(app, signal).then(exit);
    });
  }
}
