import type { EngineOutput, StreamChunkPayload } from "@tachu/core";

import {
  type MessageCompletedEvent,
  type MessageDeltaEvent,
  type MessageResetEvent,
  type ReasoningDeltaEvent,
  type ReasoningStepEvent,
  type ToolCallCompletedEvent,
  type ToolProgressEvent,
  type ToolCallStartedEvent,
  type TurnCompletedEvent,
  type TurnFailedEvent,
  type UsageDeltaEvent,
} from "@cube-ai/contracts";

/**
 * Tachu StreamChunk → 本仓 SSE 事件协议的纯函数映射。
 *
 * 设计要点：
 *  - mapper 不做副作用、不知道 SSE 传输层。返回事件描述数组，TurnService 负责
 *    把它们 forward 给 SseEmitter。
 *  - 一次 chunk 调用产出 0~多个事件：例如 `done` 一次性产出（可选）message.delta 兜底
 *    + message.completed + usage.delta + turn.completed。
 *  - `state` 在调用间累加 `seqInTurn`、记录 `startTime` 以便算 `durationMs`。
 *  - progress chunk 会映射为 `tool.call.progress`；其余暂未消费的
 *    tachu chunk 类型（plan-preview / artifact）返回空数组，由 TurnService
 *    的循环按 no-op 处理。
 *    这是显式向前兼容策略：tachu 未来新增 chunk 类型不会让本仓崩。
 */

/**
 * loop-lifecycle 轮次里程碑 → 客户端展示标签的内置中文映射（mapper 默认）。
 *
 * tachu rc.13 起对外只暴露粗粒度轮次里程碑（`turnStart` / `turnStop`），不再泄漏
 * 内部 6 阶段名。与 SSE schema `reasoning-step-v1.label` 对齐：宿主可以在前端覆盖
 * 文案，但服务端永远发一份默认值，避免协议消费者还得自己维护翻译表。
 */
const LIFECYCLE_LABELS: Record<"turnStart" | "turnStop", string> = {
  turnStart: "开始处理",
  turnStop: "校验结果中",
};

/** Model reasoning 子 step 的默认标签。 */
const MODEL_REASONING_LABEL = "模型思考";
const TOOL_LOOP_LABEL_PREFIX = "工具循环";

/**
 * 已知调用种类 → `meta.activity` 语义标签（`reasoning-step-v1.kind` 的 tool-call 侧对应物）。
 * 供下游渲染「缩略思考态」直接查表，不必对 `toolName` / `label` 裸串猜测。
 *
 * 覆盖范围**刻意**只含 engine 自己拥有、名字稳定的运行时工具（web-search bridge、
 * `platform.knowledge.query`、`runtime.skill.refs`）。Agent descriptor 自定义声明的
 * `groundingPrefetch` 工具（如 ontology 查询）是**领域专属**名字，engine 域无关
 * （ADR-0031 §2），mapper 不臆猜其类目，落回通用 `tool`。
 *
 * 与 `RUNTIME_KNOWLEDGE_QUERY_TOOL_NAME` / `RUNTIME_SKILL_REFS_TOOL_NAME`
 * （`engine-factory.ts`）同名字符串——刻意本地复制而非跨文件 import，保持本
 * mapper 纯函数、零副作用边界（见文件头注释）；改名需同步两处，测试会兜底。
 */
const KNOWLEDGE_QUERY_TOOL_NAME = "platform.knowledge.query";
const SKILL_REFS_TOOL_NAME = "runtime.skill.refs";

type ToolCallActivity = "web-search" | "knowledge-retrieval" | "skill-load" | "tool";

function resolveToolCallActivity(toolName: string): ToolCallActivity {
  if (toolName.startsWith("mcp.web-search.")) return "web-search";
  if (toolName === KNOWLEDGE_QUERY_TOOL_NAME) return "knowledge-retrieval";
  if (toolName === SKILL_REFS_TOOL_NAME) return "skill-load";
  return "tool";
}

/**
 * tachu chunk 不携带 execution/consent；与 `McpBridgeService` 对 `web-search` 的 NEVER 对齐。
 * 其余工具默认安全档：LOCAL + ON_FIRST_USE。
 */
function toolCallStartedMeta(toolName: string): {
  execution: "LOCAL" | "REMOTE";
  consent: "NEVER" | "ON_FIRST_USE";
  activity: ToolCallActivity;
} {
  const activity = resolveToolCallActivity(toolName);
  if (toolName.startsWith("mcp.web-search.")) {
    return { execution: "REMOTE", consent: "NEVER", activity };
  }
  return { execution: "LOCAL", consent: "ON_FIRST_USE", activity };
}

function isBusinessDataMcpTool(toolName: string): boolean {
  return /^mcp\.[^.]+\.ask_business_data$/.test(toolName);
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function businessDataPayload(output: unknown): Record<string, unknown> | null {
  const envelope = parseJsonObject(output);
  if (!envelope) return null;
  return parseJsonObject(envelope.structuredContent) ?? envelope;
}

function safeClarificationText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || /mcp:\/\/|\bselect\b[\s\S]+\bfrom\b|\b(api[_-]?key|authorization|bearer|token|password|secret)\b/i.test(text)) {
    return null;
  }
  return text.slice(0, maxLength);
}

function safeClarificationOptions(value: unknown): Array<{ label: string }> {
  if (!Array.isArray(value)) return [];
  const labels = new Set<string>();
  for (const item of value.slice(0, 12)) {
    const record = parseJsonObject(item);
    const label = safeClarificationText(record?.label, 120);
    if (label) labels.add(label);
  }
  return [...labels].map((label) => ({ label }));
}

/**
 * Business-query MCP tools are allowed to return structured rows to the model,
 * but SSE tool events are UI telemetry, not model context. Keep only a safe
 * summary so the chat UI cannot accidentally render SQL/tool args/raw ids from
 * a tool payload. The final user answer must be produced by the model from the
 * governed tool result, and is still reconciled by the normal final-output path.
 */
function summarizeBusinessDataToolOutput(output: unknown): Record<string, unknown> {
  const parsed = businessDataPayload(output);
  const answer =
    parsed && typeof parsed.answer === "object" && !Array.isArray(parsed.answer) ? (parsed.answer as Record<string, unknown>) : {};
  const columns = Array.isArray(answer.columns) ? answer.columns : [];
  const rows = Array.isArray(answer.rows) ? answer.rows : [];
  const clarification =
    parsed && typeof parsed.clarification === "object" && !Array.isArray(parsed.clarification)
      ? (parsed.clarification as Record<string, unknown>)
      : {};
  const clarificationQuestion = safeClarificationText(clarification.question, 320);
  const clarificationOptions = safeClarificationOptions(clarification.options);
  const projected: Record<string, unknown> = {
    redacted: true,
    policy: "business-data-v1",
    status: typeof parsed?.status === "string" ? parsed.status : "unknown",
    summary:
      typeof answer.summary === "string" ? answer.summary : clarificationQuestion ? clarificationQuestion : "业务问数工具已返回结果。",
    columnCount: columns.length,
    rowCount: rows.length,
  };
  if (parsed?.status === "needs_clarification" && clarificationQuestion && clarificationOptions.length > 0) {
    projected.clarification = {
      question: clarificationQuestion,
      options: clarificationOptions,
    };
  }
  return projected;
}

function projectToolCallOutputForSse(toolName: string, output: unknown): unknown {
  if (isBusinessDataMcpTool(toolName)) return summarizeBusinessDataToolOutput(output);
  return output;
}

const PROGRESS_META_BLOCKED_KEYS = new Set([
  "sql",
  "query",
  "args",
  "arguments",
  "toolArgs",
  "token",
  "apiKey",
  "api_key",
  "authorization",
  "password",
  "secret",
  "rows",
  "output",
  "result",
  "message",
  "safeDisplayMessage",
  "display",
  "displayText",
]);

const PROGRESS_MESSAGE_FORBIDDEN_PATTERNS = [
  /mcp:\/\//i,
  /\bselect\b[\s\S]+\bfrom\b/i,
  /\b(insert|update|delete|drop|alter|truncate)\b/i,
  /\b(api[_-]?key|authorization|bearer|token|password|secret)\b/i,
  /[{}]/,
];

function safeProgressMeta(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (PROGRESS_META_BLOCKED_KEYS.has(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function safeProgressDisplayText(status: string, candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const text = candidate.trim();
    if (!text || text.length > 80) continue;
    if (PROGRESS_MESSAGE_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text))) continue;
    return text;
  }
  if (status.includes("semantic") || status.includes("plan")) return "正在理解问题并匹配业务口径";
  if (status.includes("query") || status.includes("sql")) return "正在查询并整理结果";
  if (status.includes("format") || status.includes("answer")) return "正在整理业务答案";
  return "正在处理";
}

function normalizeProgressValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value >= 0 && value <= 1) return value;
  if (value > 1 && value <= 100) return value / 100;
  return undefined;
}

function mapProgressChunkToEvent(state: TachuSseMapperState, chunk: StreamChunkPayload, now: () => number): SseEventDescriptor[] {
  const raw = chunk as StreamChunkPayload & {
    payload?: unknown;
    message?: unknown;
    progress?: unknown;
    percent?: unknown;
    status?: unknown;
    tool?: unknown;
    toolName?: unknown;
    callId?: unknown;
    toolCallId?: unknown;
  };
  const payload = parseJsonObject(raw.payload) ?? {};
  const status = String(payload.status ?? raw.status ?? "progress").trim() || "progress";
  const payloadDisplay = parseJsonObject(payload.display);
  const displayText = safeProgressDisplayText(status, [
    payload.safeDisplayMessage,
    payload.displayText,
    payloadDisplay?.text,
    payload.message,
    raw.message,
  ]);
  const toolNameRaw = payload.toolName ?? raw.toolName ?? raw.tool;
  const toolCallIdRaw = payload.toolCallId ?? raw.toolCallId ?? raw.callId;
  const progress = normalizeProgressValue(payload.progress ?? payload.percent ?? raw.progress ?? raw.percent);
  const meta = safeProgressMeta(payload);
  const event: ToolProgressEvent = {
    schema: "tool-call-progress-v1",
    turnId: state.turnId,
    status,
    display: { text: displayText },
    ...(progress !== undefined ? { progress } : {}),
    ...(typeof toolNameRaw === "string" && toolNameRaw.trim() ? { toolName: toolNameRaw } : {}),
    ...(typeof toolCallIdRaw === "string" && toolCallIdRaw.trim() ? { toolCallId: toolCallIdRaw } : {}),
    ...(meta !== undefined ? { meta } : {}),
    time: now(),
  };
  return [{ sseEvent: "tool.call.progress", payload: event }];
}

export interface TachuSseMapperState {
  turnId: string;
  messageId: string;
  /**
   * 已发出的 message.delta 序号；`MessageDeltaEvent.seqInTurn` 必须正整数，
   * 第一次发送时为 1。
   */
  seqInTurn: number;
  /** 本轮起始 epoch ms；用于 `turn.completed.durationMs` 计算。 */
  startTime: number;
  /**
   * 已 start、尚未收到 tachu `tool-call-end` 的工具（callId → 元信息）。
   * 部分 tachu 版本在结束 execution 阶段时可能漏发末次 `tool-call-end`；
   * 在 `done` / `error` / `forceCloseActiveReasoning` 前兜底补发 `tool.call.completed`。
   */
  pendingToolCalls: Map<string, { toolName: string; startedAt: number }>;
  /**
   * 进行中 tool-call 所属 reasoning step（callId → parent stepId）。
   * completed 复用 started 捕获到的 parent，避免 step 提前关闭时丢失归属。
   */
  toolCallParentStepIds: Map<string, string>;
  /**
   * 是否已 emit 过 turn.failed —— 防止 tachu 错误流出现多个 error chunk 时本仓
   * 重复上报 turn.failed（违反 SSE 协议唯一性）。
   */
  turnFailedEmitted: boolean;
  /** SFID 生成工厂：与 turnId/messageId 同体系。由 TurnService 注入。 */
  nextSfid: () => string;
  /** 当前活跃 lifecycle 伞 step 的 stepId；构成 `model-reasoning`/`tool-loop`/`tool-call` 子 step 的 parent。 */
  activeLifecycleStepId: string | null;
  /** 当前活跃 lifecycle 里程碑（仅用于 END 时回写 `point` 字段、与 START 严格对偶）。 */
  activeLifecyclePoint: "turnStart" | "turnStop" | null;
  /** 当前活跃 model-reasoning 子 step 的 stepId。 */
  activeModelReasoningStepId: string | null;
  /** 当前活跃 tool-loop 子 step 的 stepId。 */
  activeToolLoopStepId: string | null;
  /** 当前活跃 tool-loop step 序号（tachu loop step number）。 */
  activeToolLoopStepNumber: number | null;
  /** tachu loop step number → reasoning stepId。 */
  toolLoopStepIds: Map<number, string>;
  /** Step 范围 seq 计数器（key = stepId），与 message-delta 的 seqInTurn 解耦。 */
  seqByStep: Map<string, number>;
  /**
   * 客户端正文气泡「当前」已乐观流入、尚未被 `message.reset` 清空的分片
   * （Option B）。
   *
   * tachu rc.14 契约下所有 assistant 正文（叙述 / 失败恢复草稿 / 最终答案）都只经
   * `tool-loop-delta`（或 legacy `delta`）逐块吐出。mapper 到达即发 `message-delta-v1`
   * 进气泡（真流式），并把该段追加到此数组。一旦本步以 `reason !== "terminal"` 收尾，
   * 说明这段不是最终答案 → 发 `message.reset` 并清空本数组（气泡回到空）。
   *
   * 因此本数组恒等于「客户端气泡此刻显示的内容」，`done` 时据此与 `terminalDraft`
   * 对账：一致则不重发（真流式无闪烁），不一致才自愈（reset + 整段补发）。
   */
  liveAnswerChunks: string[];
}

export function createTachuSseMapperState(input: {
  turnId: string;
  messageId: string;
  startTime: number;
  /**
   * SFID 工厂：mapper 在 emit reasoning-step START 时调用一次。
   *
   * 由 TurnService 透传 `SfidService.next.bind(sfidService)`；测试时可注入
   * 单调计数 stub（如 `1820000000000000900` 起递增）。
   */
  nextSfid: () => string;
}): TachuSseMapperState {
  return {
    turnId: input.turnId,
    messageId: input.messageId,
    seqInTurn: 1,
    startTime: input.startTime,
    pendingToolCalls: new Map<string, { toolName: string; startedAt: number }>(),
    toolCallParentStepIds: new Map<string, string>(),
    turnFailedEmitted: false,
    nextSfid: input.nextSfid,
    activeLifecycleStepId: null,
    activeLifecyclePoint: null,
    activeModelReasoningStepId: null,
    activeToolLoopStepId: null,
    activeToolLoopStepNumber: null,
    toolLoopStepIds: new Map<number, string>(),
    seqByStep: new Map<string, number>(),
    liveAnswerChunks: [],
  };
}

export type SseEventDescriptor =
  | { sseEvent: "message.delta"; payload: MessageDeltaEvent }
  | { sseEvent: "message.reset"; payload: MessageResetEvent }
  | { sseEvent: "usage.delta"; payload: UsageDeltaEvent }
  | { sseEvent: "tool.call.started"; payload: ToolCallStartedEvent }
  | { sseEvent: "tool.call.completed"; payload: ToolCallCompletedEvent }
  | { sseEvent: "tool.call.progress"; payload: ToolProgressEvent }
  | { sseEvent: "message.completed"; payload: MessageCompletedEvent }
  | { sseEvent: "turn.completed"; payload: TurnCompletedEvent }
  | { sseEvent: "turn.failed"; payload: TurnFailedEvent }
  | { sseEvent: "reasoning.step"; payload: ReasoningStepEvent }
  | { sseEvent: "reasoning.delta"; payload: ReasoningDeltaEvent };

/**
 * 把单个 tachu StreamChunk 映射成 0~多个 SSE 事件。
 *
 * 关于错误处理：
 *  - 同一次 runStream 应只产生一次 `turn.failed`。tachu 的协议保证遇到 error 后
 *    生成器要么 `return` 要么继续 `yield`；当前阶段我们只在第一次 `error` chunk
 *    时映射，后续 error（理论上不应存在）需要由调用方做去重。本 mapper 本身
 *    无状态记忆"是否已 emit error"。D5 用例覆盖这一点。
 */
/**
 * 把 tachu 的 `argumentsPreview` 字段（一段 string，可能是 JSON 也可能是截断
 * 后的预览）尽力解析回 `Record<string, unknown>`。失败时返回 `{}`——SSE 协议
 * 字段保持完整，但调用方应知道 args 在该场景下不可用。
 */
function parseArgumentsPreview(preview: string): Record<string, unknown> {
  if (!preview) return {};
  try {
    const parsed = JSON.parse(preview) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* preview 是截断或非 JSON，按空对象处理 */
  }
  return {};
}

/**
 * tachu 偶发在 `done` 之前漏发末次 `tool-call-end`；补发 `tool.call.completed`，
 * 避免前端推理树里子任务卡在「进行中」而 turn 已结束。
 */
function flushPendingToolCalls(
  state: TachuSseMapperState,
  events: SseEventDescriptor[],
  now: () => number,
  outcome: { ok: true } | { ok: false; error: { code: string; message: string; retryable: boolean } },
): void {
  if (state.pendingToolCalls.size === 0) return;
  for (const [callId, meta] of Array.from(state.pendingToolCalls.entries())) {
    const parentStepId = state.toolCallParentStepIds.get(callId) ?? null;
    const durationMs = Math.max(0, Math.round(now() - meta.startedAt));
    const payload: ToolCallCompletedEvent = {
      schema: "tool-call-completed-v1",
      turnId: state.turnId,
      ...(parentStepId !== null ? { parentStepId } : {}),
      toolCallId: callId,
      toolName: meta.toolName,
      durationMs,
      ok: outcome.ok,
      ...(outcome.ok === false ? { error: outcome.error } : {}),
    };
    events.push({ sseEvent: "tool.call.completed", payload });
    state.pendingToolCalls.delete(callId);
    state.toolCallParentStepIds.delete(callId);
  }
}

/**
 * 关闭活跃的 model-reasoning 子 step（如有）。
 *
 * 触发场景（Q5 状态机 B）：
 *   - 收到 text-delta / tool-call-start / lifecycle exit / done
 *   - 收到 error（异常路径强制收尾，Q11a）
 *
 * `ok` 决定 END 事件的 ok 字段；正常收尾为 true，异常路径为 false。
 */
function closeActiveModelReasoning(
  state: TachuSseMapperState,
  events: SseEventDescriptor[],
  now: () => number,
  outcome: { ok: true } | { ok: false; code: string; message: string },
): void {
  const stepId = state.activeModelReasoningStepId;
  if (!stepId) return;
  const parentStepId = state.activeToolLoopStepId ?? state.activeLifecycleStepId;
  const payload: ReasoningStepEvent = {
    schema: "reasoning-step-v1",
    turnId: state.turnId,
    stepId,
    ...(parentStepId !== null ? { parentStepId } : {}),
    kind: "model-reasoning",
    event: "END",
    label: MODEL_REASONING_LABEL,
    ok: outcome.ok,
    ...(outcome.ok === false ? { error: { code: outcome.code, message: outcome.message } } : {}),
    time: now(),
  };
  events.push({ sseEvent: "reasoning.step", payload });
  state.activeModelReasoningStepId = null;
}

function closeActiveToolLoop(
  state: TachuSseMapperState,
  events: SseEventDescriptor[],
  now: () => number,
  outcome: { ok: true } | { ok: false; code: string; message: string },
): void {
  const stepId = state.activeToolLoopStepId;
  const stepNumber = state.activeToolLoopStepNumber;
  if (!stepId || stepNumber === null) return;
  const payload: ReasoningStepEvent = {
    schema: "reasoning-step-v1",
    turnId: state.turnId,
    stepId,
    ...(state.activeLifecycleStepId !== null ? { parentStepId: state.activeLifecycleStepId } : {}),
    kind: "tool-loop",
    event: "END",
    label: `${TOOL_LOOP_LABEL_PREFIX}第 ${stepNumber} 轮`,
    ok: outcome.ok,
    ...(outcome.ok === false ? { error: { code: outcome.code, message: outcome.message } } : {}),
    time: now(),
  };
  events.push({ sseEvent: "reasoning.step", payload });
  state.activeToolLoopStepId = null;
  state.activeToolLoopStepNumber = null;
}

/**
 * 强制关闭活跃的 lifecycle 伞 step（异常收尾或 done 兜底）。
 *
 * 调用方应先 `closeActiveModelReasoning` 再关 lifecycle；正常路径下 `lifecycle`
 * exit chunk 会主动关闭对偶的 step。
 */
function closeActiveLifecycle(
  state: TachuSseMapperState,
  events: SseEventDescriptor[],
  now: () => number,
  outcome: { ok: true } | { ok: false; code: string; message: string },
): void {
  const stepId = state.activeLifecycleStepId;
  const point = state.activeLifecyclePoint;
  if (!stepId || !point) return;
  closeActiveToolLoop(state, events, now, outcome);
  const payload: ReasoningStepEvent = {
    schema: "reasoning-step-v1",
    turnId: state.turnId,
    stepId,
    kind: "lifecycle",
    event: "END",
    label: LIFECYCLE_LABELS[point],
    point,
    ok: outcome.ok,
    ...(outcome.ok === false ? { error: { code: outcome.code, message: outcome.message } } : {}),
    time: now(),
  };
  events.push({ sseEvent: "reasoning.step", payload });
  state.activeLifecycleStepId = null;
  state.activeLifecyclePoint = null;
}

function nextSeqInStep(state: TachuSseMapperState, stepId: string): number {
  const cur = state.seqByStep.get(stepId) ?? 0;
  const next = cur + 1;
  state.seqByStep.set(stepId, next);
  return next;
}

/**
 * 从 tachu `done.output` 抽出与 `messages.content_json` 对齐的**可见正文**（纯文本），
 * 供 SSE 兜底：仅有 reasoning-delta、或最终答复只在 `done` 里时仍发 `message-delta-v1`。
 *
 * 逻辑与 `TurnService.engineOutputToPersistedContent` 的 string / array 分支一致，但只
 * 拼接 `type==='text'` 块，避免把非文本块 stringify 进用户气泡。
 */
export function extractUserVisibleAnswerText(output: EngineOutput): string {
  const raw = output.content;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    let acc = "";
    for (const block of raw) {
      if (block && typeof block === "object" && !Array.isArray(block)) {
        const b = block as { type?: unknown; text?: unknown };
        if (b.type === "text" && typeof b.text === "string") acc += b.text;
      }
    }
    return acc;
  }
  if (raw != null && typeof raw === "object" && "text" in raw) {
    const t = (raw as { text: unknown }).text;
    if (typeof t === "string") return t;
  }
  return "";
}

/**
 * 乐观把一段正文增量发进客户端气泡（`message-delta-v1`），并追加到 `liveAnswerChunks`
 * （= 气泡当前内容），供 `done` 对账。`delta` 与 `tool-loop-delta` 两条正文通道共用。
 */
function pushBubbleDelta(state: TachuSseMapperState, events: SseEventDescriptor[], text: string): void {
  state.liveAnswerChunks.push(text);
  const payload: MessageDeltaEvent = {
    schema: "message-delta-v1",
    turnId: state.turnId,
    messageId: state.messageId,
    seqInTurn: state.seqInTurn,
    delta: { type: "text", text },
  };
  state.seqInTurn += 1;
  events.push({ sseEvent: "message.delta", payload });
}

/**
 * 令客户端丢弃当前气泡内容（`message-reset-v1`），并清空 `liveAnswerChunks`。
 * 气泡为空时不发（避免噪声）。`reason` 透传 tachu 判别值 / mapper 自愈标记。
 */
function pushBubbleReset(state: TachuSseMapperState, events: SseEventDescriptor[], reason: string): void {
  if (state.liveAnswerChunks.length === 0) return;
  state.liveAnswerChunks = [];
  const payload: MessageResetEvent = {
    schema: "message-reset-v1",
    turnId: state.turnId,
    messageId: state.messageId,
    reason,
  };
  events.push({ sseEvent: "message.reset", payload });
}

/**
 * `done` 时把客户端气泡对齐到 `terminalDraft`（= listMessages 持久化正文）。
 *
 *  - 气泡当前内容（`liveAnswerChunks` 拼接 trim）== 最终正文 → 什么都不做：终答已在
 *    live 阶段逐字流出，真流式无闪烁（Option B 主路径）。
 *  - 不一致 → 自愈：先 `message.reset` 清掉脏气泡，再整段补一条 `message-delta-v1`。
 *    覆盖：非流式 provider、`empty-terminal`/异常兜底、以及终答段与 draft 的罕见错位。
 *
 * 契约：`message.completed` 不含正文，客户端仅靠 SSE 即可拼出与 listMessages 一致的答复。
 */
function reconcileFinalBubble(state: TachuSseMapperState, events: SseEventDescriptor[], output: EngineOutput): void {
  const expected = extractUserVisibleAnswerText(output).trim();
  const current = state.liveAnswerChunks.join("").trim();
  if (current === expected) return;
  pushBubbleReset(state, events, "final-reconcile");
  if (expected.length === 0) return;
  pushBubbleDelta(state, events, expected);
}

export function mapStreamChunkToSseEvents(
  state: TachuSseMapperState,
  chunk: StreamChunkPayload,
  now: () => number = Date.now,
): SseEventDescriptor[] {
  switch (chunk.type) {
    case "delta": {
      if (!chunk.content) return [];
      // 用户正文增量 → 隐含「模型已停止吐 reasoning」，关掉子 step（Q5 状态机 B）。
      // legacy 直连 `delta` 通道（老 engine）；与 tool-loop-delta 共用气泡逻辑，
      // 供 `done` 统一对账。rc.14 实际不再走这里（正文全经 tool-loop-delta）。
      const events: SseEventDescriptor[] = [];
      closeActiveModelReasoning(state, events, now, { ok: true });
      pushBubbleDelta(state, events, chunk.content);
      return events;
    }
    case "reasoning-delta": {
      if (!chunk.content) return [];
      const events: SseEventDescriptor[] = [];
      // 首次 reasoning-delta：开启 model-reasoning 子 step，parent = 当前 lifecycle 伞 step。
      let stepId = state.activeModelReasoningStepId;
      if (stepId === null) {
        stepId = state.nextSfid();
        state.activeModelReasoningStepId = stepId;
        const parentStepId = state.activeToolLoopStepId ?? state.activeLifecycleStepId;
        const startPayload: ReasoningStepEvent = {
          schema: "reasoning-step-v1",
          turnId: state.turnId,
          stepId,
          ...(parentStepId !== null ? { parentStepId } : {}),
          kind: "model-reasoning",
          event: "START",
          label: MODEL_REASONING_LABEL,
          time: now(),
        };
        events.push({ sseEvent: "reasoning.step", payload: startPayload });
      }
      const seq = nextSeqInStep(state, stepId);
      const deltaPayload: ReasoningDeltaEvent = {
        schema: "reasoning-delta-v1",
        turnId: state.turnId,
        stepId,
        seqInStep: seq,
        text: chunk.content,
        source: "model",
      };
      events.push({ sseEvent: "reasoning.delta", payload: deltaPayload });
      return events;
    }
    case "lifecycle": {
      // 对外只暴露粗粒度轮次里程碑（turnStart / turnStop）；其余 loop-lifecycle point
      // 按 no-op 处理（向前兼容：tachu 未来新增/surfacing 更多 point 不会让本仓崩）。
      if (chunk.point !== "turnStart" && chunk.point !== "turnStop") return [];
      const point = chunk.point;
      const events: SseEventDescriptor[] = [];
      if (chunk.status === "enter") {
        // 新里程碑进入前，防御性关掉活跃 model-reasoning 与上一个 lifecycle 伞 step。
        closeActiveModelReasoning(state, events, now, { ok: true });
        closeActiveLifecycle(state, events, now, { ok: true });
        state.toolLoopStepIds.clear();
        const stepId = chunk.stepId ?? state.nextSfid();
        state.activeLifecycleStepId = stepId;
        state.activeLifecyclePoint = point;
        const startPayload: ReasoningStepEvent = {
          schema: "reasoning-step-v1",
          turnId: state.turnId,
          stepId,
          kind: "lifecycle",
          event: "START",
          label: LIFECYCLE_LABELS[point],
          point,
          time: now(),
        };
        events.push({ sseEvent: "reasoning.step", payload: startPayload });
        return events;
      }
      // status === "exit"：先关子 step，再 END 对偶的 lifecycle step。
      closeActiveModelReasoning(state, events, now, { ok: true });
      closeActiveToolLoop(state, events, now, { ok: true });
      if (state.activeLifecycleStepId !== null && state.activeLifecyclePoint === point) {
        const endPayload: ReasoningStepEvent = {
          schema: "reasoning-step-v1",
          turnId: state.turnId,
          stepId: state.activeLifecycleStepId,
          kind: "lifecycle",
          event: "END",
          label: LIFECYCLE_LABELS[point],
          point,
          ok: chunk.ok ?? true,
          ...(chunk.ok === false
            ? {
                error: {
                  code: chunk.error?.code ?? "LIFECYCLE_FAILED",
                  message: chunk.error?.message ?? "lifecycle milestone exited with ok=false",
                },
              }
            : {}),
          time: now(),
        };
        events.push({ sseEvent: "reasoning.step", payload: endPayload });
        state.activeLifecycleStepId = null;
        state.activeLifecyclePoint = null;
      }
      return events;
    }
    case "usage": {
      if (chunk.usage === undefined || chunk.cumulative === undefined || chunk.attribution === undefined || chunk.accuracy === undefined) {
        // Legacy tachu UsageChunk only has cumulative `tokens`; keep ignoring it.
        return [];
      }
      const payload: UsageDeltaEvent = {
        schema: "usage-delta-v2",
        turnId: state.turnId,
        cumulative: {
          input: chunk.cumulative.input,
          output: chunk.cumulative.output,
          total: chunk.cumulative.total,
        },
        usage: {
          input: chunk.usage.input,
          output: chunk.usage.output,
          total: chunk.usage.total,
        },
        attribution: chunk.attribution,
        accuracy: chunk.accuracy,
        ...(chunk.terminal !== undefined ? { terminal: chunk.terminal } : {}),
      };
      return [{ sseEvent: "usage.delta", payload }];
    }
    case "progress": {
      return mapProgressChunkToEvent(state, chunk, now);
    }
    case "tool-loop-step": {
      const events: SseEventDescriptor[] = [];
      closeActiveModelReasoning(state, events, now, { ok: true });
      closeActiveToolLoop(state, events, now, { ok: true });
      const stepId = chunk.stepId ?? state.nextSfid();
      state.activeToolLoopStepId = stepId;
      state.activeToolLoopStepNumber = chunk.step;
      state.toolLoopStepIds.set(chunk.step, stepId);
      const payload: ReasoningStepEvent = {
        schema: "reasoning-step-v1",
        turnId: state.turnId,
        stepId,
        ...(state.activeLifecycleStepId !== null ? { parentStepId: state.activeLifecycleStepId } : {}),
        kind: "tool-loop",
        event: "START",
        label: `${TOOL_LOOP_LABEL_PREFIX}第 ${chunk.step} 轮`,
        time: now(),
        meta: { step: chunk.step, maxSteps: chunk.maxSteps },
      };
      events.push({ sseEvent: "reasoning.step", payload });
      return events;
    }
    case "tool-loop-delta": {
      if (!chunk.content) return [];
      const events: SseEventDescriptor[] = [];
      closeActiveModelReasoning(state, events, now, { ok: true });
      // 双通道（Option B）：
      //  1) reasoning.delta —— 叙述/过程始终进「思考区」（tool-loop 子 step 下）。
      //  2) message.delta —— 乐观进正文气泡（真流式）；本步若非 terminal 收尾，
      //     tool-loop-step-end 会补 message.reset 把这段清掉，只有 terminal 段留存。
      const stepId =
        chunk.stepId ??
        state.toolLoopStepIds.get(chunk.step) ??
        (state.activeToolLoopStepNumber === chunk.step ? state.activeToolLoopStepId : null);
      if (stepId) {
        const seq = nextSeqInStep(state, stepId);
        const payload: ReasoningDeltaEvent = {
          schema: "reasoning-delta-v1",
          turnId: state.turnId,
          stepId,
          seqInStep: seq,
          text: chunk.content,
          source: "tool-loop",
        };
        events.push({ sseEvent: "reasoning.delta", payload });
      }
      pushBubbleDelta(state, events, chunk.content);
      return events;
    }
    case "tool-loop-step-end": {
      const events: SseEventDescriptor[] = [];
      // Option B：判别信号在正文流完后到达。本步若非 terminal 收尾（叙述 / 失败恢复
      // 草稿 / 工具轮），刚才乐观流进气泡的那段就不是最终答案 → 清空气泡（叙述仍留思考区）。
      // 只有 reason==="terminal" 的那段保留，最终恒等于 terminalDraft。
      if (chunk.reason !== "terminal") {
        pushBubbleReset(state, events, chunk.reason ?? "non-terminal-step");
      }
      closeActiveModelReasoning(state, events, now, { ok: true });
      if (state.activeToolLoopStepNumber === chunk.step) {
        closeActiveToolLoop(
          state,
          events,
          now,
          chunk.success
            ? { ok: true }
            : {
                ok: false,
                code: chunk.error?.code ?? "TOOL_LOOP_STEP_FAILED",
                message: chunk.error?.message ?? chunk.reason ?? "tool loop step failed",
              },
        );
        return events;
      }
      const stepId = chunk.stepId ?? state.toolLoopStepIds.get(chunk.step);
      if (!stepId) return events;
      const payload: ReasoningStepEvent = {
        schema: "reasoning-step-v1",
        turnId: state.turnId,
        stepId,
        ...(state.activeLifecycleStepId !== null ? { parentStepId: state.activeLifecycleStepId } : {}),
        kind: "tool-loop",
        event: "END",
        label: `${TOOL_LOOP_LABEL_PREFIX}第 ${chunk.step} 轮`,
        ok: chunk.success,
        ...(chunk.success === false
          ? {
              error: {
                code: chunk.error?.code ?? "TOOL_LOOP_STEP_FAILED",
                message: chunk.error?.message ?? chunk.reason ?? "tool loop step failed",
              },
            }
          : {}),
        time: now(),
      };
      events.push({ sseEvent: "reasoning.step", payload });
      return events;
    }
    case "tool-loop-final": {
      const events: SseEventDescriptor[] = [];
      closeActiveModelReasoning(state, events, now, { ok: true });
      closeActiveToolLoop(
        state,
        events,
        now,
        chunk.success
          ? { ok: true }
          : {
              ok: false,
              code: "TOOL_LOOP_FAILED",
              message: "tool loop ended without a complete result",
            },
      );
      return events;
    }
    case "tool-call-start": {
      const events: SseEventDescriptor[] = [];
      // 工具调用开始 → 模型在写工具参数而非推理，关掉 reasoning 子 step。
      closeActiveModelReasoning(state, events, now, { ok: true });
      state.pendingToolCalls.set(chunk.callId, {
        toolName: chunk.tool,
        startedAt: now(),
      });
      const parentStepId = chunk.parentStepId ?? state.activeToolLoopStepId ?? state.activeLifecycleStepId;
      if (parentStepId !== null) {
        state.toolCallParentStepIds.set(chunk.callId, parentStepId);
      }
      const payload: ToolCallStartedEvent = {
        schema: "tool-call-started-v1",
        turnId: state.turnId,
        ...(parentStepId !== null ? { parentStepId } : {}),
        toolCallId: chunk.callId,
        toolName: chunk.tool,
        args: parseArgumentsPreview(chunk.argumentsPreview),
        meta: toolCallStartedMeta(chunk.tool),
      };
      events.push({ sseEvent: "tool.call.started", payload });
      return events;
    }
    case "done": {
      if (state.turnFailedEmitted) return [];
      // 兜底关掉所有活跃 step（理论上 lifecycle exit 已经收尾，这里防御异常路径）。
      const events: SseEventDescriptor[] = [];
      closeActiveModelReasoning(state, events, now, { ok: true });
      closeActiveToolLoop(state, events, now, { ok: true });
      // 先补全漏发的 tool-call-end，再关 lifecycle —— 避免「lifecycle 已 END 但子工具仍无 completed」。
      flushPendingToolCalls(state, events, now, { ok: true });
      closeActiveLifecycle(state, events, now, { ok: true });
      reconcileFinalBubble(state, events, chunk.output);
      const tokenUsage = chunk.output.metadata.tokenUsage;
      const endTime = now();
      const durationMs = endTime - state.startTime;
      const messageCompleted: MessageCompletedEvent = {
        schema: "message-completed-v1",
        turnId: state.turnId,
        messageId: state.messageId,
      };
      const usageDelta: UsageDeltaEvent = {
        schema: "usage-delta-v2",
        turnId: state.turnId,
        // 唯一权威来源：output.metadata.tokenUsage。usage == cumulative（一次性 emit）。
        usage: { input: tokenUsage.input, output: tokenUsage.output, total: tokenUsage.total },
        cumulative: {
          input: tokenUsage.input,
          output: tokenUsage.output,
          total: tokenUsage.total,
        },
      };
      const turnCompleted: TurnCompletedEvent = {
        schema: "turn-completed-v1",
        turnId: state.turnId,
        finalMessageId: state.messageId,
        tokenUsage: {
          input: tokenUsage.input,
          output: tokenUsage.output,
          total: tokenUsage.total,
        },
        durationMs,
        endTime,
      };
      events.push(
        { sseEvent: "message.completed", payload: messageCompleted },
        { sseEvent: "usage.delta", payload: usageDelta },
        { sseEvent: "turn.completed", payload: turnCompleted },
      );
      return events;
    }
    case "error": {
      if (state.turnFailedEmitted) return [];
      state.turnFailedEmitted = true;
      const events: SseEventDescriptor[] = [];
      flushPendingToolCalls(state, events, now, {
        ok: false,
        error: {
          code: chunk.error.code,
          message: chunk.error.message,
          retryable: chunk.error.retryable,
        },
      });
      // 异常路径强制 END 所有活跃 step（Q11a），让前端 reasoning 树永远闭合。
      const e = chunk.error;
      closeActiveModelReasoning(state, events, now, {
        ok: false,
        code: "TURN_INTERRUPTED",
        message: e.message,
      });
      closeActiveToolLoop(state, events, now, {
        ok: false,
        code: "TURN_INTERRUPTED",
        message: e.message,
      });
      closeActiveLifecycle(state, events, now, {
        ok: false,
        code: "TURN_INTERRUPTED",
        message: e.message,
      });
      const payload: TurnFailedEvent = {
        schema: "turn-failed-v1",
        turnId: state.turnId,
        error: {
          code: e.code,
          message: e.message,
          retryable: e.retryable,
        },
        endTime: now(),
      };
      events.push({ sseEvent: "turn.failed", payload });
      return events;
    }
    case "tool-call-end": {
      state.pendingToolCalls.delete(chunk.callId);
      const parentStepId =
        state.toolCallParentStepIds.get(chunk.callId) ?? chunk.parentStepId ?? state.activeToolLoopStepId ?? state.activeLifecycleStepId;
      const payload: ToolCallCompletedEvent = {
        schema: "tool-call-completed-v1",
        turnId: state.turnId,
        ...(parentStepId !== null ? { parentStepId } : {}),
        toolCallId: chunk.callId,
        toolName: chunk.tool,
        durationMs: chunk.durationMs,
        ok: chunk.success,
        ...(Object.prototype.hasOwnProperty.call(chunk, "output") ? { output: projectToolCallOutputForSse(chunk.tool, chunk.output) } : {}),
        ...(chunk.success === false
          ? {
              error: {
                code: chunk.error?.code ?? "TOOL_EXECUTION_FAILED",
                message: chunk.error?.message ?? "Tool execution failed without message",
                retryable: chunk.error?.retryable ?? false,
              },
            }
          : {}),
      };
      state.toolCallParentStepIds.delete(chunk.callId);
      return [{ sseEvent: "tool.call.completed", payload }];
    }
    default: {
      // 已知但暂未映射的类型：plan-preview / artifact。
      void now;
      return [];
    }
  }
}

/**
 * 在 `runStream()` 抛出异常（catch 分支）时由 TurnService 调用，把所有活跃
 * reasoning step 强制 END（Q11a），让前端 reasoning 树永远闭合。
 *
 * 与 `chunk.type === 'error'` 路径的区别：异常源不在 tachu chunk 流内，而是
 * tachu Engine 自身抛错（例如 Engine 已 dispose）。此时不再 emit turn.failed
 * （TurnService 自有逻辑负责），仅清理 step 状态。
 */
export function forceCloseActiveReasoning(
  state: TachuSseMapperState,
  reason: { code: string; message: string },
  now: () => number = Date.now,
): SseEventDescriptor[] {
  const events: SseEventDescriptor[] = [];
  flushPendingToolCalls(state, events, now, {
    ok: false,
    error: { code: reason.code, message: reason.message, retryable: false },
  });
  closeActiveModelReasoning(state, events, now, {
    ok: false,
    code: reason.code,
    message: reason.message,
  });
  closeActiveToolLoop(state, events, now, {
    ok: false,
    code: reason.code,
    message: reason.message,
  });
  closeActiveLifecycle(state, events, now, {
    ok: false,
    code: reason.code,
    message: reason.message,
  });
  return events;
}
