import 'reflect-metadata';
import { describe, test, expect, mock } from 'bun:test';
import type { Context } from '@dangao/bun-server';
import { contextStore } from '@dangao/bun-server';
import { JobsController } from './jobs.controller';
import type { JobDataService } from './job-data.service';

function baseCtx(
  extra: Partial<Context> & {
    getBody?: () => Promise<unknown>;
    getParam?: (k: string) => string | undefined;
  } = {},
): Context & { setStatus: ReturnType<typeof mock> } {
  const setStatus = mock(() => {});
  return {
    setStatus,
    query: new URLSearchParams(),
    params: {},
    state: {
      subject: {
        tenant: 42,
        user: {
          userId: 'svc-user',
          tenant: 42,
          displayName: 'Svc User',
          scopes: ['engine.use'],
          rawTokenSha256: 'x',
          expiresAt: Date.now() + 3600_000,
        },
      },
    },
    getBody: extra.getBody ?? mock(async () => ({})),
    getParam: extra.getParam ?? mock(() => undefined),
    ...extra,
  } as unknown as Context & { setStatus: ReturnType<typeof mock> };
}

describe('JobsController', () => {
  test('GET /jobs/:id returns job view', async () => {
    const jobData = {
      findJobById: mock(async () => ({
        id: '1820345678901234567',
        tenant: 42,
        sessionId: '1820345678901234001',
        turnId: '1820345678901234002',
        toolCallId: null,
        userId: 'svc-user',
        kind: 'TOOL',
        toolRef: 'platform.flow.invoke',
        queue: 'agentic-engine-long-running-jobs',
        status: 'RUNNING',
        attempts: 1,
        maxAttempts: 3,
        timeoutMs: 300000,
        overallDeadlineTime: new Date('2026-05-11T00:10:00.000Z'),
        inputSnapshotJson: '{}',
        principalSnapshotJson: '{}',
        resultRefJson: null,
        errorCode: null,
        errorDetailJson: null,
        requiresNotification: true,
        createTime: new Date('2026-05-11T00:00:00.000Z'),
        updateTime: new Date('2026-05-11T00:00:10.000Z'),
        startTime: new Date('2026-05-11T00:00:05.000Z'),
        endTime: null,
      })),
      cancelJobDb: mock(async () => true),
    } as unknown as JobDataService;
    const ctl = new JobsController(jobData);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === 'jobId' ? '1820345678901234567' : undefined)),
    });

    const out = await contextStore.run(ctx as Context, async () => ctl.getJob());
    expect((out as { id: string; status: string }).id).toBe('1820345678901234567');
    expect((out as { status: string }).status).toBe('RUNNING');
  });

  test('GET /jobs/:id hides cross-tenant job as not-found', async () => {
    const jobData = {
      findJobById: mock(async () => ({
        id: '1820345678901234567',
        tenant: 7,
        sessionId: null,
        turnId: null,
        toolCallId: null,
        userId: null,
        kind: 'TOOL',
        toolRef: null,
        queue: 'agentic-engine-long-running-jobs',
        status: 'QUEUED',
        attempts: 0,
        maxAttempts: 3,
        timeoutMs: 300000,
        overallDeadlineTime: new Date(),
        inputSnapshotJson: '{}',
        principalSnapshotJson: '{}',
        resultRefJson: null,
        errorCode: null,
        errorDetailJson: null,
        requiresNotification: true,
        createTime: new Date(),
        updateTime: new Date(),
        startTime: null,
        endTime: null,
      })),
      cancelJobDb: mock(async () => true),
    } as unknown as JobDataService;
    const ctl = new JobsController(jobData);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === 'jobId' ? '1820345678901234567' : undefined)),
    });

    await expect(contextStore.run(ctx as Context, async () => ctl.getJob())).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND_JOB',
    });
  });

  test('POST /jobs/:id:cancel cancels active job', async () => {
    const cancelJobDb = mock(async () => true);
    const jobData = {
      findJobById: mock(async () => ({
        id: '1820345678901234567',
        tenant: 42,
        sessionId: null,
        turnId: null,
        toolCallId: null,
        userId: null,
        kind: 'TOOL',
        toolRef: null,
        queue: 'agentic-engine-long-running-jobs',
        status: 'RUNNING',
        attempts: 0,
        maxAttempts: 3,
        timeoutMs: 300000,
        overallDeadlineTime: new Date(),
        inputSnapshotJson: '{}',
        principalSnapshotJson: '{}',
        resultRefJson: null,
        errorCode: null,
        errorDetailJson: null,
        requiresNotification: true,
        createTime: new Date(),
        updateTime: new Date(),
        startTime: new Date(),
        endTime: null,
      })),
      cancelJobDb,
    } as unknown as JobDataService;
    const ctl = new JobsController(jobData);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === 'jobId' ? '1820345678901234567' : undefined)),
    });

    const out = await contextStore.run(ctx as Context, async () => ctl.cancelJob());

    expect(cancelJobDb).toHaveBeenCalledWith('1820345678901234567');
    expect(out).toEqual({ ok: true });
  });

  test('POST /jobs/:id:cancel hides cross-tenant job as not-found', async () => {
    const cancelJobDb = mock(async () => true);
    const jobData = {
      findJobById: mock(async () => ({
        id: '1820345678901234567',
        tenant: 7,
        sessionId: null,
        turnId: null,
        toolCallId: null,
        userId: null,
        kind: 'TOOL',
        toolRef: null,
        queue: 'agentic-engine-long-running-jobs',
        status: 'RUNNING',
        attempts: 0,
        maxAttempts: 3,
        timeoutMs: 300000,
        overallDeadlineTime: new Date(),
        inputSnapshotJson: '{}',
        principalSnapshotJson: '{}',
        resultRefJson: null,
        errorCode: null,
        errorDetailJson: null,
        requiresNotification: true,
        createTime: new Date(),
        updateTime: new Date(),
        startTime: new Date(),
        endTime: null,
      })),
      cancelJobDb,
    } as unknown as JobDataService;
    const ctl = new JobsController(jobData);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === 'jobId' ? '1820345678901234567' : undefined)),
    });

    await expect(contextStore.run(ctx as Context, async () => ctl.cancelJob())).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND_JOB',
    });
    expect(cancelJobDb).not.toHaveBeenCalled();
  });
});

