// 实装 @tachu/core ExecutionBackend Port — BullMQ
// ref: docs/detailed-design/03-core-adapters/task-executor.md §6.3 / §6.4
// ref: docs/detailed-design/06-jobs/bullmq-protocol.md (queue naming; P1-07 深化)
import type {
  BackendInput,
  BackendOutput,
  ExecutionBackend,
  ExecutionBackendKind,
  ExecutionContext,
  ExecutionTraits,
} from '@tachu/core';
import { HostError } from '@tachu/core';
import type { JobsOptions } from 'bullmq';
import { Queue } from 'bullmq';

/** BullMQ queue naming prefix enforcement constant */
export const BULLMQ_QUEUE_PREFIX = 'agentic-engine-' as const;

/** Default queue name (06-jobs/bullmq-protocol.md §3) */
export const BULLMQ_DEFAULT_QUEUE = `${BULLMQ_QUEUE_PREFIX}default` as const;

/** BullMQ backend configuration */
export interface BullMQBackendConfig {
  /** ioredis connection URL — from AGENTIC_ENGINE_REDIS_URL */
  redisUrl: string;
  /** Queue name; must start with 'agentic-engine-' (06-jobs/bullmq-protocol.md) */
  queueName?: string;
  /** Default job options */
  defaultJobOptions?: BullMQJobOptions;
}

/** BullMQ job options subset */
export interface BullMQJobOptions {
  attempts?: number;
  backoff?: { type: 'exponential' | 'fixed'; delay: number };
  /** Job priority (lower number = higher priority) */
  priority?: number;
  /** Delay before processing in ms */
  delay?: number;
}

/** Options for enqueue() engine-side convenience API */
export interface EnqueueOptions {
  /** Override default queue name; must start with 'agentic-engine-' */
  queueName?: string;
  /** Job priority */
  priority?: number;
  /** Delay before processing in ms */
  delay?: number;
}

function extractJobsOptions(payload: Record<string, unknown>): JobsOptions {
  const o: JobsOptions = {};
  if (typeof payload['priority'] === 'number') o.priority = payload['priority'];
  if (typeof payload['delay'] === 'number') o.delay = payload['delay'];
  if (typeof payload['attempts'] === 'number') o.attempts = payload['attempts'];
  return o;
}

/**
 * BullMQ-backed ExecutionBackend.
 *
 * - factory 模式（R18）：不在 constructor 中创建 Queue
 * - 首次业务调用时 `getQueue()` 再 `new Queue`（仍不主动 connect，由 ioredis 懒连）
 * - `execute` / `enqueue` 真接 `queue.add`；失败 → UNAVAILABLE_QUEUE_BACKEND
 *
 * Redis key 前缀约定（regulation §R11）：
 *   `agentic:engine:bull:{queueName}:*`
 *
 * ref: docs/detailed-design/03-core-adapters/task-executor.md §6.3
 * ref: docs/detailed-design/06-jobs/bullmq-protocol.md §3 queue naming
 */
export class BullMQExecutionBackendAdapter implements ExecutionBackend {
  readonly name = 'cube-ai-bullmq-backend';
  readonly kind: ExecutionBackendKind = 'custom';
  readonly traits: ExecutionTraits = {
    sideEffect: 'write',
    idempotent: false,
    requiresApproval: false,
    timeout: 30_000,
  };

  private _queues = new Map<string, Queue>();

  constructor(private readonly config: BullMQBackendConfig) {
    const name = config.queueName ?? BULLMQ_DEFAULT_QUEUE;
    BullMQExecutionBackendAdapter.validateQueueName(name);
  }

  /**
   * Enforce queue naming convention.
   * @throws Error if name does not start with BULLMQ_QUEUE_PREFIX
   */
  static validateQueueName(name: string): void {
    if (!name.startsWith(BULLMQ_QUEUE_PREFIX)) {
      throw new Error(
        `BullMQ queue name must start with '${BULLMQ_QUEUE_PREFIX}'; got: '${name}'`,
      );
    }
  }

  /**
   * Lazy queue factory（R18 / R24：module init 不建连，首次 add 时再走 bullmq）。
   */
  private getQueue(queueName: string): Queue {
    BullMQExecutionBackendAdapter.validateQueueName(queueName);

    if (!this._queues.has(queueName)) {
      const q = new Queue(queueName, {
        connection: { url: this.config.redisUrl },
        prefix: 'agentic:engine:bull',
        defaultJobOptions: this.config.defaultJobOptions,
      });
      this._queues.set(queueName, q);
    }
    return this._queues.get(queueName)!;
  }

  async execute(
    input: BackendInput,
    context: ExecutionContext,
  ): Promise<BackendOutput> {
    void context;
    const { payload } = input;
    const queueName =
      (typeof payload['queueName'] === 'string' ? payload['queueName'] : undefined) ??
      this.config.queueName ??
      BULLMQ_DEFAULT_QUEUE;
    BullMQExecutionBackendAdapter.validateQueueName(queueName);

    const jobName =
      (typeof payload['jobName'] === 'string' && payload['jobName'].length > 0
        ? payload['jobName']
        : undefined) ??
      (typeof payload['name'] === 'string' && (payload['name'] as string).length > 0
        ? (payload['name'] as string)
        : 'agentic-backend-job');

    const addOpts: JobsOptions = {
      ...extractJobsOptions(payload),
      jobId: input.taskId,
    };

    try {
      const queue = this.getQueue(queueName);
      // TODO(P3-14): GAP-01 — ExecutionBackend.execute 无独立 ctx 通道；BullMQ job 可透传 trace 于 payload
      const job = await queue.add(jobName, payload, addOpts);
      return {
        success: true,
        result: {
          taskId: input.taskId,
          backend: this.name,
          scheduled: true,
          queueName,
          jobId: job.id ?? input.taskId,
        },
      };
    } catch (e) {
      throw new HostError(
        'UNAVAILABLE_QUEUE_BACKEND',
        `queue backend unavailable: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e, retryable: true, context: { queueName } },
      );
    }
  }

  /**
   * Engine-side convenience enqueue API (beyond @tachu/core Port).
   */
  async enqueue(
    taskId: string,
    payload: Record<string, unknown>,
    opts?: EnqueueOptions,
  ): Promise<{ jobId: string }> {
    const queueName = opts?.queueName ?? this.config.queueName ?? BULLMQ_DEFAULT_QUEUE;

    const jobName =
      typeof payload['jobName'] === 'string' && payload['jobName'].length > 0
        ? (payload['jobName'] as string)
        : 'agentic-enqueue';

    try {
      const queue = this.getQueue(queueName);
      const job = await queue.add(jobName, payload, {
        jobId: taskId,
        priority: opts?.priority,
        delay: opts?.delay,
      });
      return { jobId: String(job.id ?? taskId) };
    } catch (e) {
      throw new HostError(
        'UNAVAILABLE_QUEUE_BACKEND',
        `queue backend unavailable: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e, retryable: true, context: { queueName } },
      );
    }
  }

  async dispose(): Promise<void> {
    for (const [, queue] of this._queues) {
      await queue.close();
    }
    this._queues.clear();
  }

  /** Expose for testing */
  get _queuesForTest(): Map<string, Queue> {
    return this._queues;
  }
}
