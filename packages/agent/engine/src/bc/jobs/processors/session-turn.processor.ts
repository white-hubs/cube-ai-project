/**
 * Session-Turn / Long-Running Tool processor — `agentic-engine-long-running-jobs` queue.
 *
 * ref: long-running-runtime.md §3 / bullmq-protocol.md §2.1 / P3-09
 */
import { BullMQJobPayloadSchema, type BullMQJobPayload } from '@cube-ai/contracts';
import type { AdapterCallContext, ChatRequest, ProviderAdapter } from '@tachu/core';
import { DEFAULT_ADAPTER_CALL_CONTEXT } from '@tachu/core';
import type { JobDataService } from '../job-data.service';
import type { JobRow } from '../job-data.types';
import { MockOboService } from '../../auth/mock-obo.service';
import type { SfidService } from '../../../infra/sfid/sfid.service';

/** BullMQ job name for long-running tool execution (bullmq-protocol §2.1) */
export const LONG_RUNNING_JOB_NAME = 'long-running-tool' as const;

/** P3-09 alternative job name — same handler */
export const SESSION_TURN_DISPATCH_JOB_NAME = 'session.turn.dispatch' as const;

export interface JobPrincipalV1 {
  schema?: string;
  userId: string;
  tenant: number;
  scopes: string[];
  oboAudiencesNeeded?: string[];
  capturedTime?: number;
}

export interface SessionTurnProcessorDeps {
  jobData: JobDataService;
  obo: MockOboService;
  provider: ProviderAdapter;
  sfid: SfidService;
  defaultModel: string;
}

function buildToolInputFromJob(inputJson: string): { userText: string; raw: unknown } {
  let raw: unknown;
  try {
    raw = JSON.parse(inputJson) as unknown;
  } catch {
    return { userText: inputJson, raw: inputJson };
  }
  if (raw && typeof raw === 'object' && 'messages' in (raw as object)) {
    const messages = (raw as { messages?: { content?: string }[] }).messages;
    const last = messages?.[messages.length - 1]?.content;
    return { userText: typeof last === 'string' ? last : JSON.stringify(raw), raw };
  }
  return { userText: JSON.stringify(raw), raw };
}

async function finalizeSuccess(
  deps: SessionTurnProcessorDeps,
  job: JobRow,
  resultText: string,
): Promise<void> {
  await deps.jobData.updateJobTerminal(job.id, 'COMPLETED', {
    resultRef: { text: resultText },
  });

  const ox1 = deps.sfid.next();
  await deps.jobData.appendOutboxWithId(ox1, {
    tenant: job.tenant,
    channel: 'message_service',
    eventType: 'job.completed',
    payloadJson: { jobId: job.id, tenant: job.tenant, status: 'COMPLETED' },
    target: null,
  });

  if (job.sessionId && job.turnId) {
    const ox2 = deps.sfid.next();
    await deps.jobData.appendOutboxWithId(ox2, {
      tenant: job.tenant,
      channel: 'message_service',
      eventType: 'turn.completed-v1',
      payloadJson: {
        sessionId: job.sessionId,
        turnId: job.turnId,
        tenant: job.tenant,
      },
      target: null,
    });

    const msgId = deps.sfid.next();
    const seq = await deps.jobData.nextMessageSeqForTurn(job.turnId);
    await deps.jobData.insertAssistantMessage({
      id: msgId,
      tenant: job.tenant,
      sessionId: job.sessionId,
      turnId: job.turnId,
      seq,
      contentJson: [{ type: 'text', text: resultText }],
      toolCallId: job.toolCallId,
    });
  }
}

export async function runSessionTurnProcessor(
  data: unknown,
  deps: SessionTurnProcessorDeps,
): Promise<{ ok: boolean }> {
  const parseResult = BullMQJobPayloadSchema.safeParse(data);
  if (!parseResult.success) {
    throw new Error(
      `Invalid BullMQ job payload: ${parseResult.error.message}`,
    );
  }

  const payload: BullMQJobPayload = parseResult.data;

  const job = await deps.jobData.findJobById(payload.jobId);
  if (!job) {
    throw new Error(`jobs row not found: ${payload.jobId}`);
  }

  const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
  if (terminal.has(job.status)) {
    return { ok: true };
  }

  const nowMs = Date.now();
  if (nowMs > job.overallDeadlineTime.getTime()) {
    await deps.jobData.updateJobTerminal(job.id, 'FAILED', {
      errorCode: 'JOB_OVERALL_DEADLINE_EXCEEDED',
      errorDetail: { reason: 'overall_deadline_time passed before execution' },
    });
    return { ok: false };
  }

  if (job.attempts >= job.maxAttempts) {
    await deps.jobData.updateJobTerminal(job.id, 'FAILED', {
      errorCode: 'JOB_MAX_ATTEMPTS_EXCEEDED',
      errorDetail: { attempts: job.attempts },
    });
    return { ok: false };
  }

  const acquired = await deps.jobData.tryMarkJobRunning(job.id);
  if (!acquired) {
    return { ok: true };
  }

  const fresh = await deps.jobData.findJobById(payload.jobId);
  if (!fresh || fresh.status !== 'RUNNING') {
    return { ok: true };
  }

  let principal: JobPrincipalV1;
  try {
    principal = JSON.parse(
      fresh.principalSnapshotJson,
    ) as JobPrincipalV1;
  } catch {
    await deps.jobData.updateJobTerminal(job.id, 'FAILED', {
      errorCode: 'INVALID_ARGUMENT_JSON',
      errorDetail: { field: 'principal_snapshot_json' },
    });
    return { ok: false };
  }

  const audiences = principal.oboAudiencesNeeded?.length
    ? principal.oboAudiencesNeeded
    : ['app.flow'];

  try {
    await deps.obo.exchange({
      subjectUserId: principal.userId,
      tenant: principal.tenant,
      audience: audiences[0] ?? 'app.flow',
      targetScope: principal.scopes?.length ? [...principal.scopes] : ['engine.use'],
      ttlHintSeconds: 600,
      traceId: `job:${job.id}`,
    });
  } catch (e) {
    await deps.jobData.requeueJobAfterRetryableFailure(job.id);
    throw e instanceof Error ? e : new Error(String(e));
  }

  const { userText } = buildToolInputFromJob(fresh.inputSnapshotJson);
  const model =
    process.env['AGENTIC_ENGINE_WORKER_MODEL'] ??
    process.env['AGENTIC_ENGINE_OPENAI_MODEL'] ??
    deps.defaultModel;

  const request: ChatRequest = {
    model,
    messages: [{ role: 'user', content: userText }],
  };

  const ac = new AbortController();
  const signal = ac.signal;

  try {
    const callCtx: AdapterCallContext = {
      ...DEFAULT_ADAPTER_CALL_CONTEXT,
      correlation: {
        traceId:   `job:${job.id}`,
        requestId: `job:${job.id}`,
        sessionId: fresh.sessionId ?? 'unknown-session',
        turnId:    fresh.turnId ?? `job:${job.id}`,
      },
      subject: {
        tenant: String(principal.tenant),
        userId: principal.userId,
      },
      tenant: principal.tenant,
    };
    const response = await deps.provider.chat(request, callCtx, signal);
    const text = response.content;

    await finalizeSuccess(deps, fresh, text);
    return { ok: true };
  } catch (err) {
    if (fresh.attempts >= fresh.maxAttempts) {
      await deps.jobData.updateJobTerminal(job.id, 'FAILED', {
        errorCode: 'INTERNAL_LLM_INVOCATION_FAILED',
        errorDetail: {
          message: err instanceof Error ? err.message : String(err),
        },
      });
      return { ok: false };
    }
    await deps.jobData.requeueJobAfterRetryableFailure(job.id);
    throw err instanceof Error ? err : new Error(String(err));
  }
}
