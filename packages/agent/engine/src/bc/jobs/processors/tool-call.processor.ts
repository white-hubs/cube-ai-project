/**
 * Tool-Call Processor — BullMQ job that executes a Tool via ToolService.invoke.
 *
 * ref: P3-09 §3.3 / P1-08-tools
 */
import { z } from 'zod';
import type { ToolService } from '../../tools/tool.service';
import type { ToolHandlerCtx } from '../../tools/tool-context';
import type { JobDataService } from '../job-data.service';
import type { JobRow } from '../job-data.types';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';

export const TOOL_CALL_JOB_NAME = 'tool.call.dispatch' as const;

export const ToolCallJobPayloadSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/),
  tenant: z.number().int().positive(),
  toolName: z.string().min(1),
  args: z.unknown(),
});

export type ToolCallJobPayload = z.infer<typeof ToolCallJobPayloadSchema>;

const RETRYABLE_TOOL_ERROR_CODES = new Set<string>([
  'UPSTREAM_TOOL_HTTP_FAILED',
  'UPSTREAM_NETWORK_TIMEOUT',
  'UNAVAILABLE_UPSTREAM_5XX',
  'DEADLINE_EXCEEDED_UPSTREAM',
  'UNAVAILABLE_NETWORK',
]);

function isRetryableToolError(err: unknown): boolean {
  if (err instanceof AgenticEngineError) {
    return RETRYABLE_TOOL_ERROR_CODES.has(err.code);
  }
  return false;
}

export interface ToolCallProcessorDeps {
  jobData: JobDataService;
  toolService: ToolService;
}

function buildCtxFromJob(job: JobRow, signal: AbortSignal): ToolHandlerCtx {
  let principal: { userId?: string; tenant?: number; scopes?: string[] };
  try {
    principal = JSON.parse(job.principalSnapshotJson) as {
      userId?: string;
      tenant?: number;
      scopes?: string[];
    };
  } catch {
    principal = {};
  }
  const tenant = principal.tenant ?? job.tenant;
  const uid = principal.userId ?? job.userId ?? 'unknown';
  const scopes = principal.scopes ?? ['engine.use'];

  return {
    traceId: `tool-job:${job.id}`,
    signal,
    auth: {
      tenant,
      user: { userId: uid, scopes },
    },
    session: {
      id: job.sessionId ?? '0',
      turnId: job.turnId ?? '0',
    },
  };
}

export async function runToolCallProcessor(
  data: unknown,
  deps: ToolCallProcessorDeps,
): Promise<{ ok: boolean }> {
  const parsed = ToolCallJobPayloadSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid tool-call payload: ${parsed.error.message}`);
  }
  const p = parsed.data;

  const job = await deps.jobData.findJobById(p.jobId);
  if (!job) throw new Error(`jobs row not found: ${p.jobId}`);

  const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
  if (terminal.has(job.status)) return { ok: true };

  const acquired = await deps.jobData.tryMarkJobRunning(job.id);
  if (!acquired) return { ok: true };

  const fresh = await deps.jobData.findJobById(p.jobId);
  if (!fresh || fresh.status !== 'RUNNING') return { ok: true };

  const ac = new AbortController();
  let ctx = buildCtxFromJob(fresh, ac.signal);
  if (fresh.turnId) {
    const runtimeRefs = await deps.jobData.getTurnRuntimeRefs?.(fresh.turnId, fresh.tenant);
    if (runtimeRefs !== undefined) {
      ctx = { ...ctx, turn: { runtimeRefs } };
    }
  }

  try {
    const output = await deps.toolService.invoke(p.toolName, p.args, ctx);
    await deps.jobData.updateJobTerminal(job.id, 'COMPLETED', {
      resultRef: output,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof AgenticEngineError ? err.code : 'TOOL_EXECUTION_FAILED';
    const retryable = isRetryableToolError(err);
    await deps.jobData.updateJobTerminal(job.id, 'FAILED', {
      errorCode: code,
      errorDetail: {
        message,
        ...(retryable
          ? {
              suggestedActions: [{ type: 'retry_tool', toolName: p.toolName }],
            }
          : {}),
      },
    });
    return { ok: false };
  }
}
