/**
 * BullMQ Jobs smoke — MySQL + Redis Testcontainers（MySQL 仅占位 schema，核心验证队列）。
 *
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/jobs.testcontainers.test.ts
 *   bun run test:containers
 */
import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from 'bun:test';
import { Queue, Worker } from 'bullmq';
import {
  applyMinimalMysqlSchema,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlRedis,
  stopTrackedTestcontainersIfAny,
  type MysqlRedisStack,
} from '@cube-ai/test-infra';
import { BULLMQ_QUEUE_PREFIX } from '@cube-ai/agent-engine/adapters/backend';

const run = await resolveShouldRunTestcontainers();
const stackHolder: { current: MysqlRedisStack | null } = { current: null };
const HOOK_MS = 1_800_000;

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

(run ? describe : describe.skip)('P3-09 jobs [testcontainers]', () => {
  beforeAll(async () => {
    const s = await startMysqlRedis();
    try {
      await applyMinimalMysqlSchema(s.mysqlUrl);
      stackHolder.current = s;
    } catch (e) {
      await s.stop();
      throw e;
    }
  }, HOOK_MS);

  afterAll(async () => {
    if (stackHolder.current) {
      await stackHolder.current.stop().catch(() => {});
      stackHolder.current = null;
    }
    await stopTrackedTestcontainersIfAny();
  });

  test('enqueue → Worker 处理 → job completed', async () => {
    const { redisUrl } = stackHolder.current!;
    const queueName = `${BULLMQ_QUEUE_PREFIX}tc-smoke-${Date.now()}`;
    const connection = { url: redisUrl };

    const queue = new Queue(queueName, { connection });
    const worker = new Worker(
      queueName,
      async () => ({ done: true }),
      { connection },
    );

    const job = await queue.add('smoke', { n: 1 });
    const deadline = Date.now() + 30_000;
    let state = await job.getState();
    while (state !== 'completed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 80));
      state = await job.getState();
    }

    expect(state).toBe('completed');

    await worker.close();
    await queue.close();
  });
});
