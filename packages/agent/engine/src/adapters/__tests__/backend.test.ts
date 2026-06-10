/**
 * Unit tests — P1-04 BullMQ ExecutionBackend adapter
 * ref: docs/technical-design/prompts/phase-1/P1-04-adapters.md §6 unit tests
 * ref: docs/detailed-design/03-core-adapters/task-executor.md §6.3
 *
 * Critical paths covered:
 * CT-B1  R18 lazy init: no BullMQ Queue created in constructor
 * CT-B2  validateQueueName() enforces 'agentic-engine-' prefix
 * CT-B3  Constructor throws on invalid queue name prefix
 * CT-B4  execute() calls queue.add and returns scheduled job metadata
 * CT-B5  enqueue() calls queue.add and returns jobId
 * CT-B6  dispose() closes all queues and clears map
 */
import { describe, it, expect, mock } from 'bun:test';
import { HostError } from '@tachu/core';
import {
  BullMQExecutionBackendAdapter,
  BULLMQ_QUEUE_PREFIX,
  BULLMQ_DEFAULT_QUEUE,
} from '../backend/bullmq-backend';
import type { ExecutionContext } from '@tachu/core';

const fakeCtx: ExecutionContext = {} as ExecutionContext;

const validConfig = {
  redisUrl: 'redis://localhost:6379',
  queueName: BULLMQ_DEFAULT_QUEUE,
};

function mockQueue(jobId = 'bullmq-job-1') {
  const add = mock(async () => ({ id: jobId }));
  return {
    add,
    close: mock(async () => {}),
  };
}

// ─── BullMQExecutionBackendAdapter ────────────────────────────────────────────

describe('BullMQExecutionBackendAdapter', () => {
  it('CT-B1: R18 — no BullMQ Queue created in constructor', () => {
    const backend = new BullMQExecutionBackendAdapter(validConfig);
    expect(backend._queuesForTest.size).toBe(0);
  });

  it('CT-B2: validateQueueName() accepts valid prefix', () => {
    expect(() =>
      BullMQExecutionBackendAdapter.validateQueueName(`${BULLMQ_QUEUE_PREFIX}jobs`),
    ).not.toThrow();
  });

  it('CT-B3: constructor throws when queue name has invalid prefix', () => {
    expect(() =>
      new BullMQExecutionBackendAdapter({
        redisUrl: 'redis://localhost:6379',
        queueName: 'invalid-queue',
      }),
    ).toThrow();
  });

  it('CT-B4: execute() invokes queue.add and returns scheduled=true', async () => {
    const backend = new BullMQExecutionBackendAdapter(validConfig);
    const q = mockQueue('jid-exec');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (backend as any).getQueue = () => q;

    const output = await backend.execute(
      { taskId: 'task-123', payload: { key: 'value', jobName: 'my-job' } },
      fakeCtx,
    );

    expect(output.success).toBe(true);
    expect(q.add).toHaveBeenCalled();
    const result = output.result as Record<string, unknown>;
    expect(result['taskId']).toBe('task-123');
    expect(result['scheduled']).toBe(true);
    expect(result['jobId']).toBe('jid-exec');
  });

  it('CT-B5: enqueue() invokes queue.add and returns jobId', async () => {
    const backend = new BullMQExecutionBackendAdapter(validConfig);
    const q = mockQueue('jid-enq');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (backend as any).getQueue = () => q;

    const result = await backend.enqueue('task-xyz', { data: 1, jobName: 'x' });
    expect(result.jobId).toBe('jid-enq');
    expect(q.add).toHaveBeenCalled();
  });

  it('CT-B6: dispose() closes the internal queues map', async () => {
    const backend = new BullMQExecutionBackendAdapter(validConfig);
    const mockClose = { closed: false };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (backend._queuesForTest as Map<string, any>).set(BULLMQ_DEFAULT_QUEUE, {
      close: async () => {
        mockClose.closed = true;
      },
    });

    await backend.dispose();
    expect(backend._queuesForTest.size).toBe(0);
    expect(mockClose.closed).toBe(true);
  });

  it('CT-B7: add failure maps to UNAVAILABLE_QUEUE_BACKEND', async () => {
    const backend = new BullMQExecutionBackendAdapter(validConfig);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (backend as any).getQueue = () => ({
      add: mock(async () => {
        throw new Error('redis down');
      }),
      close: mock(async () => {}),
    });

    let err: unknown;
    try {
      await backend.execute({ taskId: 't1', payload: {} }, fakeCtx);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HostError);
    expect((err as HostError).code).toBe('UNAVAILABLE_QUEUE_BACKEND');
  });

  it('validates BULLMQ_QUEUE_PREFIX constant value', () => {
    expect(BULLMQ_QUEUE_PREFIX).toBe('agentic-engine-');
  });
});
