/**
 * BullMQ queue registry for the Jobs BC.
 *
 * M1 activates exactly 2 queues (bullmq-protocol.md §1):
 *   - agentic-engine-long-running-jobs  (concurrency=4, DLQ yes)
 *   - agentic-engine-cleanup            (concurrency=1, cron repeat)
 *
 * Reserved queues listed in `QueueNames` but NOT instantiated in M1:
 *   - agentic-engine-token-refresh      (M1.D)
 *   - agentic-engine-mcp-discovery      (M1.D)
 *   - agentic-engine-usage-aggregation  (M1.B)
 *
 * Redis key structure (bullmq-protocol §4.2):
 *   agentic:engine:bull:<queue-name>:*
 *
 * Ref: design doc §3.2 / bullmq-protocol.md §1 / redis-keys.md §3.9
 */

import { Injectable } from '@dangao/bun-server';
import { Queue } from 'bullmq';

// ─── Queue name constants ─────────────────────────────────────────────────────

/**
 * M1 active queue names.
 * Prefix `agentic-engine-` is fixed and non-configurable (bullmq-protocol §1.1).
 */
export const QueueNames = {
  /** LONG_RUNNING Tool execution; Outbox channel='bullmq_job' → this queue */
  LONG_RUNNING_JOBS: 'agentic-engine-long-running-jobs',
  /** Daily session cleanup + hourly outbox cleanup; BullMQ cron repeat */
  CLEANUP: 'agentic-engine-cleanup',

  // M1.D activate — ref design doc §10 / bullmq-protocol §1.2
  TOKEN_REFRESH:      'agentic-engine-token-refresh',
  MCP_DISCOVERY:      'agentic-engine-mcp-discovery',
  USAGE_AGGREGATION:  'agentic-engine-usage-aggregation',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

/**
 * BullMQ `prefix` option.
 * Actual Redis keys: `agentic:engine:bull:<queue-name>:*`
 * Ref: bullmq-protocol.md §4.2 / redis-keys.md §3.9
 */
export const BULLMQ_REDIS_PREFIX = 'agentic:engine:bull';

/**
 * Active M1 queue names (subset of QueueNames; used for validation).
 */
export const ACTIVE_QUEUE_NAMES_M1 = [
  QueueNames.LONG_RUNNING_JOBS,
  QueueNames.CLEANUP,
] as const;

// ─── Queue DI token ───────────────────────────────────────────────────────────

/** DI token for the queue factory; follows naming-and-db-conventions §9.3 */
export const JOBS_QUEUE_FACTORY_TOKEN = Symbol.for('agentic.jobs.queueFactory');

// ─── Default job options (bullmq-protocol §3.2) ───────────────────────────────

export const LONG_RUNNING_DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { count: 100 },
  removeOnFail:     { count: 500 },
} as const;

export const CLEANUP_DEFAULT_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { count: 10 },
  removeOnFail:     { count: 50 },
} as const;

// ─── Queue factory skeleton ───────────────────────────────────────────────────

/**
 * Shared connection config shape for BullMQ.
 * Actual `host/port/password` come from Nacos / env at runtime (Q-M2-8).
 */
export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  /** BullMQ requires null for blocking commands */
  maxRetriesPerRequest: null;
}

/** URL.password is percent-encoded; ioredis AUTH needs the decoded secret. */
function decodeRedisUrlPassword(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Creates a minimal connection config from env (`AGENTIC_ENGINE_REDIS_URL`).
 * Production: prefer Nacos-driven values once ConfigService is wired (Q-M2-8).
 */
export function buildRedisConnectionConfig(
  redisUrl?: string,
): RedisConnectionConfig {
  const url = redisUrl ?? process.env['AGENTIC_ENGINE_REDIS_URL'] ?? 'redis://localhost:6379/0';
  const parsed = new URL(url);
  return {
    host:                 parsed.hostname || 'localhost',
    port:                 Number(parsed.port) || 6379,
    password:             parsed.password
      ? decodeRedisUrlPassword(parsed.password)
      : undefined,
    db:                   Number(parsed.pathname.slice(1)) || 0,
    maxRetriesPerRequest: null,
  };
}

/** Lazy BullMQ queue pair — shared Redis connection options (R24: no connect at import). */
export interface IBullMqQueues {
  readonly longRunningJobs: Queue;
  readonly cleanup: Queue;
}

/**
 * Factory for M1-active BullMQ queues (lazy `new Queue` on first getter use).
 */
@Injectable()
export class BullMQQueuesFactory implements IBullMqQueues {
  private lr?: Queue;
  private cu?: Queue;
  private readonly redis = buildRedisConnectionConfig();

  get longRunningJobs(): Queue {
    if (!this.lr) {
      this.lr = new Queue(QueueNames.LONG_RUNNING_JOBS, {
        connection: { ...this.redis },
        prefix:     BULLMQ_REDIS_PREFIX,
        defaultJobOptions: {
          attempts: LONG_RUNNING_DEFAULT_JOB_OPTIONS.attempts,
          backoff: LONG_RUNNING_DEFAULT_JOB_OPTIONS.backoff,
          removeOnComplete: { count: LONG_RUNNING_DEFAULT_JOB_OPTIONS.removeOnComplete.count },
          removeOnFail:     { count: LONG_RUNNING_DEFAULT_JOB_OPTIONS.removeOnFail.count },
        },
      });
    }
    return this.lr;
  }

  get cleanup(): Queue {
    if (!this.cu) {
      this.cu = new Queue(QueueNames.CLEANUP, {
        connection: { ...this.redis },
        prefix:     BULLMQ_REDIS_PREFIX,
        defaultJobOptions: {
          attempts: CLEANUP_DEFAULT_JOB_OPTIONS.attempts,
          removeOnComplete: { count: CLEANUP_DEFAULT_JOB_OPTIONS.removeOnComplete.count },
          removeOnFail:     { count: CLEANUP_DEFAULT_JOB_OPTIONS.removeOnFail.count },
        },
      });
    }
    return this.cu;
  }
}
