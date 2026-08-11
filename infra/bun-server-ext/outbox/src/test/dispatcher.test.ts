import { describe, expect, it, mock } from "bun:test";

/**
 * Dispatcher — channel routing + BullMQ enqueue (P3-08).
 */
import {
  type BullMqEnqueuePort,
  BullMqJobDispatcher,
  CODE_INTERNAL_UNKNOWN_OUTBOX_CHANNEL,
  CODE_UNIMPLEMENTED_PHASE4,
  CompositeDispatcher,
  KafkaDispatcher,
  OUTBOX_CHANNELS,
  OutboxDispatchError,
  type OutboxEventRow,
  REDIS_PUBSUB_CHANNELS,
  WebhookDispatcher,
} from "../dispatcher";

function makeRow(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  const now = Date.now();
  const base: OutboxEventRow = {
    attempts: 0,
    channel: "bullmq_job",
    createBy: "system",
    createTime: now,
    creatorId: null,
    creatorType: "SYSTEM",
    deleted: 0,
    eventType: "job.enqueued",
    id: "1234567890123456789",
    lastError: null,
    nextAttemptTime: null,
    payloadJson: { jobId: "1234567890123456789", tenant: 1001 },
    publishTime: null,
    scheduleTime: now,
    status: "PENDING",
    target: "agentic-engine-long-running-jobs",
    tenant: 1001,
    updateBy: "system",
    updateTime: now,
    updaterId: null,
    updaterType: "SYSTEM",
  };
  return { ...base, ...overrides };
}

describe("OUTBOX_CHANNELS", () => {
  it("contains exactly 6 channels (06-jobs/README.md §4.2)", () => {
    expect(OUTBOX_CHANNELS).toHaveLength(6);
  });

  it("lists all routing keys", () => {
    expect(OUTBOX_CHANNELS).toContain("bullmq_job");
    expect(OUTBOX_CHANNELS).toContain("message_service");
  });
});

describe("REDIS_PUBSUB_CHANNELS", () => {
  it("maps descriptor_reload", () => {
    expect(REDIS_PUBSUB_CHANNELS["descriptor_reload"]).toBe("agentic:engine:pubsub:descriptor.reload");
  });

  it("values use pubsub prefix", () => {
    for (const v of Object.values(REDIS_PUBSUB_CHANNELS)) {
      expect(v).toMatch(/^agentic:engine:pubsub:/u);
    }
  });
});

describe("BullMqJobDispatcher", () => {
  it("bullmq_job 路由到 enqueue.add 且参数含 jobId/attempts/backoff", async () => {
    const add = mock((_q: string, _p: Record<string, unknown>, _o: unknown) => Promise.resolve());
    const enqueue: BullMqEnqueuePort = { add };
    const dispatcher = new BullMqJobDispatcher(enqueue);
    await dispatcher.dispatch(makeRow({ channel: "bullmq_job" }));
    expect(add).toHaveBeenCalledTimes(1);
    const [q, payload, opts] = add.mock.calls[0]!;
    expect(q).toBe("agentic-engine-long-running-jobs");
    expect(payload).toMatchObject({ jobId: "1234567890123456789", tenant: 1001 });
    expect(opts).toMatchObject({
      attempts: 3,
      backoff: { delay: 1000, type: "exponential" },
      jobId: "1234567890123456789",
    });
  });

  it("wrong channel → Error（非 OutboxDispatchError）", async () => {
    const enqueue: BullMqEnqueuePort = { add: mock(() => Promise.resolve()) };
    const dispatcher = new BullMqJobDispatcher(enqueue);
    await expect(dispatcher.dispatch(makeRow({ channel: "message_service" }))).rejects.toThrow("unexpected channel");
  });

  it("uses a bounded payload maxAttempts for durable KB jobs", async () => {
    const add = mock((_q: string, _p: Record<string, unknown>, _o: unknown) => Promise.resolve());
    const dispatcher = new BullMqJobDispatcher({ add });
    await dispatcher.dispatch(
      makeRow({
        payloadJson: { jobId: "1234567890123456789", maxAttempts: 7 },
        target: "agentic-kb-ingest",
      }),
    );
    expect(add.mock.calls[0]?.[2]).toMatchObject({ attempts: 7 });
  });

  it("BullMQ add 失败时向上抛出", async () => {
    const enqueue: BullMqEnqueuePort = {
      add: mock(() => Promise.reject(new Error("redis down"))),
    };
    const dispatcher = new BullMqJobDispatcher(enqueue);
    await expect(dispatcher.dispatch(makeRow())).rejects.toThrow("redis down");
  });
});

describe("KafkaDispatcher / WebhookDispatcher", () => {
  it("KafkaDispatcher 抛 OutboxDispatchError", async () => {
    const d = new KafkaDispatcher();
    await expect(d.dispatch(makeRow({ channel: "bullmq_job" }))).rejects.toBeInstanceOf(OutboxDispatchError);
  });

  it("WebhookDispatcher 抛 OutboxDispatchError", async () => {
    const d = new WebhookDispatcher();
    await expect(d.dispatch(makeRow())).rejects.toBeInstanceOf(OutboxDispatchError);
  });
});

describe("CompositeDispatcher", () => {
  it("未知 channel → INTERNAL_UNKNOWN_OUTBOX_CHANNEL", async () => {
    const add = mock(() => Promise.resolve());
    const inner = new BullMqJobDispatcher({ add });
    const composite = new CompositeDispatcher(inner);
    await expect(
      composite.dispatch({
        ...makeRow(),
        channel: "totally_unknown",
      } as unknown as OutboxEventRow),
    ).rejects.toMatchObject({
      message: expect.stringContaining(CODE_INTERNAL_UNKNOWN_OUTBOX_CHANNEL),
      name: "OutboxDispatchError",
    });
  });

  it("kafka_event → UNIMPLEMENTED_PHASE4", async () => {
    const add = mock(() => Promise.resolve());
    const composite = new CompositeDispatcher(new BullMqJobDispatcher({ add }));
    await expect(
      composite.dispatch({
        ...makeRow(),
        channel: "kafka_event",
      } as unknown as OutboxEventRow),
    ).rejects.toMatchObject({
      message: expect.stringContaining(CODE_UNIMPLEMENTED_PHASE4),
    });
  });

  it("已知但未实装 channel → OUTBOX_CHANNEL_NOT_IMPLEMENTED", async () => {
    const add = mock(() => Promise.resolve());
    const composite = new CompositeDispatcher(new BullMqJobDispatcher({ add }));
    await expect(composite.dispatch(makeRow({ channel: "message_service" }))).rejects.toMatchObject({
      message: expect.stringContaining("OUTBOX_CHANNEL_NOT_IMPLEMENTED"),
    });
  });
});
