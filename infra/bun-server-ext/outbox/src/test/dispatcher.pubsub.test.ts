/**
 * PubSubDispatcher — redis pub/sub channel dispatch (ADR-0016 §5).
 */
import { describe, it, expect, mock } from 'bun:test';
import {
  REDIS_PUBSUB_CHANNELS,
  BullMqJobDispatcher,
  CompositeDispatcher,
  PubSubDispatcher,
  OutboxDispatchError,
  REDIS_PUBSUB_PORT_TOKEN,
  type BullMqEnqueuePort,
  type RedisPubSubPort,
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
    channel:          'descriptor_reload',
    eventType:        'descriptor.reload',
    payloadJson:      { descriptorId: 'abc', tenant: 1001 },
    target:           null,
    status:           'PENDING',
    attempts:         0,
    lastError:        null,
    scheduleTime:     now,
    publishTime:      null,
    nextAttemptTime:  null,
  };
  return { ...base, ...overrides };
}

/** Records every publish(channel, message) call. */
function makeFakePubSub(): RedisPubSubPort & { calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    async publish(channel: string, message: string) {
      calls.push([channel, message]);
    },
  };
}

describe('REDIS_PUBSUB_PORT_TOKEN', () => {
  it('uses the agentic.* namespace', () => {
    expect(REDIS_PUBSUB_PORT_TOKEN.description).toBe('agentic.outbox.redisPubSub');
  });
});

describe('PubSubDispatcher', () => {
  it('descriptor_reload → publish(redis channel, payload json) exactly once', async () => {
    const pubsub = makeFakePubSub();
    const dispatcher = new PubSubDispatcher(pubsub);
    await dispatcher.dispatch(makeRow({ channel: 'descriptor_reload' }));
    expect(pubsub.calls).toHaveLength(1);
    const [channel, message] = pubsub.calls[0]!;
    expect(channel).toBe('agentic:engine:pubsub:descriptor.reload');
    expect(JSON.parse(message)).toMatchObject({ descriptorId: 'abc', tenant: 1001 });
  });

  it('passes through a string payloadJson as-is', async () => {
    const pubsub = makeFakePubSub();
    const dispatcher = new PubSubDispatcher(pubsub);
    const raw = '{"already":"serialized"}';
    await dispatcher.dispatch(makeRow({ channel: 'authz_invalidate', payloadJson: raw }));
    const [channel, message] = pubsub.calls[0]!;
    expect(channel).toBe('agentic:engine:pubsub:grant.invalidate');
    expect(message).toBe(raw);
  });

  it('channel without pubsub mapping → OutboxDispatchError(non-retryable)', async () => {
    const pubsub = makeFakePubSub();
    const dispatcher = new PubSubDispatcher(pubsub);
    await expect(
      dispatcher.dispatch(makeRow({ channel: 'bullmq_job' })),
    ).rejects.toMatchObject({ name: 'OutboxDispatchError', retryable: false });
    expect(pubsub.calls).toHaveLength(0);
  });
});

describe('CompositeDispatcher + pubsub', () => {
  it('descriptor_reload delegates to injected pubsub dispatcher', async () => {
    const add = mock(() => Promise.resolve());
    const pubsub = makeFakePubSub();
    const composite = new CompositeDispatcher(
      new BullMqJobDispatcher({ add } as BullMqEnqueuePort),
      new PubSubDispatcher(pubsub),
    );
    await composite.dispatch(makeRow({ channel: 'descriptor_reload' }));
    expect(pubsub.calls).toHaveLength(1);
    expect(pubsub.calls[0]![0]).toBe('agentic:engine:pubsub:descriptor.reload');
    expect(add).toHaveBeenCalledTimes(0);
  });

  it('authz_invalidate delegates to injected pubsub dispatcher', async () => {
    const pubsub = makeFakePubSub();
    const composite = new CompositeDispatcher(
      new BullMqJobDispatcher({ add: mock(() => Promise.resolve()) }),
      new PubSubDispatcher(pubsub),
    );
    await composite.dispatch(makeRow({ channel: 'authz_invalidate' }));
    expect(pubsub.calls[0]![0]).toBe(REDIS_PUBSUB_CHANNELS['authz_invalidate']);
  });

  it('backward-compat: no pubsub injected → descriptor_reload still throws NOT_IMPLEMENTED', async () => {
    const composite = new CompositeDispatcher(
      new BullMqJobDispatcher({ add: mock(() => Promise.resolve()) }),
    );
    await expect(
      composite.dispatch(makeRow({ channel: 'descriptor_reload' })),
    ).rejects.toMatchObject({
      message: expect.stringContaining('OUTBOX_CHANNEL_NOT_IMPLEMENTED'),
    });
  });
});
