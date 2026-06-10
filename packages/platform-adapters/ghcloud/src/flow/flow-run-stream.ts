import {
  FlowInvokeSyncResponseSchema,
  LegacyFlowScheduledEnvelopeSchema,
  type FlowExecutionTraceItem,
  type FlowInvokeSyncResponse,
} from '@cube-ai/contracts';
import { GhcloudPlatformError } from '../errors';

const TERMINAL_EVENT_KINDS = new Set([
  'done',
  'complete',
  'completed',
  'end',
  'finish',
  'finished',
  'result',
  'error',
  'failed',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isLegacyScheduledPayload(value: unknown): boolean {
  const parsed = LegacyFlowScheduledEnvelopeSchema.safeParse(value);
  return parsed.success;
}

export function rejectLegacyScheduledPayload(value: unknown, source: string): void {
  if (!isLegacyScheduledPayload(value)) return;
  throw GhcloudPlatformError.fromCode(
    'FAILED_PRECONDITION_UPSTREAM',
    `${source} returned async job envelope (scheduled=true); engine requires synchronous flow completion — use run-stream aggregation or configure ai-application sync /run for X-Engine-Caller`,
    { upstream: value },
  );
}

export function remotePayloadToSyncResponse(body: unknown): FlowInvokeSyncResponse {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw GhcloudPlatformError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      'flow run remote body must be a JSON object',
    );
  }
  const o = body as Record<string, unknown>;
  rejectLegacyScheduledPayload(o, 'flow run');

  if (
    'result' in o &&
    typeof o['result'] === 'object' &&
    o['result'] !== null &&
    !Array.isArray(o['result'])
  ) {
    const nested = o['result'] as Record<string, unknown>;
    rejectLegacyScheduledPayload(nested, 'flow run result');
    return FlowInvokeSyncResponseSchema.parse({
      result: nested,
      ...(Array.isArray(o['executionTrace']) ? { executionTrace: o['executionTrace'] } : {}),
      ...(typeof o['traceTruncated'] === 'boolean' ? { traceTruncated: o['traceTruncated'] } : {}),
      ...(typeof o['partial'] === 'boolean' ? { partial: o['partial'] } : {}),
      ...('error' in o ? { error: o['error'] } : {}),
    });
  }

  return FlowInvokeSyncResponseSchema.parse({ result: o });
}

function eventKind(payload: Record<string, unknown>): string | undefined {
  for (const key of ['event', 'type', 'kind', 'phase', 'status'] as const) {
    const v = payload[key];
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase();
  }
  return undefined;
}

function extractResultRecord(payload: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ['result', 'outputs', 'output', 'data'] as const) {
    const v = payload[key];
    const rec = asRecord(v);
    if (rec && !isLegacyScheduledPayload(rec)) {
      if (key === 'data') {
        const nested = extractResultRecord(rec);
        if (nested) return nested;
        continue;
      }
      return rec;
    }
  }
  if (!isLegacyScheduledPayload(payload)) return payload;
  return null;
}

function traceItemFromPayload(payload: Record<string, unknown>): FlowExecutionTraceItem {
  const kind = eventKind(payload) ?? 'chunk';
  const item: FlowExecutionTraceItem = { kind };
  if (typeof payload['ts'] === 'string') item.ts = payload['ts'];
  else if (typeof payload['timestamp'] === 'string') item.ts = payload['timestamp'];
  item.payload = payload;
  return item;
}

export function aggregateFlowStreamEvents(events: unknown[]): FlowInvokeSyncResponse {
  const executionTrace: FlowExecutionTraceItem[] = [];
  let finalResult: Record<string, unknown> | null = null;
  let terminalError: unknown;

  for (const raw of events) {
    const payload = asRecord(raw);
    if (!payload) continue;

    rejectLegacyScheduledPayload(payload, 'flow run-stream chunk');

    const kind = eventKind(payload);
    const resultCandidate = extractResultRecord(payload);
    if (resultCandidate && (!kind || TERMINAL_EVENT_KINDS.has(kind))) {
      finalResult = resultCandidate;
    } else if (resultCandidate && !finalResult) {
      finalResult = resultCandidate;
    }

    if (kind === 'error' || kind === 'failed') {
      terminalError = payload['error'] ?? payload['message'] ?? payload;
    }

    executionTrace.push(traceItemFromPayload(payload));
  }

  if (!finalResult) {
    throw GhcloudPlatformError.fromCode(
      'UPSTREAM_TOOL_HTTP_FAILED',
      'flow run-stream ended without a final result payload',
      { traceItems: executionTrace.length, terminalError },
    );
  }

  return FlowInvokeSyncResponseSchema.parse({
    result: finalResult,
    ...(executionTrace.length > 0 ? { executionTrace } : {}),
    ...(terminalError !== undefined ? { error: terminalError } : {}),
  });
}

export function parseSseDataLines(text: string): unknown[] {
  const events: unknown[] = [];
  const blocks = text.split(/\r?\n\r?\n/u);
  for (const block of blocks) {
    const dataLines = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    const joined = dataLines.join('\n').trim();
    if (!joined || joined === '[DONE]') continue;
    try {
      events.push(JSON.parse(joined) as unknown);
    } catch {
      events.push({ kind: 'text', payload: joined });
    }
  }
  return events;
}

export function parseNdjsonLines(text: string): unknown[] {
  const events: unknown[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as unknown);
    } catch {
      events.push({ kind: 'text', payload: trimmed });
    }
  }
  return events;
}

export function parseFlowStreamBody(text: string, contentType: string | null): unknown[] {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('text/event-stream') || text.includes('data:')) {
    return parseSseDataLines(text);
  }
  if (ct.includes('application/x-ndjson') || ct.includes('application/jsonlines')) {
    return parseNdjsonLines(text);
  }
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return parseNdjsonLines(trimmed);
    }
  }
  return parseNdjsonLines(trimmed);
}

export async function consumeFlowRunStreamResponse(
  response: Response,
  signal: AbortSignal,
): Promise<FlowInvokeSyncResponse> {
  if (signal.aborted) {
    throw GhcloudPlatformError.fromCode(
      'UPSTREAM_NETWORK_TIMEOUT',
      'flow run-stream aborted by caller',
    );
  }

  const contentType = response.headers.get('content-type');
  const text = await response.text();
  if (!text.trim()) {
    throw GhcloudPlatformError.fromCode(
      'UPSTREAM_TOOL_HTTP_FAILED',
      'flow run-stream returned an empty body',
    );
  }

  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('application/json') && !text.includes('data:')) {
    return remotePayloadToSyncResponse(JSON.parse(text) as unknown);
  }

  const events = parseFlowStreamBody(text, contentType);
  if (events.length === 0) {
    throw GhcloudPlatformError.fromCode(
      'UPSTREAM_TOOL_HTTP_FAILED',
      'flow run-stream body could not be parsed into events',
    );
  }
  if (events.length === 1) {
    const only = asRecord(events[0]);
    if (only && !eventKind(only)) {
      return remotePayloadToSyncResponse(only);
    }
  }
  return aggregateFlowStreamEvents(events);
}

export function buildRunStreamRequestBody(variables: Record<string, unknown> | undefined): Record<string, unknown> {
  const tweaks = { ...(variables ?? {}) };
  const body: Record<string, unknown> = {
    inputType: 'chat',
    outputType: 'chat',
    tweaks,
  };
  const prompt = tweaks['prompt'];
  if (typeof prompt === 'string' && prompt.trim()) {
    body.input = prompt.trim();
  }
  return body;
}
