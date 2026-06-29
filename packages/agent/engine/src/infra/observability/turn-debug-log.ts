/**
 * Opt-in full turn I/O in pino debug logs (stdout JSON reconstruction).
 *
 * Enable with `AGENTIC_ENGINE_LOG_LEVEL=debug|trace` (or `LOG_LEVEL=debug|trace`).
 * Field names avoid logger.factory REDACTION_PATHS (`*.message.content`, `*.tool.args`, `*.tool.result`).
 */

export const MAX_DEBUG_BODY_CHARS = 50_000;

export function isTurnDebugLogEnabled(): boolean {
  const level = (process.env["AGENTIC_ENGINE_LOG_LEVEL"] ?? process.env["LOG_LEVEL"] ?? "").toLowerCase();
  return level === "debug" || level === "trace";
}

export function serializeDebugBody(value: unknown, maxChars = MAX_DEBUG_BODY_CHARS): { body: string; bodyTruncated: boolean } {
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (serialized.length <= maxChars) {
      return { body: serialized, bodyTruncated: false };
    }
    const omitted = serialized.length - maxChars;
    return {
      body: `${serialized.slice(0, maxChars)}…[truncated ${omitted} chars]`,
      bodyTruncated: true,
    };
  } catch {
    return { body: String(value), bodyTruncated: false };
  }
}

/** e.g. `debugBodyField('promptBody', prompt)` → `{ promptBody, promptBodyTruncated }` */
export function debugBodyField(fieldName: string, value: unknown): Record<string, unknown> | undefined {
  if (!isTurnDebugLogEnabled()) return undefined;
  const { body, bodyTruncated } = serializeDebugBody(value);
  return {
    [fieldName]: body,
    [`${fieldName}Truncated`]: bodyTruncated,
  };
}

/** @deprecated use isTurnDebugLogEnabled */
export const isToolInvokeDebugLogEnabled = isTurnDebugLogEnabled;

/** @deprecated use debugBodyField('resultBody', result) */
export function formatResultBodyForDebugLog(result: unknown): { resultBody: string; resultBodyTruncated: boolean } | undefined {
  const fields = debugBodyField("resultBody", result);
  if (!fields) return undefined;
  return {
    resultBody: fields.resultBody as string,
    resultBodyTruncated: fields.resultBodyTruncated as boolean,
  };
}
