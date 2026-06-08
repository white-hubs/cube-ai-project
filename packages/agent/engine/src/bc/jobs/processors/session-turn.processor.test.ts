/**
 * Unit tests — session-turn / long-running processor (P3-09 §5).
 */
import { describe, it, expect, mock } from 'bun:test';
import type { ProviderAdapter } from '@tachu/core';
import { NoopLLMProviderAdapter } from '@cube-ai/agent-engine/adapters';
import { MockOboService } from '../../auth/mock-obo.service';
import { SfidService } from '../../../infra/sfid/sfid.service';
import type { JobDataService } from '../job-data.service';
import type { JobRow } from '../job-data.types';
import {
  LONG_RUNNING_JOB_NAME,
  runSessionTurnProcessor,
  type SessionTurnProcessorDeps,
} from './session-turn.processor';

const SFID = '1234567890123456789';

function baseJob(overrides: Partial<JobRow> = {}): JobRow {
  const now = new Date();
  return {
    id: SFID,
    tenant: 1,
    sessionId: '2234567890123456789',
    turnId: '3234567890123456789',
    toolCallId: null,
    userId: 'u1',
    kind: 'TOOL',
    toolRef: 'builtin:platform.flow.invoke',
    queue: 'agentic-engine-long-running-jobs',
    status: 'QUEUED',
    attempts: 0,
    maxAttempts: 3,
    timeoutMs: 300_000,
    overallDeadlineTime: new Date(now.getTime() + 86_400_000),
    inputSnapshotJson: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    principalSnapshotJson: JSON.stringify({
      schema: 'job-principal-v1',
      userId: 'u1',
      tenant: 1,
      scopes: ['engine.use'],
      oboAudiencesNeeded: ['app.flow'],
    }),
    requiresNotification: true,
    ...overrides,
  };
}

function buildDeps(row: JobRow, opts?: {
  provider?: ProviderAdapter;
  obo?: MockOboService;
}): SessionTurnProcessorDeps {
  let current: JobRow = { ...row };
  const obo = opts?.obo ?? new MockOboService();
  const provider = opts?.provider ?? new NoopLLMProviderAdapter();

  const jobData = {
    findJobById: mock(async (id: string) =>
      id === current.id ? { ...current } : null,
    ),
    updateJobTerminal: mock(async () => {}),
    tryMarkJobRunning: mock(async () => {
      if (current.status !== 'QUEUED') return false;
      current = {
        ...current,
        status: 'RUNNING',
        attempts: current.attempts + 1,
      };
      return true;
    }),
    requeueJobAfterRetryableFailure: mock(async () => {
      current = { ...current, status: 'QUEUED' };
    }),
    appendOutboxWithId: mock(async () => {}),
    nextMessageSeqForTurn: mock(async () => 0),
    insertAssistantMessage: mock(async () => {}),
  } as unknown as JobDataService;

  return {
    jobData,
    obo,
    provider,
    sfid: new SfidService(),
    defaultModel: 'noop',
  };
}

describe('runSessionTurnProcessor', () => {
  it('throws for invalid payload', async () => {
    const deps = buildDeps(baseJob());
    await expect(runSessionTurnProcessor({ bad: true }, deps)).rejects.toThrow(
      /Invalid BullMQ job payload/,
    );
  });

  it('throws when jobs row missing', async () => {
    const deps = buildDeps(baseJob());
    await expect(
      runSessionTurnProcessor(
        { jobId: '9999999999999999999', tenant: 1 },
        deps,
      ),
    ).rejects.toThrow(/not found/);
  });

  it('returns ok when job already COMPLETED', async () => {
    const row = baseJob({ status: 'COMPLETED' });
    const deps = buildDeps(row);
    const r = await runSessionTurnProcessor(
      { jobId: SFID, tenant: 1 },
      deps,
    );
    expect(r.ok).toBe(true);
  });

  it('happy path — LLM returns text and completes job', async () => {
    const row = baseJob();
    const deps = buildDeps(row);
    const r = await runSessionTurnProcessor(
      { jobId: SFID, tenant: 1, toolRef: row.toolRef ?? undefined },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(deps.jobData.updateJobTerminal).toHaveBeenCalled();
  });

  it('OBO exchange failure — requeues and propagates error for BullMQ retry', async () => {
    const row = baseJob();
    const badObo = new MockOboService();
    badObo.exchange = mock(async () => {
      throw new Error('obo_down');
    });
    const deps = buildDeps(row, { obo: badObo });
    await expect(
      runSessionTurnProcessor({ jobId: SFID, tenant: 1 }, deps),
    ).rejects.toThrow(/obo_down/);
    expect(deps.jobData.requeueJobAfterRetryableFailure).toHaveBeenCalled();
  });

  it('LLM failure at max attempts — terminal FAILED without throw', async () => {
    const row = baseJob({ attempts: 2, maxAttempts: 3 });
    const failingProvider = {
      id: 'fail',
      name: 'fail',
      listAvailableModels: async () => [],
      chat: mock(async () => {
        throw new Error('llm_down');
      }),
      chatStream: async function* () {
        yield { type: 'delta', content: '' };
      },
      countTokens: async () => 0,
    } as unknown as ProviderAdapter;

    const deps = buildDeps(row, { provider: failingProvider });
    const r = await runSessionTurnProcessor({ jobId: SFID, tenant: 1 }, deps);
    expect(r.ok).toBe(false);
    expect(deps.jobData.updateJobTerminal).toHaveBeenCalled();
  });
});

describe('LONG_RUNNING_JOB_NAME', () => {
  it('matches bullmq-protocol §2.1', () => {
    expect(LONG_RUNNING_JOB_NAME).toBe('long-running-tool');
  });
});
