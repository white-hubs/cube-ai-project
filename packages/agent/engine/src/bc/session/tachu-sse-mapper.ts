import type { EngineOutput, EnginePhase, StreamChunkPayload } from '@tachu/core';
import {
  type MessageCompletedEvent,
  type MessageDeltaEvent,
  type ReasoningDeltaEvent,
  type ReasoningStepEvent,
  type ToolCallCompletedEvent,
  type ToolCallStartedEvent,
  type TurnCompletedEvent,
  type TurnFailedEvent,
  type UsageDeltaEvent,
} from '@cube-ai/contracts';

/**
 * Tachu StreamChunk → 本仓 SSE 事件协议的纯函数映射。
 *
 * 设计要点：
 *  - mapper 不做副作用、不知道 SSE 传输层。返回事件描述数组，TurnService 负责
 *    把它们 forward 给 SseEmitter。
 *  - 一次 chunk 调用产出 0~多个事件：例如 `done` 一次性产出（可选）message.delta 兜底
 *    + message.completed + usage.delta + turn.completed。
 *  - `state` 在调用间累加 `seqInTurn`、记录 `startTime` 以便算 `durationMs`。
 *  - 当前阶段未消费的 tachu chunk 类型（progress / plan-preview / artifact）返回空数组，
 *    由 TurnService 的循环按 no-op 处理。
 *    这是显式向前兼容策略：tachu 未来新增 chunk 类型不会让本仓崩。
 */

/**
 * Phase → 客户端展示标签的内置中文映射（mapper 默认）。
 *
 * 与 SSE schema `reasoning-step-v1.label` 对齐：宿主可以在前端覆盖文案，但
 * 服务端永远发一份默认值，避免协议消费者还得自己维护翻译表。
 */
const PHASE_LABELS: Record<EnginePhase, string> = {
  session:       '会话准备',
  safety:        '安全检查',
  intent:        '意图识别',
  precheck:      '前置检查',
  planning:      '任务规划',
  'graph-check': '计划校验',
  execution:     '执行中',
  validation:    '结果验证',
  output:        '生成答案',
};

/** Model reasoning 子 step 的默认标签。 */
const MODEL_REASONING_LABEL = '模型思考';
const TOOL_LOOP_LABEL_PREFIX = '工具循环';

/**
 * tachu chunk 不携带 execution/consent；与 `McpBridgeService` 对 `web-search` 的 NEVER 对齐。
 * 其余工具默认安全档：LOCAL + ON_FIRST_USE。
 */
function toolCallStartedMeta(toolName: string): {
  execution: 'LOCAL' | 'REMOTE';
  consent: 'NEVER' | 'ON_FIRST_USE';
} {
  if (toolName.startsWith('mcp.web-search.')) {
    return { execution: 'REMOTE', consent: 'NEVER' };
  }
  return { execution: 'LOCAL', consent: 'ON_FIRST_USE' };
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
   * 进行中 tool-call 所属 reasoning phase（callId → parent stepId）。
   * completed 复用 started 捕获到的 parent，避免 phase 提前关闭时丢失归属。
   */
  toolCallParentStepIds: Map<string, string>;
  /**
   * 是否已 emit 过 turn.failed —— 防止 tachu 错误流出现多个 error chunk 时本仓
   * 重复上报 turn.failed（违反 SSE 协议唯一性）。
   */
  turnFailedEmitted: boolean;
  /** SFID 生成工厂：与 turnId/messageId 同体系。由 TurnService 注入。 */
  nextSfid: () => string;
  /** 当前活跃 phase step 的 stepId；构成 `model-reasoning` 子 step 的 parent。 */
  activePhaseStepId: string | null;
  /** 当前活跃 phase 名（仅用于 END 时回写 `phase` 字段、与 START 严格对偶）。 */
  activePhase: EnginePhase | null;
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
    activePhaseStepId: null,
    activePhase: null,
    activeModelReasoningStepId: null,
    activeToolLoopStepId: null,
    activeToolLoopStepNumber: null,
    toolLoopStepIds: new Map<number, string>(),
    seqByStep: new Map<string, number>(),
  };
}

export type SseEventDescriptor =
  | { sseEvent: 'message.delta'; payload: MessageDeltaEvent }
  | { sseEvent: 'usage.delta'; payload: UsageDeltaEvent }
  | { sseEvent: 'tool.call.started'; payload: ToolCallStartedEvent }
  | { sseEvent: 'tool.call.completed'; payload: ToolCallCompletedEvent }
  | { sseEvent: 'message.completed'; payload: MessageCompletedEvent }
  | { sseEvent: 'turn.completed'; payload: TurnCompletedEvent }
  | { sseEvent: 'turn.failed'; payload: TurnFailedEvent }
  | { sseEvent: 'reasoning.step'; payload: ReasoningStepEvent }
  | { sseEvent: 'reasoning.delta'; payload: ReasoningDeltaEvent };

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
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
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
  outcome:
    | { ok: true }
    | { ok: false; error: { code: string; message: string; retryable: boolean } },
): void {
  if (state.pendingToolCalls.size === 0) return;
  for (const [callId, meta] of [...state.pendingToolCalls.entries()]) {
    const parentStepId = state.toolCallParentStepIds.get(callId) ?? null;
    const durationMs = Math.max(0, Math.round(now() - meta.startedAt));
    const payload: ToolCallCompletedEvent = {
      schema: 'tool-call-completed-v1',
      turnId: state.turnId,
      ...(parentStepId !== null ? { parentStepId } : {}),
      toolCallId: callId,
      toolName: meta.toolName,
      durationMs,
      ok: outcome.ok,
      ...(outcome.ok === false ? { error: outcome.error } : {}),
    };
    events.push({ sseEvent: 'tool.call.completed', payload });
    state.pendingToolCalls.delete(callId);
    state.toolCallParentStepIds.delete(callId);
  }
}

/**
 * 关闭活跃的 model-reasoning 子 step（如有）。
 *
 * 触发场景（Q5 状态机 B）：
 *   - 收到 text-delta / tool-call-start / phase-exit / done
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
  const parentStepId = state.activeToolLoopStepId ?? state.activePhaseStepId;
  const payload: ReasoningStepEvent = {
    schema: 'reasoning-step-v1',
    turnId: state.turnId,
    stepId,
    ...(parentStepId !== null ? { parentStepId } : {}),
    kind: 'model-reasoning',
    event: 'END',
    label: MODEL_REASONING_LABEL,
    ok: outcome.ok,
    ...(outcome.ok === false
      ? { error: { code: outcome.code, message: outcome.message } }
      : {}),
    time: now(),
  };
  events.push({ sseEvent: 'reasoning.step', payload });
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
    schema: 'reasoning-step-v1',
    turnId: state.turnId,
    stepId,
    ...(state.activePhaseStepId !== null ? { parentStepId: state.activePhaseStepId } : {}),
    kind: 'tool-loop',
    event: 'END',
    label: `${TOOL_LOOP_LABEL_PREFIX}第 ${stepNumber} 轮`,
    ok: outcome.ok,
    ...(outcome.ok === false
      ? { error: { code: outcome.code, message: outcome.message } }
      : {}),
    time: now(),
  };
  events.push({ sseEvent: 'reasoning.step', payload });
  state.activeToolLoopStepId = null;
  state.activeToolLoopStepNumber = null;
}

/**
 * 强制关闭活跃的 phase step（异常收尾或 done 兜底）。
 *
 * 调用方应先 `closeActiveModelReasoning` 再关 phase；正常路径下 phase-exit
 * chunk 会主动调用此函数。
 */
function closeActivePhase(
  state: TachuSseMapperState,
  events: SseEventDescriptor[],
  now: () => number,
  outcome: { ok: true } | { ok: false; code: string; message: string },
): void {
  const stepId = state.activePhaseStepId;
  const phase = state.activePhase;
  if (!stepId || !phase) return;
  closeActiveToolLoop(state, events, now, outcome);
  const payload: ReasoningStepEvent = {
    schema: 'reasoning-step-v1',
    turnId: state.turnId,
    stepId,
    kind: 'phase',
    event: 'END',
    label: PHASE_LABELS[phase],
    phase,
    ok: outcome.ok,
    ...(outcome.ok === false
      ? { error: { code: outcome.code, message: outcome.message } }
      : {}),
    time: now(),
  };
  events.push({ sseEvent: 'reasoning.step', payload });
  state.activePhaseStepId = null;
  state.activePhase = null;
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
function extractUserVisibleAnswerText(output: EngineOutput): string {
  const raw = output.content;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    let acc = '';
    for (const block of raw) {
      if (block && typeof block === 'object' && !Array.isArray(block)) {
        const b = block as { type?: unknown; text?: unknown };
        if (b.type === 'text' && typeof b.text === 'string') acc += b.text;
      }
    }
    return acc;
  }
  if (raw != null && typeof raw === 'object' && 'text' in raw) {
    const t = (raw as { text: unknown }).text;
    if (typeof t === 'string') return t;
  }
  return '';
}

/**
 * 若本轮从未发过 `message-delta-v1`，但 `done` 里已有非空正文，在终态前补一条 delta，
 * 保证客户端仅靠 SSE 也能拼出与 listMessages 一致的可见答复（契约：message.completed 不含正文）。
 */
function pushSyntheticFinalMessageDeltaIfNeeded(
  state: TachuSseMapperState,
  events: SseEventDescriptor[],
  output: EngineOutput,
): void {
  if (state.seqInTurn !== 1) return;
  const text = extractUserVisibleAnswerText(output).trim();
  if (text.length === 0) return;
  const payload: MessageDeltaEvent = {
    schema:    'message-delta-v1',
    turnId:    state.turnId,
    messageId: state.messageId,
    seqInTurn: state.seqInTurn,
    delta:     { type: 'text', text },
  };
  state.seqInTurn += 1;
  events.push({ sseEvent: 'message.delta', payload });
}

export function mapStreamChunkToSseEvents(
  state: TachuSseMapperState,
  chunk: StreamChunkPayload,
  now: () => number = Date.now,
): SseEventDescriptor[] {
  switch (chunk.type) {
    case 'delta': {
      if (!chunk.content) return [];
      // 用户正文增量 → 隐含「模型已停止吐 reasoning」，关掉子 step（Q5 状态机 B）。
      const events: SseEventDescriptor[] = [];
      closeActiveModelReasoning(state, events, now, { ok: true });
      const payload: MessageDeltaEvent = {
        schema: 'message-delta-v1',
        turnId: state.turnId,
        messageId: state.messageId,
        seqInTurn: state.seqInTurn,
        delta: { type: 'text', text: chunk.content },
      };
      state.seqInTurn += 1;
      events.push({ sseEvent: 'message.delta', payload });
      return events;
    }
    case 'reasoning-delta': {
      if (!chunk.content) return [];
      const events: SseEventDescriptor[] = [];
      // 首次 reasoning-delta：开启 model-reasoning 子 step，parent = 当前 phase。
      let stepId = state.activeModelReasoningStepId;
      if (stepId === null) {
        stepId = state.nextSfid();
        state.activeModelReasoningStepId = stepId;
        const parentStepId = state.activeToolLoopStepId ?? state.activePhaseStepId;
        const startPayload: ReasoningStepEvent = {
          schema: 'reasoning-step-v1',
          turnId: state.turnId,
          stepId,
          ...(parentStepId !== null ? { parentStepId } : {}),
          kind: 'model-reasoning',
          event: 'START',
          label: MODEL_REASONING_LABEL,
          time: now(),
        };
        events.push({ sseEvent: 'reasoning.step', payload: startPayload });
      }
      const seq = nextSeqInStep(state, stepId);
      const deltaPayload: ReasoningDeltaEvent = {
        schema: 'reasoning-delta-v1',
        turnId: state.turnId,
        stepId,
        seqInStep: seq,
        text: chunk.content,
        source: 'model',
      };
      events.push({ sseEvent: 'reasoning.delta', payload: deltaPayload });
      return events;
    }
    case 'phase-enter': {
      // 进入新 phase 前若仍有活跃 phase（理论不应有），强制关闭做防御。
      const events: SseEventDescriptor[] = [];
      closeActiveModelReasoning(state, events, now, { ok: true });
      closeActivePhase(state, events, now, { ok: true });
      state.toolLoopStepIds.clear();
      const stepId = chunk.stepId ?? state.nextSfid();
      state.activePhaseStepId = stepId;
      state.activePhase = chunk.phase;
      const startPayload: ReasoningStepEvent = {
        schema: 'reasoning-step-v1',
        turnId: state.turnId,
        stepId,
        kind: 'phase',
        event: 'START',
        label: PHASE_LABELS[chunk.phase],
        phase: chunk.phase,
        time: now(),
      };
      events.push({ sseEvent: 'reasoning.step', payload: startPayload });
      return events;
    }
    case 'phase-exit': {
      const events: SseEventDescriptor[] = [];
      // phase 退出前先关子 step（model-reasoning 总是 phase 的子项，且短于 phase）。
      closeActiveModelReasoning(state, events, now, { ok: true });
      closeActiveToolLoop(state, events, now, { ok: true });
      // 仅在 chunk.phase 与当前活跃 phase 对齐时正常 END；否则做防御性 close。
      if (state.activePhaseStepId !== null && state.activePhase === chunk.phase) {
        const endPayload: ReasoningStepEvent = {
          schema: 'reasoning-step-v1',
          turnId: state.turnId,
          stepId: state.activePhaseStepId,
          kind: 'phase',
          event: 'END',
          label: PHASE_LABELS[chunk.phase],
          phase: chunk.phase,
          ok: chunk.ok,
          ...(chunk.ok === false && chunk.error
            ? {
                error: {
                  code: chunk.error.code ?? 'PHASE_FAILED',
                  message: chunk.error.message ?? 'phase exited with ok=false',
                },
              }
            : {}),
          time: now(),
        };
        events.push({ sseEvent: 'reasoning.step', payload: endPayload });
        state.activePhaseStepId = null;
        state.activePhase = null;
      }
      return events;
    }
    case 'usage': {
      if (
        chunk.usage === undefined ||
        chunk.cumulative === undefined ||
        chunk.attribution === undefined ||
        chunk.accuracy === undefined
      ) {
        // Legacy tachu UsageChunk only has cumulative `tokens`; keep ignoring it.
        return [];
      }
      const payload: UsageDeltaEvent = {
        schema: 'usage-delta-v2',
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
      return [{ sseEvent: 'usage.delta', payload }];
    }
    case 'tool-loop-step': {
      const events: SseEventDescriptor[] = [];
      closeActiveModelReasoning(state, events, now, { ok: true });
      closeActiveToolLoop(state, events, now, { ok: true });
      const stepId = chunk.stepId ?? state.nextSfid();
      state.activeToolLoopStepId = stepId;
      state.activeToolLoopStepNumber = chunk.step;
      state.toolLoopStepIds.set(chunk.step, stepId);
      const payload: ReasoningStepEvent = {
        schema: 'reasoning-step-v1',
        turnId: state.turnId,
        stepId,
        ...(state.activePhaseStepId !== null ? { parentStepId: state.activePhaseStepId } : {}),
        kind: 'tool-loop',
        event: 'START',
        label: `${TOOL_LOOP_LABEL_PREFIX}第 ${chunk.step} 轮`,
        time: now(),
        meta: { step: chunk.step, maxSteps: chunk.maxSteps },
      };
      events.push({ sseEvent: 'reasoning.step', payload });
      return events;
    }
    case 'tool-loop-delta': {
      if (!chunk.content) return [];
      const stepId =
        chunk.stepId ??
        state.toolLoopStepIds.get(chunk.step) ??
        (state.activeToolLoopStepNumber === chunk.step
          ? state.activeToolLoopStepId
          : null);
      if (!stepId) return [];
      const events: SseEventDescriptor[] = [];
      closeActiveModelReasoning(state, events, now, { ok: true });
      const seq = nextSeqInStep(state, stepId);
      const payload: ReasoningDeltaEvent = {
        schema: 'reasoning-delta-v1',
        turnId: state.turnId,
        stepId,
        seqInStep: seq,
        text: chunk.content,
        source: 'tool-loop',
      };
      events.push({ sseEvent: 'reasoning.delta', payload });
      return events;
    }
    case 'tool-loop-step-end': {
      const events: SseEventDescriptor[] = [];
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
                code: chunk.error?.code ?? 'TOOL_LOOP_STEP_FAILED',
                message: chunk.error?.message ?? chunk.reason ?? 'tool loop step failed',
              },
        );
        return events;
      }
      const stepId = chunk.stepId ?? state.toolLoopStepIds.get(chunk.step);
      if (!stepId) return events;
      const payload: ReasoningStepEvent = {
        schema: 'reasoning-step-v1',
        turnId: state.turnId,
        stepId,
        ...(state.activePhaseStepId !== null ? { parentStepId: state.activePhaseStepId } : {}),
        kind: 'tool-loop',
        event: 'END',
        label: `${TOOL_LOOP_LABEL_PREFIX}第 ${chunk.step} 轮`,
        ok: chunk.success,
        ...(chunk.success === false
          ? {
              error: {
                code: chunk.error?.code ?? 'TOOL_LOOP_STEP_FAILED',
                message: chunk.error?.message ?? chunk.reason ?? 'tool loop step failed',
              },
            }
          : {}),
        time: now(),
      };
      events.push({ sseEvent: 'reasoning.step', payload });
      return events;
    }
    case 'tool-loop-final': {
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
              code: 'TOOL_LOOP_FAILED',
              message: 'tool loop ended without a complete result',
            },
      );
      return events;
    }
    case 'tool-call-start': {
      const events: SseEventDescriptor[] = [];
      // 工具调用开始 → 模型在写工具参数而非推理，关掉 reasoning 子 step。
      closeActiveModelReasoning(state, events, now, { ok: true });
      state.pendingToolCalls.set(chunk.callId, {
        toolName: chunk.tool,
        startedAt: now(),
      });
      const parentStepId =
        chunk.parentStepId ?? state.activeToolLoopStepId ?? state.activePhaseStepId;
      if (parentStepId !== null) {
        state.toolCallParentStepIds.set(chunk.callId, parentStepId);
      }
      const payload: ToolCallStartedEvent = {
        schema: 'tool-call-started-v1',
        turnId: state.turnId,
        ...(parentStepId !== null ? { parentStepId } : {}),
        toolCallId: chunk.callId,
        toolName: chunk.tool,
        args: parseArgumentsPreview(chunk.argumentsPreview),
        meta: toolCallStartedMeta(chunk.tool),
      };
      events.push({ sseEvent: 'tool.call.started', payload });
      return events;
    }
    case 'done': {
      if (state.turnFailedEmitted) return [];
      // 兜底关掉所有活跃 step（理论上 phase-exit 已经收尾，这里防御异常路径）。
      const events: SseEventDescriptor[] = [];
      closeActiveModelReasoning(state, events, now, { ok: true });
      closeActiveToolLoop(state, events, now, { ok: true });
      // 先补全漏发的 tool-call-end，再关 phase —— 避免「phase 已 END 但子工具仍无 completed」。
      flushPendingToolCalls(state, events, now, { ok: true });
      closeActivePhase(state, events, now, { ok: true });
      pushSyntheticFinalMessageDeltaIfNeeded(state, events, chunk.output);
      const tokenUsage = chunk.output.metadata.tokenUsage;
      const endTime = now();
      const durationMs = endTime - state.startTime;
      const messageCompleted: MessageCompletedEvent = {
        schema: 'message-completed-v1',
        turnId: state.turnId,
        messageId: state.messageId,
      };
      const usageDelta: UsageDeltaEvent = {
        schema: 'usage-delta-v2',
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
        schema: 'turn-completed-v1',
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
        { sseEvent: 'message.completed', payload: messageCompleted },
        { sseEvent: 'usage.delta', payload: usageDelta },
        { sseEvent: 'turn.completed', payload: turnCompleted },
      );
      return events;
    }
    case 'error': {
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
        code: 'TURN_INTERRUPTED',
        message: e.message,
      });
      closeActiveToolLoop(state, events, now, {
        ok: false,
        code: 'TURN_INTERRUPTED',
        message: e.message,
      });
      closeActivePhase(state, events, now, {
        ok: false,
        code: 'TURN_INTERRUPTED',
        message: e.message,
      });
      const payload: TurnFailedEvent = {
        schema: 'turn-failed-v1',
        turnId: state.turnId,
        error: {
          code: e.code,
          message: e.message,
          retryable: e.retryable,
        },
        endTime: now(),
      };
      events.push({ sseEvent: 'turn.failed', payload });
      return events;
    }
    case 'tool-call-end': {
      state.pendingToolCalls.delete(chunk.callId);
      const parentStepId =
        state.toolCallParentStepIds.get(chunk.callId) ??
        chunk.parentStepId ??
        state.activeToolLoopStepId ??
        state.activePhaseStepId;
      const payload: ToolCallCompletedEvent = {
        schema: 'tool-call-completed-v1',
        turnId: state.turnId,
        ...(parentStepId !== null ? { parentStepId } : {}),
        toolCallId: chunk.callId,
        toolName: chunk.tool,
        durationMs: chunk.durationMs,
        ok: chunk.success,
        ...(Object.prototype.hasOwnProperty.call(chunk, 'output')
          ? { output: chunk.output }
          : {}),
        ...(chunk.success === false
          ? {
              error: {
                code: chunk.error?.code ?? 'TOOL_EXECUTION_FAILED',
                message: chunk.error?.message ?? 'Tool execution failed without message',
                retryable: chunk.error?.retryable ?? false,
              },
            }
          : {}),
      };
      state.toolCallParentStepIds.delete(chunk.callId);
      return [{ sseEvent: 'tool.call.completed', payload }];
    }
    default: {
      // 已知但暂未映射的类型：progress / plan-preview / artifact。
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
  closeActivePhase(state, events, now, {
    ok: false,
    code: reason.code,
    message: reason.message,
  });
  return events;
}
