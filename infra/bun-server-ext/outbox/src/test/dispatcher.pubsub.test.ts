import { describe, expect, it, mock } from "bun:test";

/**
 * PubSubDispatcher — redis pub/sub channel dispatch (ADR-0016 §5).
 */
import {
  type BullMqEnqueuePort,
  BullMqJobDispatcher,
  CompositeDispatcher,
  type OutboxEventRow,
  PubSubDispatcher,
  REDIS_PUBSUB_CHANNELS,
  REDIS_PUBSUB_PORT_TOKEN,
  type RedisPubSubPort,
} from "../dispatcher";

function makeRow(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  const now = Date.now();
  const base: OutboxEventRow = {
    attempts: 0,
    channel: "descriptor_reload",
    createBy: "system",
    createTime: now,
    creatorId: null,
    creatorType: "SYSTEM",
    deleted: 0,
    eventType: "descriptor.reload",
    id: "1234567890123456789",
    lastError: null,
    nextAttemptTime: null,
    payloadJson: { descriptorId: "abc", tenant: 1001 },
    publishTime: null,
    scheduleTime: now,
    status: "PENDING",
    target: null,
    tenant: 1001,
    updateBy: "system",
    updateTime: now,
    updaterId: null,
    updaterType: "SYSTEM",
  };
  return { ...base, ...overrides };
}

/** Records every publish(channel, message) call. */
function makeFakePubSub(): RedisPubSubPort & { calls: [string, string][] } {
  const calls: [string, string][] = [];
  return {
    calls,
    async publish(channel: string, message: string) {
      calls.push([channel, message]);
    },
  };
}

describe("REDIS_PUBSUB_PORT_TOKEN", () => {
  it("uses the agentic.* namespace", () => {
    expect(REDIS_PUBSUB_PORT_TOKEN.description).toBe("agentic.outbox.redisPubSub");
  });
});

describe("PubSubDispatcher", () => {
  it("descriptor_reload → publish(redis channel, payload json) exactly once", async () => {
    const pubsub = makeFakePubSub();
    const dispatcher = new PubSubDispatcher(pubsub);
    await dispatcher.dispatch(makeRow({ channel: "descriptor_reload" }));
    expect(pubsub.calls).toHaveLength(1);
    const [channel, message] = pubsub.calls[0]!;
    expect(channel).toBe("agentic:engine:pubsub:descriptor.reload");
    expect(JSON.parse(message)).toMatchObject({ descriptorId: "abc", tenant: 1001 });
  });

  it("passes through a string payloadJson as-is", async () => {
    const pubsub = makeFakePubSub();
    const dispatcher = new PubSubDispatcher(pubsub);
    const raw = '{"already":"serialized"}';
    await dispatcher.dispatch(makeRow({ channel: "authz_invalidate", payloadJson: raw }));
    const [channel, message] = pubsub.calls[0]!;
    expect(channel).toBe("agentic:engine:pubsub:grant.invalidate");
    expect(message).toBe(raw);
  });

  it("channel without pubsub mapping → OutboxDispatchError(non-retryable)", async () => {
    const pubsub = makeFakePubSub();
    const dispatcher = new PubSubDispatcher(pubsub);
    await expect(dispatcher.dispatch(makeRow({ channel: "bullmq_job" }))).rejects.toMatchObject({
      name: "OutboxDispatchError",
      retryable: false,
    });
    expect(pubsub.calls).toHaveLength(0);
  });
});

describe("CompositeDispatcher + pubsub", () => {
  it("descriptor_reload delegates to injected pubsub dispatcher", async () => {
    const add = mock(() => Promise.resolve());
    const pubsub = makeFakePubSub();
    const composite = new CompositeDispatcher(new BullMqJobDispatcher({ add } as BullMqEnqueuePort), new PubSubDispatcher(pubsub));
    await composite.dispatch(makeRow({ channel: "descriptor_reload" }));
    expect(pubsub.calls).toHaveLength(1);
    expect(pubsub.calls[0]![0]).toBe("agentic:engine:pubsub:descriptor.reload");
    expect(add).toHaveBeenCalledTimes(0);
  });

  it("authz_invalidate delegates to injected pubsub dispatcher", async () => {
    const pubsub = makeFakePubSub();
    const composite = new CompositeDispatcher(
      new BullMqJobDispatcher({ add: mock(() => Promise.resolve()) }),
      new PubSubDispatcher(pubsub),
    );
    await composite.dispatch(makeRow({ channel: "authz_invalidate" }));
    expect(pubsub.calls[0]![0]).toBe(REDIS_PUBSUB_CHANNELS["authz_invalidate"]);
  });

  it("backward-compat: no pubsub injected → descriptor_reload still throws NOT_IMPLEMENTED", async () => {
    const composite = new CompositeDispatcher(new BullMqJobDispatcher({ add: mock(() => Promise.resolve()) }));
    await expect(composite.dispatch(makeRow({ channel: "descriptor_reload" }))).rejects.toMatchObject({
      message: expect.stringContaining("OUTBOX_CHANNEL_NOT_IMPLEMENTED"),
    });
  });
});
