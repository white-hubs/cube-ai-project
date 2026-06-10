/**
 * 已由 `safety.testcontainers.test.ts`（USE_TESTCONTAINERS=1）取代。
 */
import { describe, it, expect } from 'bun:test';
import { BaselineSafetyAdapter } from '../../safety/baseline-safety';
import {
  BullMQExecutionBackendAdapter,
  BULLMQ_DEFAULT_QUEUE,
} from '../../backend/bullmq-backend';

const redisUrl = process.env.AGENTIC_ENGINE_REDIS_URL;

describe.skip('P3-14 adapters-rest integration (live Redis)', () => {
  it('真实 PII 串 → review 返回 mask', async () => {
    const adapter = new BaselineSafetyAdapter();
    const out = await adapter.review(
      { content: 'Card 4111111111111111', metadata: {} } as import('@tachu/core').InputEnvelope,
      { metadata: { safetyClass: 'L1_USER_DATA' } },
      {
        requestId: 'r',
        sessionId: 's',
        traceId: 'tr',
        principal: {},
        budget: {},
        scopes: [],
      },
    );
    expect(out.maskedText).toBeDefined();
    expect(out.maskedText).toContain('[CARD_REDACTED]');
  });

  it('真 BullMQ enqueue', async () => {
    if (!redisUrl) throw new Error('AGENTIC_ENGINE_REDIS_URL required');
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
