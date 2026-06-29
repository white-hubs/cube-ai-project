/**
 * Lightweight, opt-in debug logger for the DI-less provider layer.
 *
 * These provider classes are constructed via plain factories (no pino / DI),
 * so this helper emits single-line JSON to stderr only when explicitly enabled.
 * It is intended for diagnosing whether/which upstream LLM calls actually fire
 * (e.g. confirming intent classification really hits the model).
 *
 * Enable with either:
 *   - `AGENTIC_LLM_DEBUG=1`
 *   - `AGENTIC_ENGINE_LOG_LEVEL=debug` (or `trace`), or `LOG_LEVEL=debug|trace`
 *
 * NEVER pass secrets (apiKey, tokens) into `fields`.
 */
function debugEnabled(): boolean {
  if (truthy(process.env["AGENTIC_LLM_DEBUG"])) {
    return true;
  }
  const level = (process.env["AGENTIC_ENGINE_LOG_LEVEL"] ?? process.env["LOG_LEVEL"] ?? "").toLowerCase();
  return level === "debug" || level === "trace";
}

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "TRUE";
}

export function llmDebug(msg: string, fields: Record<string, unknown>): void {
  if (!debugEnabled()) {
    return;
  }
  try {
    process.stderr.write(`${JSON.stringify({ ns: "cube-ai.llm.provider", msg, time: Date.now(), ...fields })}\n`);
  } catch {
    // logging must never throw into the request path
  }
}
