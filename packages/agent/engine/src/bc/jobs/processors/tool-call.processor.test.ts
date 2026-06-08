import { describe, it, expect, mock } from 'bun:test';
import type { ToolService } from '../../tools/tool.service';
import type { JobDataService } from '../job-data.service';
import type { JobRow } from '../job-data.types';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import { runToolCallProcessor } from './tool-call.processor';

const J = '4234567890123456789';

function jobRow(overrides: Partial<JobRow> = {}): JobRow {
  const now = new Date();
  return {
    id: J,
    tenant: 1,
    sessionId: '5234567890123456789',
    turnId: '6234567890123456789',
    toolCallId: null,
    userId: 'u1',
    kind: 'TOOL',
    toolRef: 'ext:1:http',
    queue: 'agentic-engine-long-running-jobs',
    status: 'QUEUED',
    attempts: 0,
    maxAttempts: 3,
    timeoutMs: 300_000,
    overallDeadlineTime: new Date(now.getTime() + 3600_000),
    inputSnapshotJson: '{}',
    principalSnapshotJson: JSON.stringify({
      userId: 'u1',
      tenant: 1,
      scopes: ['engine.use'],
    }),
    requiresNotification: false,
    ...overrides,
  };
}

describe('runToolCallProcessor', () => {
  it('throws on invalid payload', async () => {
    const jd = {} as JobDataService;
    const ts = {} as ToolService;
    await expect(runToolCallProcessor({}, { jobData: jd, toolService: ts })).rejects.toThrow(
      /Invalid tool-call payload/,
    );
  });

  it('happy path — invoke succeeds', async () => {
    let row = jobRow();
    const jobData = {
      findJobById: mock(async () => ({ ...row })),
      tryMarkJobRunning: mock(async () => {
        if (row.status !== 'QUEUED') return false;
        row = { ...row, status: 'RUNNING', attempts: row.attempts + 1 };
        return true;
      }),
      updateJobTerminal: mock(async () => {}),
    } as unknown as JobDataService;

    const toolService = {
      invoke: mock(async () => ({ ok: true })),
    } as unknown as ToolService;

    const r = await runToolCallProcessor(
      { jobId: J, tenant: 1, toolName: 'builtin:test.tool', args: { a: 1 } },
      { jobData, toolService },
    );
    expect(r.ok).toBe(true);
    expect(toolService.invoke).toHaveBeenCalled();
  });

  it('invoke throws — FAILED terminal', async () => {
    let row = jobRow();
    const updateJobTerminal = mock(async () => {});
    const jobData = {
      findJobById: mock(async () => ({ ...row })),
      tryMarkJobRunning: mock(async () => {
        if (row.status !== 'QUEUED') return false;
        row = { ...row, status: 'RUNNING', attempts: row.attempts + 1 };
        return true;
      }),
      updateJobTerminal,
    } as unknown as JobDataService;

    const toolService = {
      invoke: mock(async () => {
        throw new Error('bad_args');
      }),
    } as unknown as ToolService;

    const r = await runToolCallProcessor(
      { jobId: J, tenant: 1, toolName: 'builtin:x', args: {} },
      { jobData, toolService },
    );
    expect(r.ok).toBe(false);
    expect(updateJobTerminal).toHaveBeenCalled();
    const args = updateJobTerminal.mock.calls[0] as unknown as [
      string,
      'FAILED',
      { errorCode?: string; errorDetail?: { suggestedActions?: unknown; message?: string } },
    ];
    expect(args[1]).toBe('FAILED');
    expect(args[2].errorDetail?.suggestedActions).toBeUndefined();
  });

  it('invoke throws AgenticEngineError retryable — adds suggestedActions', async () => {
    let row = jobRow();
    const updateJobTerminal = mock(async () => {});
    const jobData = {
      findJobById: mock(async () => ({ ...row })),
      tryMarkJobRunning: mock(async () => {
        if (row.status !== 'QUEUED') return false;
        row = { ...row, status: 'RUNNING', attempts: row.attempts + 1 };
        return true;
      }),
      updateJobTerminal,
    } as unknown as JobDataService;

    const toolService = {
      invoke: mock(async () => {
        throw AgenticEngineError.fromCode('UPSTREAM_NETWORK_TIMEOUT', 'upstream timeout');
      }),
    } as unknown as ToolService;

    const r = await runToolCallProcessor(
      { jobId: J, tenant: 1, toolName: 'platform.flow.invoke', args: { flowId: '1' } },
      { jobData, toolService },
    );
    expect(r.ok).toBe(false);
    const args = updateJobTerminal.mock.calls[0] as unknown as [
      string,
      'FAILED',
      {
        errorCode?: string;
        errorDetail?: { suggestedActions?: Array<{ type: string; toolName: string }> };
      },
    ];
    expect(args[2].errorCode).toBe('UPSTREAM_NETWORK_TIMEOUT');
    expect(args[2].errorDetail?.suggestedActions?.[0]).toEqual({
      type: 'retry_tool',
      toolName: 'platform.flow.invoke',
    });
  });

  it('already terminal — skips invoke', async () => {
    const row = jobRow({ status: 'COMPLETED' });
    const jobData = {
      findJobById: mock(async () => row),
      tryMarkJobRunning: mock(async () => false),
      updateJobTerminal: mock(async () => {}),
    } as unknown as JobDataService;
    const invoke = mock(async () => ({}));
    const toolService = { invoke } as unknown as ToolService;

    const r = await runToolCallProcessor(
      { jobId: J, tenant: 1, toolName: 'builtin:x', args: {} },
      { jobData, toolService },
    );
    expect(r.ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('hydrates turn runtimeRefs for async tool dispatch', async () => {
    let row = jobRow();
    const runtimeRefs = {
      knowledgeBases: [{ kbId: 'kb-1', displayName: 'KB' }],
    };
    const jobData = {
      findJobById: mock(async () => ({ ...row })),
      tryMarkJobRunning: mock(async () => {
        if (row.status !== 'QUEUED') return false;
        row = { ...row, status: 'RUNNING', attempts: row.attempts + 1 };
        return true;
      }),
      updateJobTerminal: mock(async () => {}),
      getTurnRuntimeRefs: mock(async () => runtimeRefs),
    } as unknown as JobDataService;

    const invoke = mock(async () => ({ ok: true }));
    const toolService = { invoke } as unknown as ToolService;

    await runToolCallProcessor(
      { jobId: J, tenant: 1, toolName: 'platform.knowledge.query', args: { query: 'hi' } },
      { jobData, toolService },
    );

    expect(invoke).toHaveBeenCalled();
    const ctx = (invoke.mock.calls[0] as unknown as [string, unknown, { turn?: { runtimeRefs?: unknown } }])[2];
    expect(ctx.turn?.runtimeRefs).toEqual(runtimeRefs);
  });
});
