/**
 * BullMQ Workers entry — spawned only when `AGENTIC_ENGINE_ENABLE_JOB_WORKERS` is set (R24/R30).
 *
 * ref: long-running-runtime.md §3.1 / P3-09
 */
import type { Application } from '@dangao/bun-server';
import { Worker } from 'bullmq';
import type { ProviderAdapter } from '@tachu/core';
import {
  OUTBOX_DISPATCHER_TOKEN,
  type OutboxDispatcherI,
} from '@cube-ai/bun-server-ext-outbox';
import { AGENTIC_PROVIDER_TOKEN } from '@cube-ai/agent-engine/adapters';

import { registerWorkerShutdownHook } from '../../../infra/lifecycle/lifecycle-registrations';
import { AUTH_TOKENS } from '../../auth/auth.module';
import type { MockOboService } from '../../auth/mock-obo.service';
import { AUTHZ_TOKENS } from '../../authz/authz.module';
import type { GrantService } from '../../authz/grant.service';
import { ToolService } from '../../tools/tool.service';
import { SfidService } from '../../../infra/sfid/sfid.service';
import {
  BULLMQ_REDIS_PREFIX,
  buildRedisConnectionConfig,
  BullMQQueuesFactory,
  QueueNames,
} from '../bullmq-queues';
import { JobDataService } from '../job-data.service';
import {
  LONG_RUNNING_JOB_NAME,
  SESSION_TURN_DISPATCH_JOB_NAME,
  runSessionTurnProcessor,
} from '../processors/session-turn.processor';
import { TOOL_CALL_JOB_NAME, runToolCallProcessor } from '../processors/tool-call.processor';
import {
  OUTBOX_DISPATCH_JOB_NAME,
  runOutboxDispatchProcessor,
} from '../processors/outbox-dispatch.processor';
import {
  GRANT_EXPIRE_JOB_NAME,
  runGrantExpireProcessor,
} from '../processors/grant-expire.processor';

/** Starts workers attached to this process; Redis connections are lazy until Worker constructs. */
export async function startJobWorkers(app: Application): Promise<void> {
  const c = app.getContainer();
  const queues = c.resolve(BullMQQueuesFactory) as BullMQQueuesFactory;
  const jobData = c.resolve(JobDataService) as JobDataService;
  const sfid = c.resolve(SfidService) as SfidService;
  const obo = c.resolve(AUTH_TOKENS.MOCK_OBO_SERVICE) as MockOboService;
  const provider = c.resolve(AGENTIC_PROVIDER_TOKEN) as ProviderAdapter;
  const toolService = c.resolve(ToolService) as ToolService;
  const grantService = c.resolve(AUTHZ_TOKENS.GRANT_SERVICE) as GrantService;
  const dispatcher = c.resolve(OUTBOX_DISPATCHER_TOKEN) as OutboxDispatcherI;

  const redisConnection = buildRedisConnectionConfig();
  const defaultModel =
    process.env['AGENTIC_ENGINE_WORKER_MODEL'] ??
    process.env['AGENTIC_ENGINE_OPENAI_MODEL'] ??
    'noop';

  const sessionDeps = {
    jobData,
    obo,
    provider,
    sfid,
    defaultModel,
  };

  const longRunning = new Worker(
    QueueNames.LONG_RUNNING_JOBS,
    async (bullJob) => {
      const name = bullJob.name;
      if (
        name === LONG_RUNNING_JOB_NAME ||
        name === SESSION_TURN_DISPATCH_JOB_NAME
      ) {
        return runSessionTurnProcessor(bullJob.data, sessionDeps);
      }
      if (name === TOOL_CALL_JOB_NAME) {
        return runToolCallProcessor(bullJob.data, { jobData, toolService });
      }
      if (name === OUTBOX_DISPATCH_JOB_NAME) {
        return runOutboxDispatchProcessor(bullJob.data, { jobData, dispatcher });
      }
      throw new Error(`Unknown long-running job name: ${name}`);
    },
    {
      connection: { ...redisConnection },
      prefix: BULLMQ_REDIS_PREFIX,
      concurrency: 4,
      stalledInterval: 30_000,
      maxStalledCount: 1,
      lockDuration: 60_000,
    },
  );

  const cleanup = new Worker(
    QueueNames.CLEANUP,
    async (bullJob) => {
      const name = bullJob.name;
      if (name === GRANT_EXPIRE_JOB_NAME) {
        return runGrantExpireProcessor(bullJob.data, { jobData, grantService });
      }
      if (name === 'sessions-physical-cleanup' || name === 'outbox-events-cleanup') {
        // Physical cleanup SQL is deployment-specific; worker acknowledges — relay handles outbox publish path.
        return { ok: true };
      }
      throw new Error(`Unknown cleanup job name: ${name}`);
    },
    {
      connection: { ...redisConnection },
      prefix: BULLMQ_REDIS_PREFIX,
      concurrency: 1,
    },
  );

  longRunning.on('failed', (_job, err) => {
    process.stderr.write(
      JSON.stringify({
        msg: 'bullmq.long-running.failed',
        err: err instanceof Error ? err.message : String(err),
      }) + '\n',
    );
  });

  // T05: hand off live Worker instances so GracefulShutdownService closes
  // them in priority-200 order before the leader release / pool shutdown.
  registerWorkerShutdownHook(app, [longRunning, cleanup]);

  process.on('beforeExit', () => {
    void longRunning.close();
    void cleanup.close();
  });
}
