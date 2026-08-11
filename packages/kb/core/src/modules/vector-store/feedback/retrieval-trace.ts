/**
 * W4.2-H3 — retrieval ↔ feedback trace correlation.
 *
 * Canonical field name: `traceId` (same as KnowledgeQueryRequest.traceId / W1.4 live).
 * HTTP search may accept body.traceId or X-Trace-Id / x-trace-id and echo it on the response.
 */

export const RETRIEVAL_TRACE_ID_MAX_LEN = 128;

export function normalizeRetrievalTraceId(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > RETRIEVAL_TRACE_ID_MAX_LEN) {
    return undefined;
  }
  return trimmed;
}

/** Prefer explicit body value, then common trace headers. */
export function resolveRetrievalTraceId(input: { bodyTraceId?: unknown; headerTraceId?: string | null }): string | undefined {
  return normalizeRetrievalTraceId(input.bodyTraceId) ?? normalizeRetrievalTraceId(input.headerTraceId ?? undefined);
}

export function extractTraceIdHeader(headers: { get(name: string): string | null }): string | null {
  return headers.get("x-trace-id") ?? headers.get("X-Trace-Id") ?? headers.get("X-TRACE-ID");
}
