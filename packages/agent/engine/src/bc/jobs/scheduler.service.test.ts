/**
 * Unit tests for SchedulerService
 *
 * Assertions (design doc §7):
 * - registerRepeatJobs registers sessions-physical-cleanup + outbox-events-cleanup
 * - Duplicate registration is idempotent (no duplicate entries)
 * - Default cron patterns match M1 spec (long-running-runtime §7.1)
 *
 * Ref: design doc §7 / long-running-runtime.md §7 / bullmq-protocol §8
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { SchedulerService, DEFAULT_SCHEDULER_CONFIG } from './scheduler.service';
import { QueueNames } from './bullmq-queues';

let svc: SchedulerService;

beforeEach(() => {
  svc = new SchedulerService(DEFAULT_SCHEDULER_CONFIG);
});

describe('SchedulerService.registerRepeatJobs', () => {
  it('registers sessions-physical-cleanup on cleanup queue', async () => {
    await svc.registerRepeatJobs();
    expect(svc.isRegistered(QueueNames.CLEANUP, 'sessions-physical-cleanup')).toBe(true);
  });

  it('registers outbox-events-cleanup on cleanup queue', async () => {
    await svc.registerRepeatJobs();
    expect(svc.isRegistered(QueueNames.CLEANUP, 'outbox-events-cleanup')).toBe(true);
  });

  it('registers grant-expire on cleanup queue', async () => {
    await svc.registerRepeatJobs();
    expect(svc.isRegistered(QueueNames.CLEANUP, 'grant-expire')).toBe(true);
  });

  it('is idempotent — calling twice does not duplicate entries', async () => {
    await svc.registerRepeatJobs();
    await svc.registerRepeatJobs();
    const registered = svc.getRegistered();
    const sessionCleanupCount = registered.filter(
      (r) => r.name === 'sessions-physical-cleanup',
    ).length;
    expect(sessionCleanupCount).toBe(1);
  });
});

describe('DEFAULT_SCHEDULER_CONFIG', () => {
  it('sessionsCron is daily 03:00 (long-running-runtime §7.1)', () => {
    expect(DEFAULT_SCHEDULER_CONFIG.sessionsCron).toBe('0 3 * * *');
  });

  it('outboxCron is hourly (bullmq-protocol §8)', () => {
    expect(DEFAULT_SCHEDULER_CONFIG.outboxCron).toBe('0 * * * *');
  });
});

describe('SchedulerService with custom config', () => {
  it('respects custom cron pattern', async () => {
    const custom = new SchedulerService({
      sessionsCron:    '0 4 * * *',
      outboxCron:      '30 * * * *',
      grantExpireCron: '0 */5 * * *',
    });
    await custom.registerRepeatJobs();
    const registered = custom.getRegistered();
    const sessions = registered.find((r) => r.name === 'sessions-physical-cleanup');
    expect(sessions?.pattern).toBe('0 4 * * *');
    const grant = registered.find((r) => r.name === 'grant-expire');
    expect(grant?.pattern).toBe('0 */5 * * *');
  });
});

describe('enqueueSessionTurn / cancelJob', () => {
  it('enqueue writes DB + BullMQ add', async () => {
    let id = 1000000000000000000n;
    const sfid = { next: () => (id++).toString() };
    const adds: unknown[] = [];
    const queues = {
      longRunningJobs: {
        add: mock(async (_name: string, data: unknown, _opts: unknown) => {
          adds.push(data);
        }),
        getJob: mock(async () => null),
      },
    };
    const jobData = {
      findJobByIdempotency: mock(async () => null),
      enqueueToolJobAndOutbox: mock(async () => {}),
      cancelJobDb: mock(async () => true),
    };

    const svc = new SchedulerService(
      DEFAULT_SCHEDULER_CONFIG,
      undefined,
      {
        sfid: sfid as never,
        jobData: jobData as never,
        queues: queues as never,
      },
    );

    const out = await svc.enqueueSessionTurn({
      tenant:      1,
      toolRef:     'builtin:x',
      inputSnapshot: {},
      principalSnapshot: {},
      idempotencyKey: 'uniq-k',
    });
    expect(out.jobId).toMatch(/^[0-9]+$/);
    expect(jobData.enqueueToolJobAndOutbox).toHaveBeenCalled();
    expect(adds.length).toBe(1);
  });

  it('enqueue is idempotent when same idempotency key exists', async () => {
    const sfid = { next: mock(() => '3333333333333333333') };
    const jobData = {
      findJobByIdempotency: mock(async () => ({
        id: '3333333333333333333',
      })),
      enqueueToolJobAndOutbox: mock(async () => {
        throw new Error('should not insert');
      }),
    };
    const queues = {
      longRunningJobs: { add: mock(async () => {}), getJob: mock(async () => null) },
    };
    const svc = new SchedulerService(DEFAULT_SCHEDULER_CONFIG, undefined, {
      sfid: sfid as never,
      jobData: jobData as never,
      queues: queues as never,
    });
    const out = await svc.enqueueSessionTurn({
      tenant: 1,
      toolRef: 'builtin:x',
      inputSnapshot: {},
      principalSnapshot: {},
      idempotencyKey: 'same',
    });
    expect(out.jobId).toBe('3333333333333333333');
    expect(queues.longRunningJobs.add).not.toHaveBeenCalled();
  });

  it('cancelJob removes bullmq carrier', async () => {
    const removed = mock(async () => {});
    const queues = {
      longRunningJobs: {
        add: mock(async () => {}),
        getJob: mock(async () => ({ remove: removed })),
      },
    };
    const jobData = {
      findJobByIdempotency: mock(async () => null),
      enqueueToolJobAndOutbox: mock(async () => {}),
      cancelJobDb: mock(async () => true),
    };
    const svc = new SchedulerService(DEFAULT_SCHEDULER_CONFIG, undefined, {
      sfid: { next: () => '1' } as never,
      jobData: jobData as never,
      queues: queues as never,
    });
    const ok = await svc.cancelJob('4444444444444444444');
    expect(ok).toBe(true);
    expect(removed).toHaveBeenCalled();
  });
});
