/**
 * Safety Baseline + BullMQ — Testcontainers Redis。
 *
 *   USE_TESTCONTAINERS=1 bun test packages/agentic-adapters/test/integration/safety.testcontainers.test.ts
 *   bun run test:containers
 */
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { BaselineSafetyAdapter } from '../../safety/baseline-safety';
import {
  BullMQExecutionBackendAdapter,
  BULLMQ_DEFAULT_QUEUE,
} from '../../backend/bullmq-backend';
import {
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startRedisOnly,
  stopTrackedTestcontainersIfAny,
  type RedisOnlyStack,
} from '@cube-ai/test-infra';

const run = await resolveShouldRunTestcontainers();
const stackHolder: { current: RedisOnlyStack | null } = { current: null };
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

(run ? describe : describe.skip)('Safety adapters [testcontainers]', () => {
  describe('Baseline（无 Redis）', () => {
    it('真实 PII 串 → review 返回 mask', async () => {
      const adapter = new BaselineSafetyAdapter();
      const out = await adapter.review(
        { content: 'Card 4111111111111111', metadata: {} } as import('@tachu/core').InputEnvelope,
        { metadata: { safetyClass: 'L1_USER_DATA' } },
        {
          correlation: {
            requestId: 'r',
            sessionId: 's',
            traceId: 'tr',
            turnId: 'turn-1',
          },
          principal: {},
          budget: {},
          scopes: [],
        },
      );
      expect(out.maskedText).toBeDefined();
      expect(out.maskedText).toContain('[CARD_REDACTED]');
    });
  });

  describe('BullMQ', () => {
    beforeAll(async () => {
      const s = await startRedisOnly();
      stackHolder.current = s;
    }, HOOK_MS);

    afterAll(async () => {
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
      await stopTrackedTestcontainersIfAny();
    });

    it('真 BullMQ enqueue', async () => {
      const redisUrl = stackHolder.current!.redisUrl;
      const backend = new BullMQExecutionBackendAdapter({
        redisUrl,
        queueName: BULLMQ_DEFAULT_QUEUE,
      });
      const { jobId } = await backend.enqueue('int-task-1', {
        jobName: 'integration-smoke',
        hello: 'world',
      });
      expect(jobId.length).toBeGreaterThan(0);
      await backend.dispose();
    });
  });
});
