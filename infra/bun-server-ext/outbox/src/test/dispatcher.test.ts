/**
 * Dispatcher — channel routing + BullMQ enqueue (P3-08).
 */
import { describe, it, expect, mock } from 'bun:test';
import {
  OUTBOX_CHANNELS,
  REDIS_PUBSUB_CHANNELS,
  BullMqJobDispatcher,
  KafkaDispatcher,
  WebhookDispatcher,
  CompositeDispatcher,
  OutboxDispatchError,
  CODE_INTERNAL_UNKNOWN_OUTBOX_CHANNEL,
  CODE_UNIMPLEMENTED_PHASE4,
  type BullMqEnqueuePort,
} from '../dispatcher';
import type { OutboxEventRow } from '../dispatcher';

function makeRow(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  const now = Date.now();
  const base: OutboxEventRow = {
    id:               '1234567890123456789',
    tenant:           1001,
    deleted:          0,
    createBy:         'system',
    creatorId:        null,
    creatorType:      'SYSTEM',
    createTime:       now,
    updateBy:         'system',
    updaterId:        null,
    updaterType:      'SYSTEM',
    updateTime:       now,
    channel:          'bullmq_job',
    eventType:        'job.enqueued',
    payloadJson:      { jobId: '1234567890123456789', tenant: 1001 },
    target:           'agentic-engine-long-running-jobs',
    status:           'PENDING',
    attempts:         0,
    lastError:        null,
    scheduleTime:     now,
    publishTime:      null,
    nextAttemptTime:  null,
  };
  return { ...base, ...overrides };
}

describe('OUTBOX_CHANNELS', () => {
  it('contains exactly 6 channels (06-jobs/README.md §4.2)', () => {
    expect(OUTBOX_CHANNELS).toHaveLength(6);
  });

  it('lists all routing keys', () => {
    expect(OUTBOX_CHANNELS).toContain('bullmq_job');
    expect(OUTBOX_CHANNELS).toContain('message_service');
  });
});

describe('REDIS_PUBSUB_CHANNELS', () => {
  it('maps descriptor_reload', () => {
    expect(REDIS_PUBSUB_CHANNELS['descriptor_reload']).toBe(
      'agentic:engine:pubsub:descriptor.reload',
    );
  });

  it('values use pubsub prefix', () => {
    for (const v of Object.values(REDIS_PUBSUB_CHANNELS)) {
      expect(v).toMatch(/^agentic:engine:pubsub:/);
    }
  });
});

describe('BullMqJobDispatcher', () => {
  it('bullmq_job 路由到 enqueue.add 且参数含 jobId/attempts/backoff', async () => {
    const add = mock((_q: string, _p: Record<string, unknown>, _o: unknown) =>
      Promise.resolve(),
    );
    const enqueue: BullMqEnqueuePort = { add };
    const dispatcher = new BullMqJobDispatcher(enqueue);
    await dispatcher.dispatch(makeRow({ channel: 'bullmq_job' }));
    expect(add).toHaveBeenCalledTimes(1);
    const [q, payload, opts] = add.mock.calls[0]!;
    expect(q).toBe('agentic-engine-long-running-jobs');
    expect(payload).toMatchObject({ jobId: '1234567890123456789', tenant: 1001 });
    expect(opts).toMatchObject({
      jobId: '1234567890123456789',
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
  });

  it('wrong channel → Error（非 OutboxDispatchError）', async () => {
    const enqueue: BullMqEnqueuePort = { add: mock(() => Promise.resolve()) };
    const dispatcher = new BullMqJobDispatcher(enqueue);
    await expect(
      dispatcher.dispatch(makeRow({ channel: 'message_service' })),
    ).rejects.toThrow('unexpected channel');
  });

  it('BullMQ add 失败时向上抛出', async () => {
    const enqueue: BullMqEnqueuePort = {
      add: mock(() => Promise.reject(new Error('redis down'))),
    };
    const dispatcher = new BullMqJobDispatcher(enqueue);
    await expect(dispatcher.dispatch(makeRow())).rejects.toThrow('redis down');
  });
});

describe('KafkaDispatcher / WebhookDispatcher', () => {
  it('KafkaDispatcher 抛 OutboxDispatchError', async () => {
    const d = new KafkaDispatcher();
    await expect(d.dispatch(makeRow({ channel: 'bullmq_job' }))).rejects.toBeInstanceOf(
      OutboxDispatchError,
    );
  });

  it('WebhookDispatcher 抛 OutboxDispatchError', async () => {
    const d = new WebhookDispatcher();
    await expect(d.dispatch(makeRow())).rejects.toBeInstanceOf(OutboxDispatchError);
  });
});

describe('CompositeDispatcher', () => {
  it('未知 channel → INTERNAL_UNKNOWN_OUTBOX_CHANNEL', async () => {
    const add = mock(() => Promise.resolve());
    const inner = new BullMqJobDispatcher({ add });
    const composite = new CompositeDispatcher(inner);
    await expect(
      composite.dispatch({
        ...makeRow(),
        channel: 'totally_unknown',
      } as unknown as OutboxEventRow),
    ).rejects.toMatchObject({
      name: 'OutboxDispatchError',
      message: expect.stringContaining(CODE_INTERNAL_UNKNOWN_OUTBOX_CHANNEL),
    });
  });

  it('kafka_event → UNIMPLEMENTED_PHASE4', async () => {
    const add = mock(() => Promise.resolve());
    const composite = new CompositeDispatcher(new BullMqJobDispatcher({ add }));
    await expect(
      composite.dispatch({
        ...makeRow(),
        channel: 'kafka_event',
      } as unknown as OutboxEventRow),
    ).rejects.toMatchObject({
      message: expect.stringContaining(CODE_UNIMPLEMENTED_PHASE4),
    });
  });

  it('已知但未实装 channel → OUTBOX_CHANNEL_NOT_IMPLEMENTED', async () => {
    const add = mock(() => Promise.resolve());
    const composite = new CompositeDispatcher(new BullMqJobDispatcher({ add }));
    await expect(composite.dispatch(makeRow({ channel: 'message_service' }))).rejects.toMatchObject({
      message: expect.stringContaining('OUTBOX_CHANNEL_NOT_IMPLEMENTED'),
    });
  });
});
