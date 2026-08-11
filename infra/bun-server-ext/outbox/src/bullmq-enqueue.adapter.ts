/**
 * BullMQ `Queue.add` adapter — lazy Queue instances per queue name (R24).
 *
 * Ref: `bullmq-protocol.md` §4 / `P1-07-jobs.md` §4.1
 */
import { type ConnectionOptions, type Queue } from "bullmq";
import Redis from "ioredis";

import { type BullMqEnqueuePort } from "./dispatcher";

const BULL_PREFIX = "agentic:engine:bull";

export class BullMqEnqueueAdapter implements BullMqEnqueuePort {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly connection: Redis) {}

  async add(
    queueName: string,
    payload: Record<string, unknown>,
    opts: {
      jobId: string;
      attempts: number;
      backoff: { type: "exponential"; delay: number };
    },
  ): Promise<void> {
    const { Queue } = await import("bullmq");
    let q = this.queues.get(queueName);
    if (!q) {
      q = new Queue(queueName, {
        connection: this.connection as ConnectionOptions,
        prefix: BULL_PREFIX,
      });
      this.queues.set(queueName, q);
    }
    await q.add("outbox", payload, {
      attempts: opts.attempts,
      backoff: opts.backoff,
      jobId: opts.jobId,
    });
  }
}

export interface OutboxRedisEnvironment {
  AGENTIC_ENGINE_REDIS_URL?: string;
  BUN_REDIS_URL?: string;
  REDIS_URL?: string;
}

export function resolveOutboxRedisUrl(redisUrl?: string, env: OutboxRedisEnvironment = process.env as OutboxRedisEnvironment): string {
  return (
    redisUrl?.trim() ||
    env.AGENTIC_ENGINE_REDIS_URL?.trim() ||
    env.REDIS_URL?.trim() ||
    env.BUN_REDIS_URL?.trim() ||
    "redis://127.0.0.1:6379/0"
  );
}

export function buildRedisForBullMq(redisUrl?: string): Redis {
  const url = resolveOutboxRedisUrl(redisUrl);
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
  client.on("error", () => {
    /* BullMQ manages reconnect; avoid unhandled ioredis error events */
  });
  return client;
}
