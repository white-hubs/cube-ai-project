export * from './types';
// [P1-03] writer (single-row INSERT inside an existing transaction)
export * from './outbox-writer';
// [P1-07] leader election + dispatcher abstractions for relay
export * from './leader-election';
export * from './bullmq-enqueue.adapter';
// Re-export dispatcher without OutboxEventRow (conflicts with types.ts)
export {
  OUTBOX_CHANNELS,
  REDIS_PUBSUB_CHANNELS,
  BullMqJobDispatcher,
  BullMQDispatcher,
  KafkaDispatcher,
  WebhookDispatcher,
  PubSubDispatcher,
  CompositeDispatcher,
  OutboxDispatchError,
  OUTBOX_DISPATCHER_TOKEN,
  BULLMQ_ENQUEUE_TOKEN,
  REDIS_PUBSUB_PORT_TOKEN,
  CODE_UNIMPLEMENTED_PHASE4,
  CODE_INTERNAL_UNKNOWN_OUTBOX_CHANNEL,
} from './dispatcher';
export type {
  BullMqEnqueuePort,
  RedisPubSubPort,
  OutboxChannel,
  OutboxDispatcherI,
  OutboxEventRow as DispatchableOutboxRow,
} from './dispatcher';
export * from './relay.service';
export * from './outbox.module';
export { createTestRedisClient } from './test-redis-client';

export const OUTBOX_EXT_VERSION = '0.0.0-m2-skeleton-c';
