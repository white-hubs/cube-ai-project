/**
 * Scheduler Service — BullMQ repeat jobs + enqueue long-running Tool jobs + cancel.
 *
 * M1 repeat jobs (bullmq-protocol §7.1 / long-running-runtime §7):
 *   - sessions-physical-cleanup   cron: "0 3 * * *"
 *   - outbox-events-cleanup       cron: "0 * * * *"
 *   - grant-expire                cron: default every minute (see DEFAULT_SCHEDULER_CONFIG)
 *
 * When DI deps (`cleanupRepeat`) are omitted, repeat registration is tracked
 * in-memory only (Phase 1 unit tests). With real `BullMQQueuesFactory`,
 * callers get true `cleanup.add(..., { repeat })`.
 *
 * LONG_RUNNING Tool 入队：enqueueToolCall（走 BullMQQueuesFactory，DI lazy 建连）。
 *
 * ref: design doc §6.2 / bullmq-protocol §8 / P3-09 / P3-10
 */
import { Injectable } from '@dangao/bun-server';
import type { BullMQQueuesFactory } from './bullmq-queues';
import { LONG_RUNNING_DEFAULT_JOB_OPTIONS, QueueNames } from './bullmq-queues';
import type { JobDataService } from './job-data.service';
import type { SfidService } from '../../infra/sfid/sfid.service';

export interface SchedulerConfig {
  sessionsCron: string;
  outboxCron: string;
  /** BullMQ cron for grant-expire worker (§3.5 P3-09) */
  grantExpireCron: string;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  sessionsCron:       '0 3 * * *',
  outboxCron:         '0 * * * *',
  grantExpireCron:    '*/1 * * * *',
};

/** Tracks which repeat jobs have been registered (for tests + introspection). */
export interface RegisteredRepeatJob {
  name:    string;
  queue:   string;
  pattern: string;
}

/** Optional DI: real BullMQ cleanup queue scheduling. */
export interface CleanupRepeatScheduler {
  scheduleRepeatJob(name: string, pattern: string): Promise<void>;
}

export interface SchedulerRuntimeDeps {
  sfid: SfidService;
  jobData: JobDataService;
  queues: BullMQQueuesFactory;
}

/** LONG_RUNNING Tool 异步执行队列载荷 — bullmq-protocol §3 / P3-10 */
export interface ToolCallEnqueuePayload {
  toolCallId: string;
  toolName: string;
  tenant: number;
  sessionId: string;
  turnId: string;
  args: unknown;
  traceId: string;
}

@Injectable()
export class SchedulerService {
  private readonly registered: RegisteredRepeatJob[] = [];

  constructor(
    private readonly config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
    private readonly cleanupRepeat?: CleanupRepeatScheduler,
    private readonly runtime?: SchedulerRuntimeDeps,
  ) {}

  /**
   * P3-10: LONG_RUNNING Tool 调用入队 — 走 DI 注入的 BullMQQueuesFactory。
   * Tool BC 在 ToolService 检测 LONG_RUNNING 时调用，结果由 worker 回写。
   */
  async enqueueToolCall(payload: ToolCallEnqueuePayload): Promise<{ jobId: string }> {
    const r = this.runtime;
    if (!r) {
      throw new Error('SchedulerService.enqueueToolCall: missing SchedulerRuntimeDeps (DI)');
    }
    const jobId = r.sfid.next();
    await r.queues.longRunningJobs.add(
      'tool-exec',
      {
        jobId,
        toolCallId: payload.toolCallId,
        toolName:   payload.toolName,
        tenant:     payload.tenant,
        sessionId:  payload.sessionId,
        turnId:     payload.turnId,
        args:       payload.args,
        traceId:    payload.traceId,
      },
      { ...LONG_RUNNING_DEFAULT_JOB_OPTIONS, jobId },
    );
    return { jobId };
  }

  /**
   * Register all repeat jobs into BullMQ cleanup queue.
   */
  async registerRepeatJobs(): Promise<void> {
    const specs: [string, string][] = [
      ['sessions-physical-cleanup', this.config.sessionsCron],
      ['outbox-events-cleanup',       this.config.outboxCron],
      ['grant-expire',               this.config.grantExpireCron],
    ];
    for (const [name, pattern] of specs) {
      await this.ensureRepeatJob(QueueNames.CLEANUP, name, pattern);
    }
  }

  /**
   * Insert jobs row + outbox job.enqueued + BullMQ pick-up (minimal payload).
   */
  async enqueueSessionTurn(input: {
    tenant: number;
    toolRef: string;
    sessionId?: string;
    turnId?: string;
    toolCallId?: string;
    userId?: string;
    inputSnapshot: unknown;
    principalSnapshot: unknown;
    idempotencyKey: string;
  }): Promise<{ jobId: string }> {
    const r = this.runtime;
    if (!r) {
      throw new Error('SchedulerService.enqueueSessionTurn: missing SchedulerRuntimeDeps (DI)');
    }
    const existing = await r.jobData.findJobByIdempotency(
      input.tenant,
      input.idempotencyKey,
    );
    if (existing) {
      return { jobId: existing.id };
    }

    const jobId = r.sfid.next();
    const outboxEventId = r.sfid.next();
    const deadline = new Date(Date.now() + 24 * 3600_000);

    await r.jobData.enqueueToolJobAndOutbox({
      jobId,
      outboxEventId,
      tenant: input.tenant,
      queue: QueueNames.LONG_RUNNING_JOBS,
      sessionId: input.sessionId ?? null,
      turnId: input.turnId ?? null,
      toolCallId: input.toolCallId ?? null,
      userId: input.userId ?? null,
      toolRef: input.toolRef,
      inputSnapshot: input.inputSnapshot,
      principalSnapshot: input.principalSnapshot,
      idempotencyKey: input.idempotencyKey,
      overallDeadline: deadline,
    });

    await r.queues.longRunningJobs.add(
      'long-running-tool',
      {
        jobId,
        toolRef: input.toolRef,
        tenant: input.tenant,
      },
      { jobId },
    );

    return { jobId };
  }

  /**
   * Mark job CANCELLED in DB and remove BullMQ carrier job if present.
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const r = this.runtime;
    if (!r) {
      throw new Error('SchedulerService.cancelJob: missing SchedulerRuntimeDeps (DI)');
    }
    const ok = await r.jobData.cancelJobDb(jobId);
    if (!ok) return false;
    const bullJob = await r.queues.longRunningJobs.getJob(jobId);
    if (bullJob) await bullJob.remove();
    return true;
  }

  /**
   * Idempotent repeat job registration.
   */
  private async ensureRepeatJob(
    queue: string,
    name: string,
    pattern: string,
  ): Promise<void> {
    const existing = this.registered.find(
      (row) => row.queue === queue && row.name === name,
    );
    if (existing) {
      if (existing.pattern !== pattern && this.cleanupRepeat) {
        await this.cleanupRepeat.scheduleRepeatJob(name, pattern);
      }
      existing.pattern = pattern;
      return;
    }

    if (this.cleanupRepeat) {
      await this.cleanupRepeat.scheduleRepeatJob(name, pattern);
    }

    this.registered.push({ name, queue, pattern });
  }

  /** Returns currently registered repeat jobs (read-only snapshot). */
  getRegistered(): ReadonlyArray<RegisteredRepeatJob> {
    return [...this.registered];
  }

  /** Checks whether a specific repeat job is registered. */
  isRegistered(queue: string, name: string): boolean {
    return this.registered.some((r) => r.queue === queue && r.name === name);
  }
}
