// [P1-10] OTel NodeSDK 必须在所有其他 module 之前初始化
import './infra/observability/otel-setup';

import 'reflect-metadata';
import { bootstrap } from './bootstrap';
import { GracefulShutdownService } from './infra/lifecycle/graceful-shutdown.service';
import { OutboxRelayService } from '@cube-ai/bun-server-ext-outbox';

const startedAt = Date.now();

bootstrap()
  .then(async (app) => {
    // P3-09: optional BullMQ workers (separate process / replica with env flag).
    if (
      process.env['AGENTIC_ENGINE_ENABLE_JOB_WORKERS'] === '1' ||
      process.env['AGENTIC_ENGINE_ENABLE_JOB_WORKERS'] === 'true'
    ) {
      const { startJobWorkers } = await import('./bc/jobs/workers/bullmq-workers');
      await startJobWorkers(app);
    }

    const server = app.getServer();
    const port = server?.getPort?.() ?? Number(Bun.env.AGENTIC_ENGINE_PORT ?? 3000);
    const hostname = server?.getHostname?.() ?? '0.0.0.0';
    const boot = Date.now() - startedAt;

    process.stdout.write(
      JSON.stringify({
        msg: 'agentic-engine.listening',
        url: `http://${hostname}:${port}`,
        bootMs: boot,
        ts: startedAt,
      }) + '\n',
    );

    // Graceful shutdown — DI-resolved + SIGTERM/SIGINT registered after listen.
    // ref: docs/detailed-design/10-deployment-and-ops/README.md §3.3
    const graceful = app
      .getContainer()
      .resolve(GracefulShutdownService) as GracefulShutdownService;
    graceful.registerProcessSignalHandlers();

    const enableMemoryProjectionRelay =
      process.env['AGENTIC_ENGINE_ENABLE_MEMORY_PROJECTION_RELAY'] === '1' ||
      process.env['AGENTIC_ENGINE_ENABLE_MEMORY_PROJECTION_RELAY'] === 'true';
    if (enableMemoryProjectionRelay) {
      const {
        LeaderElection,
        createLeaderElectionRedis,
        OUTBOX_REDIS_TOKEN,
      } = await import('@cube-ai/bun-server-ext-outbox');
      const { MEMORY_PROJECTION_RELAY_TOKEN, MEMORY_PROJECTION_LEADER_KEY } =
        await import('./bc/tachu/tachu.tokens');
      const container = app.getContainer();
      const memoryRelay = container.resolve(
        MEMORY_PROJECTION_RELAY_TOKEN,
      ) as import('./infra/memory-projection/memory-projection-relay.service').MemoryProjectionRelayService;
      let leader: InstanceType<typeof LeaderElection> | undefined;
      try {
        const redis = container.resolve(OUTBOX_REDIS_TOKEN) as import('ioredis').default;
        leader = new LeaderElection({
          leaderKey: MEMORY_PROJECTION_LEADER_KEY,
          redis: createLeaderElectionRedis(redis),
        });
      } catch {
        leader = undefined;
      }
      await memoryRelay.start(leader, {
        skipLeaderElection: process.env['NODE_ENV'] === 'test',
      });
    }

    const enableOutboxRelay =
      process.env['AGENTIC_ENGINE_ENABLE_OUTBOX_RELAY'] === '1' ||
      process.env['AGENTIC_ENGINE_ENABLE_OUTBOX_RELAY'] === 'true';
    if (enableOutboxRelay) {
      const relay = app
        .getContainer()
        .resolve(OutboxRelayService) as OutboxRelayService;
      await relay.start();
    }
  })
  .catch((err) => {
    process.stderr.write(
      JSON.stringify({
        msg: 'agentic-engine.bootstrap-failed',
        err:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : err,
      }) + '\n',
    );
    process.exit(1);
  });
