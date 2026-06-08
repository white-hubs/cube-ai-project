import './otel-preload';
import 'reflect-metadata';
import { bootstrap, GracefulShutdownService } from './bootstrap';

const startedAt = Date.now();

bootstrap()
  .then(async (app) => {
    const server = app.getServer();
    const port =
      server?.getPort?.() ?? Number(Bun.env.AI_CENTER_PORT ?? Bun.env.AGENTIC_ENGINE_PORT ?? 3000);
    const hostname = server?.getHostname?.() ?? '0.0.0.0';
    const boot = Date.now() - startedAt;

    process.stdout.write(
      JSON.stringify({
        msg: 'ai-center.listening',
        url: `http://${hostname}:${port}`,
        bootMs: boot,
        ts: startedAt,
      }) + '\n',
    );

    const graceful = app.getContainer().resolve(GracefulShutdownService) as GracefulShutdownService;
    graceful.registerProcessSignalHandlers();
  })
  .catch((err) => {
    console.error('[ai-center] bootstrap failed', err);
    process.exit(1);
  });
