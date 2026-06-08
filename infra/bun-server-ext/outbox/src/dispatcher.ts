/**
 * Outbox Dispatcher — routes outbox_events rows to delivery channels (P3-08).
 *
 * Ref: `docs/technical-design/phase-1/P1-07-jobs.md` §3.3 / bullmq-protocol §5.3
 */
import { JobQueueNameSchema } from '@cube-ai/contracts';
import type {
  OutboxEventRow as OutboxEventRowBase,
} from './types';

export type OutboxEventRow = OutboxEventRowBase;

// ─── Channel enum (06-jobs/README.md §4.2) ─────────────────────────────────

export const OUTBOX_CHANNELS = [
  'bullmq_job',
  'message_service',
  'usage_bus',
  'descriptor_reload',
  'authz_invalidate',
  'session_lifecycle',
] as const;
export type OutboxChannel = (typeof OUTBOX_CHANNELS)[number];

export const REDIS_PUBSUB_CHANNELS: Record<string, string> = {
  descriptor_reload:  'agentic:engine:pubsub:descriptor.reload',
  authz_invalidate:   'agentic:engine:pubsub:grant.invalidate',
  session_lifecycle:  'agentic:engine:pubsub:session.lifecycle',
};

// ─── Dispatcher interface ───────────────────────────────────────────────────

export interface OutboxDispatcherI {
  dispatch(row: OutboxEventRow): Promise<void>;
}

/** Inject BullMQ enqueue (lazy Queue factory in prod; fake in tests). */
export interface BullMqEnqueuePort {
  add(
    queueName: string,
    payload: Record<string, unknown>,
    opts: {
      jobId: string;
      attempts: number;
      backoff: { type: 'exponential'; delay: number };
    },
  ): Promise<void>;
}

// ─── Error codes (assertable) ─────────────────────────────────────────────────

export const CODE_UNIMPLEMENTED_PHASE4 = 'UNIMPLEMENTED_PHASE4';
export const CODE_INTERNAL_UNKNOWN_OUTBOX_CHANNEL = 'INTERNAL_UNKNOWN_OUTBOX_CHANNEL';

// ─── BullMq job dispatcher ────────────────────────────────────────────────────

/**
 * Dispatches `bullmq_job` rows to BullMQ (`row.target` = queue name).
 *
 * Ref: bullmq-protocol §5.4
 */
export class BullMqJobDispatcher implements OutboxDispatcherI {
  constructor(private readonly enqueue: BullMqEnqueuePort) {}

  async dispatch(row: OutboxEventRow): Promise<void> {
    if (row.channel !== 'bullmq_job') {
      throw new Error(
        `BullMqJobDispatcher: unexpected channel '${row.channel}' (expected 'bullmq_job')`,
      );
    }

    const payloadRaw = typeof row.payloadJson === 'string'
      ? JSON.parse(row.payloadJson as string)
      : row.payloadJson;

    const payload = payloadRaw as Record<string, unknown>;
    const jobId = typeof payload?.jobId === 'string' ? payload.jobId : undefined;
    if (!jobId) {
      throw new Error(`BullMqJobDispatcher: missing jobId in outbox row ${row.id}`);
    }

    if (!row.target) {
      throw new Error(`BullMqJobDispatcher: missing target queue in outbox row ${row.id}`);
    }

    const queueParse = JobQueueNameSchema.safeParse(row.target);
    if (!queueParse.success) {
      throw new OutboxDispatchError(
        `INVALID_JOB_QUEUE_NAME: target '${row.target}' is not a registered queue name`,
        false,
      );
    }

    await this.enqueue.add(
      row.target,
      payload,
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
      },
    );
  }
}

/** @deprecated Use {@link BullMqJobDispatcher} */
export const BullMQDispatcher = BullMqJobDispatcher;

// ─── Placeholder dispatchers (narrow API surface; not used by Composite P3-08) ─

export class KafkaDispatcher implements OutboxDispatcherI {
  async dispatch(row: OutboxEventRow): Promise<void> {
    throw new OutboxDispatchError(
      `${CODE_UNIMPLEMENTED_PHASE4}: KafkaDispatcher channel=${row.channel}`,
      false,
    );
  }
}

export class WebhookDispatcher implements OutboxDispatcherI {
  async dispatch(row: OutboxEventRow): Promise<void> {
    throw new OutboxDispatchError(
      `NOT_IMPLEMENTED: WebhookDispatcher channel=${row.channel}`,
      false,
    );
  }
}

// ─── Composite ────────────────────────────────────────────────────────────────

/**
 * Routes by `channel`; `bullmq_job` is fully wired; others explicit errors for Phase 4 / backlog.
 */
export class CompositeDispatcher implements OutboxDispatcherI {
  constructor(private readonly bullmq: OutboxDispatcherI) {}

  async dispatch(row: OutboxEventRow): Promise<void> {
    const ch = row.channel as string;

    if (ch === 'bullmq_job') {
      return this.bullmq.dispatch(row);
    }

    if (ch === 'kafka_event') {
      throw new OutboxDispatchError(
        `${CODE_UNIMPLEMENTED_PHASE4}: kafka_event`,
        false,
      );
    }

    if ((OUTBOX_CHANNELS as readonly string[]).includes(ch)) {
      throw new OutboxDispatchError(
        `OUTBOX_CHANNEL_NOT_IMPLEMENTED: ${ch}`,
        false,
      );
    }

    throw new OutboxDispatchError(
      `${CODE_INTERNAL_UNKNOWN_OUTBOX_CHANNEL}: '${ch}'`,
      false,
    );
  }
}

// ─── OutboxDispatchError ──────────────────────────────────────────────────────

export class OutboxDispatchError extends Error {
  constructor(
    message: string,
    /** false → mark outbox row DEAD immediately */
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'OutboxDispatchError';
  }
}

// ─── DI tokens ────────────────────────────────────────────────────────────────

export const OUTBOX_DISPATCHER_TOKEN = Symbol.for('agentic.outbox.dispatcher');
export const BULLMQ_ENQUEUE_TOKEN = Symbol.for('agentic.outbox.bullmqEnqueue');
