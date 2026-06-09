import { Controller, GET, POST, Context, contextStore } from '@dangao/bun-server';
import { JobSchema } from '@cube-ai/contracts';
import type { DualSubject } from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { JobDataService } from './job-data.service';
import type { JobRow } from './job-data.types';

function requireCtx(): Context {
  const ctx = contextStore.getStore();
  if (!ctx) {
    throw AgenticEngineError.fromCode(
      'INTERNAL_UNKNOWN',
      'Request Context missing — ensure ContextStore middleware is active',
      {},
    );
  }
  return ctx;
}

function readSubject(ctx: Context): DualSubject {
  const subj = (ctx as unknown as { state?: { subject?: DualSubject } }).state?.subject;
  if (!subj?.user?.userId) {
    throw AgenticEngineError.fromCode('UNAUTHENTICATED_TOKEN_INVALID', 'Authentication required', {});
  }
  return subj;
}

function readJobIdPathParam(ctx: Context): string {
  const pathStr = ctx.path;
  if (pathStr) {
    const m = pathStr.match(/\/jobs\/(\d{19})(?::cancel|\/|$)/);
    if (m?.[1]) return m[1];
  }
  return ctx.getParam('jobId') ?? '';
}

function mapKind(kind: string): 'BUILTIN' | 'EXT' | 'MCP' | 'MEMORY_PURGE' | 'SESSION_GC' {
  if (kind === 'MCP_DISCOVERY') return 'MCP';
  if (kind === 'OUTBOX') return 'MEMORY_PURGE';
  if (kind === 'CLEANUP') return 'SESSION_GC';
  return 'BUILTIN';
}

function mapStatus(row: JobRow): 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'DEAD' {
  if (row.status === 'FAILED' && row.attempts >= row.maxAttempts) return 'DEAD';
  return row.status;
}

function parseJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toJobView(row: JobRow) {
  const createTimeMs = row.createTime ? row.createTime.getTime() : Date.now();
  const updateTimeMs = row.updateTime ? row.updateTime.getTime() : createTimeMs;
  const errorDetail = parseJson(row.errorDetailJson ?? null);
  return JobSchema.parse({
    id: row.id,
    jobKind: mapKind(row.kind),
    toolRef: row.toolRef,
    toolName: row.toolRef,
    status: mapStatus(row),
    attempts: row.attempts,
    sessionId: row.sessionId,
    turnId: row.turnId,
    toolCallId: row.toolCallId,
    queuedTime: createTimeMs,
    startTime: row.startTime ? row.startTime.getTime() : null,
    endTime: row.endTime ? row.endTime.getTime() : null,
    progress: null,
    resultSummary: parseJson(row.resultRefJson ?? null),
    error: row.errorCode
      ? {
          code: row.errorCode,
          message:
            (errorDetail?.['message'] as string | undefined) ??
            row.errorCode,
        }
      : null,
    createTime: createTimeMs,
    updateTime: updateTimeMs,
  });
}

@Controller('/jobs')
export class JobsController {
  constructor(private readonly jobData: JobDataService) {}

  @GET('/:jobId')
  async getJob(): Promise<unknown> {
    const ctx = requireCtx();
    const jobId = readJobIdPathParam(ctx);
    const subject = readSubject(ctx);
    const row = await this.jobData.findJobById(jobId);
    if (!row || row.tenant !== subject.tenant) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_JOB',
        `Job ${jobId} not found`,
        { jobId },
      );
    }
    return toJobView(row);
  }

  @POST('/:jobId:cancel')
  async cancelJob(): Promise<{ ok: boolean }> {
    const ctx = requireCtx();
    const jobId = readJobIdPathParam(ctx);
    const subject = readSubject(ctx);
    const row = await this.jobData.findJobById(jobId);
    if (!row || row.tenant !== subject.tenant) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_JOB',
        `Job ${jobId} not found`,
        { jobId },
      );
    }
    const terminal = row.status === 'COMPLETED' || row.status === 'FAILED' || row.status === 'CANCELLED';
    if (terminal) {
      return { ok: true };
    }
    const ok = await this.jobData.cancelJobDb(jobId);
    return { ok };
  }
}

