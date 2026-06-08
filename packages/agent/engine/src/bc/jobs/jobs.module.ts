/**
 * Jobs BC Module — BullMQ queues + Workers + Scheduler.
 *
 * Activates M1 queues:
 *   - agentic-engine-long-running-jobs (LONG_RUNNING Tool execution)
 *   - agentic-engine-cleanup           (session + outbox cleanup cron + grant-expire)
 *
 * DI tokens follow naming-and-db-conventions §9.3: `Symbol.for('agentic.jobs.*')`.
 *
 * ref: design doc §6 / bullmq-protocol.md §1 / long-running-runtime.md §3 / P3-09
 */
import { Module } from '@dangao/bun-server';
import { SfidModule } from '../../infra/sfid/sfid.module';
import { SfidService } from '../../infra/sfid/sfid.service';
import { SchedulerService, DEFAULT_SCHEDULER_CONFIG } from './scheduler.service';
import type { CleanupRepeatScheduler } from './scheduler.service';
import {
  BullMQQueuesFactory,
  JOBS_QUEUE_FACTORY_TOKEN,
} from './bullmq-queues';
import { JobDataService } from './job-data.service';
import { JOBS_DATA_ACCESS_TOKEN } from './jobs.tokens';
import { JobsController } from './jobs.controller';

/** DI token for SchedulerService */
export const JOBS_SCHEDULER_TOKEN = Symbol.for('agentic.jobs.scheduler');

@Module({
  imports: [SfidModule],
  providers: [
    BullMQQueuesFactory,
    JobDataService,
    JobsController,
    {
      provide: SchedulerService,
      useFactory: (
        sfid: SfidService,
        jobData: JobDataService,
        queues: BullMQQueuesFactory,
      ) => {
        const cleanupRepeat: CleanupRepeatScheduler = {
          scheduleRepeatJob: async (name, pattern) => {
            await queues.cleanup.add(name, {}, { repeat: { pattern } });
          },
        };
        return new SchedulerService(
          DEFAULT_SCHEDULER_CONFIG,
          cleanupRepeat,
          { sfid, jobData, queues },
        );
      },
      inject: [SfidService, JobDataService, BullMQQueuesFactory],
    },
    {
      provide: JOBS_SCHEDULER_TOKEN,
      useExisting: SchedulerService,
    },
    {
      provide: JOBS_QUEUE_FACTORY_TOKEN,
      useExisting: BullMQQueuesFactory,
    },
    {
      provide: JOBS_DATA_ACCESS_TOKEN,
      useExisting: JobDataService,
    },
  ],
  controllers: [JobsController],
  exports: [
    SchedulerService,
    JOBS_SCHEDULER_TOKEN,
    BullMQQueuesFactory,
    JOBS_QUEUE_FACTORY_TOKEN,
    JobDataService,
    JOBS_DATA_ACCESS_TOKEN,
  ],
})
export class JobsModule {}
