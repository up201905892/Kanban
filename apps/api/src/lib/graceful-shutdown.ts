import type { FastifyInstance } from 'fastify';

/**
 * Stops the server in order: no new connections, pending document batches written, sockets
 * closed with 1012, then the app (and its onClose hooks, such as the database) closes.
 * Returns the process exit code: 1 when an error occurred or some document could not be saved
 * within the shutdown deadline (KB-037), otherwise 0.
 */
export async function gracefulShutdown(app: FastifyInstance, signal: string): Promise<number> {
  app.log.info({ signal }, 'shutting down');
  try {
    const { unsaved } = await app.realtime.shutdown();
    for (const doc of unsaved) {
      app.log.error({ doc }, 'collaborative document edits could not be saved before shutdown');
    }
    await app.close();
    return unsaved.length > 0 ? 1 : 0;
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
