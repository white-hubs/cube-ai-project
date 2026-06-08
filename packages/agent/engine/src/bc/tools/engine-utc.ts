/**
 * 在 session 创建时一次性追加到 system prompt 末尾的 UTC 时钟块。
 *
 * 设计：时间锚点随 `agent_snapshot_json.agent.content.prompt` 一起冻结进 snapshot；
 * 整个 session 复用同一个时间戳，不再在每个 turn 重复注入。对"现在几点 / 今天几号"
 * 这类需要新鲜时间的查询，模型应调用 `currentDate` 工具（若可用）。
 */

const CLOCK_APPEND_BODY = `Session-start time (UTC): iso={iso}; epochMs={epochMs}.
Note: This timestamp was captured when the session started and may be stale for long-running sessions. For fresh time/date queries (e.g. "今天几号", "现在几点"), call the \`currentDate\` tool if it is available. When the user says "today" or "tomorrow" without a timezone, interpret calendar boundaries in UTC; this may differ from the user's local civil date around midnight.`;

/** 供单测钉死换行与固定文案（不含动态 iso/epoch）。 */
export const ENGINE_UTC_CLOCK_APPEND_PREFIX = '---\n';

export function formatEngineUtcClockAppend(nowMs: number): string {
  const iso = new Date(nowMs).toISOString();
  return `${ENGINE_UTC_CLOCK_APPEND_PREFIX}${CLOCK_APPEND_BODY.replace('{iso}', iso).replace(
    '{epochMs}',
    String(nowMs),
  )}`;
}

/**
 * 在非空 system 指令末尾追加 session-start UTC 时钟块（双换行分隔）。
 * `systemInstruction` 仅空白时原样返回（调用方应避免对纯空白快照注入）。
 *
 * 唯一调用点：`SessionService.buildSnapshots`。EngineFactory 不再每轮调用本函数。
 */
export function appendEngineUtcClockBlock(systemInstruction: string, nowMs: number = Date.now()): string {
  if (systemInstruction.trim().length === 0) return systemInstruction;
  const trimmed = systemInstruction.trimEnd();
  const block = formatEngineUtcClockAppend(nowMs);
  return `${trimmed}\n\n${block}`;
}
