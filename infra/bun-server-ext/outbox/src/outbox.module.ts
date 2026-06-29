import { type Container, Module } from "@dangao/bun-server";
import type Redis from "ioredis";
import { hostname } from "node:os";

import { BullMqEnqueueAdapter, buildRedisForBullMq } from "./bullmq-enqueue.adapter";
/**
 * Bun-server module — Outbox relay + leader election + dispatcher (P3-08).
 *
 * R30: 仅追加 providers；不重排既有导出。
 */
import {
  BULLMQ_ENQUEUE_TOKEN,
  type BullMqEnqueuePort,
  BullMqJobDispatcher,
  CompositeDispatcher,
  OUTBOX_DISPATCHER_TOKEN,
} from "./dispatcher";
import { LeaderElection, createLeaderElectionRedis } from "./leader-election";
import { OUTBOX_WRITER_TOKEN, OutboxWriterImpl } from "./outbox-writer";
import { OutboxRelayService } from "./relay.service";

export const OUTBOX_RELAY_TOKEN = Symbol.for("@cube-ai/bun-server-ext-outbox:Relay");

export const OUTBOX_REDIS_TOKEN = Symbol.for("agentic.outbox.redis");

function defaultNodeId(): string {
  return process.env["INSTANCE_ID"] ?? process.env["HOSTNAME"] ?? hostname();
}

/**
 * `OutboxExtModule` — Phase 3 完整装配：
 *  - LeaderElection（ioredis）
 *  - BullMqEnqueueAdapter + BullMqJobDispatcher → CompositeDispatcher → OUTBOX_DISPATCHER_TOKEN
 *  - OutboxRelayService → OUTBOX_RELAY_TOKEN（env 懒连 MySQL，R24）
 *  - OUTBOX_WRITER_TOKEN → OutboxWriterImpl 默认兜底（引擎 UsageModule 用 useFactory 覆盖以注入 SfidService）
 */
@Module({
  exports: [
    LeaderElection,
    BullMqJobDispatcher,
    OUTBOX_DISPATCHER_TOKEN,
    BULLMQ_ENQUEUE_TOKEN,
    OUTBOX_RELAY_TOKEN,
    OutboxRelayService,
    OUTBOX_REDIS_TOKEN,
    OUTBOX_WRITER_TOKEN,
  ],
  providers: [
    {
      provide: OUTBOX_REDIS_TOKEN,
      useFactory: () => buildRedisForBullMq(),
    },
    {
      provide: LeaderElection,
      useFactory: (c: Container) => {
        const redis = c.resolve(OUTBOX_REDIS_TOKEN) as Redis;
        return new LeaderElection({
          nodeId: defaultNodeId(),
          redis: createLeaderElectionRedis(redis),
        });
      },
    },
    {
      provide: BULLMQ_ENQUEUE_TOKEN,
      useFactory: (c: Container) => {
        const redis = c.resolve(OUTBOX_REDIS_TOKEN) as Redis;
        return new BullMqEnqueueAdapter(redis);
      },
    },
    {
      provide: BullMqJobDispatcher,
      useFactory: (c: Container) => {
        const enqueue = c.resolve(BULLMQ_ENQUEUE_TOKEN) as BullMqEnqueuePort;
        return new BullMqJobDispatcher(enqueue);
      },
    },
    {
      provide: OUTBOX_DISPATCHER_TOKEN,
      useFactory: (c: Container) => {
        const dispatcher = c.resolve(BullMqJobDispatcher) as BullMqJobDispatcher;
        return new CompositeDispatcher(dispatcher);
      },
    },
    OutboxRelayService,
    {
      provide: OUTBOX_RELAY_TOKEN,
      useExisting: OutboxRelayService,
    },
    {
      provide: OUTBOX_WRITER_TOKEN,
      useClass: OutboxWriterImpl,
    },
  ],
})
export class OutboxExtModule {}
