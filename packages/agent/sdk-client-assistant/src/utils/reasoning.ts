type MergeSources<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer R) => void ? R : never;

function mergeObject<T extends object, S extends readonly object[]>(target: T, ...sources: S): T & MergeSources<S[number]> {
  const clone = { ...target } as T & MergeSources<S[number]>;
  return Object.assign(clone, ...sources);
}

/**
 * Reasoning reducer (@cube-ai/contracts SSE wire schema / ADR-0008 §D5.4) + UI helpers.
 * Ported from ghcloud `assistant-chat.utils.ts`.
 */
import type { ReasoningLifecyclePoint, ReasoningStep, ReasoningTree } from "../types";

export function createEmptyReasoningTree(): ReasoningTree {
  return { steps: [] };
}

/** Normalized SSE event shape used by reducer (event name + data only). */
export interface NormalizedReasoningEvent {
  event: string;
  data: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(obj, key);
}

function makeToolStepId(toolCallId: string): string {
  return `tool:${toolCallId}`;
}

/**
 * Fold a `reasoning-step-v1` / `reasoning-delta-v1` event into the tree.
 *   - step START → append new step
 *   - step END   → update `ok` / `error` / `endTime`
 *   - delta      → append text to matching step
 * Pure function — never mutate input; always return a new tree.
 *
 * 计时锚点约定：`startTime` / `endTime` 一律采用【客户端本地时钟】`Date.now()`（事件被
 * 客户端处理的时刻）。服务端 `data.time` 与客户端时钟存在偏差，若拿它当墙钟，UI 对
 * 「进行中」step 计算 `now(client) − startTime(server)` 会在 step 一出现就显示这个偏差
 * （启动即偏十几秒）。故 `data.time` 不参与 elapsed 计算；tool-call 的服务端权威【时长】
 * 保留在 `durationMs` 字段。
 */
export function reduceReasoningEvent(tree: ReasoningTree | undefined, event: NormalizedReasoningEvent): ReasoningTree {
  const base: ReasoningTree = tree ?? createEmptyReasoningTree();
  const data = event.data;

  if (event.event === "reasoning-step-v1") {
    const stepId = typeof data.stepId === "string" ? data.stepId : "";
    const kindRaw = typeof data.kind === "string" ? data.kind : "";
    const eventTag = typeof data.event === "string" ? data.event : "";
    if (!stepId || (kindRaw !== "lifecycle" && kindRaw !== "model-reasoning" && kindRaw !== "tool-loop")) {
      return base;
    }
    const kind = kindRaw as "lifecycle" | "model-reasoning" | "tool-loop";
    const now = Date.now();
    const label = typeof data.label === "string" ? data.label : kind;
    if (eventTag === "START") {
      const existing = base.steps.find((s) => s.stepId === stepId);
      if (existing) {
        return base;
      }
      const next: ReasoningStep = {
        kind,
        label,
        startTime: now,
        stepId,
        text: "",
        ...(typeof data.parentStepId === "string" && data.parentStepId !== "" ? { parentStepId: data.parentStepId } : {}),
        ...(typeof data.point === "string" ? { point: data.point as ReasoningLifecyclePoint } : {}),
      };
      return { steps: [...base.steps, next] };
    }
    if (eventTag === "END") {
      const ok = typeof data.ok === "boolean" ? data.ok : true;
      const errorRaw = data.error;
      const error =
        errorRaw && typeof errorRaw === "object" && !Array.isArray(errorRaw)
          ? {
              code: String((errorRaw as Record<string, unknown>).code ?? ""),
              message: String((errorRaw as Record<string, unknown>).message ?? ""),
            }
          : undefined;
      return {
        steps: base.steps.map((s) => (s.stepId === stepId ? { ...s, endTime: now, ok, ...(error ? { error } : {}) } : s)),
      };
    }
    return base;
  }

  if (event.event === "reasoning-delta-v1") {
    const stepId = typeof data.stepId === "string" ? data.stepId : "";
    const text = typeof data.text === "string" ? data.text : "";
    if (!stepId || text.length === 0) {
      return base;
    }
    return {
      steps: base.steps.map((s) => (s.stepId === stepId ? { ...s, text: `${s.text}${text}` } : s)),
    };
  }

  if (event.event === "tool-call-started-v1") {
    const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
    if (!toolCallId) {
      return base;
    }
    const stepId = makeToolStepId(toolCallId);
    if (base.steps.some((s) => s.stepId === stepId)) {
      return base;
    }
    const toolName = typeof data.toolName === "string" && data.toolName !== "" ? data.toolName : "unknown";
    const now = Date.now();
    const args = asRecord(data.args) ?? {};
    const meta = asRecord(data.meta);
    const next: ReasoningStep = {
      args,
      kind: "tool-call",
      label: `调用 ${toolName}`,
      startTime: now,
      stepId,
      text: "",
      toolCallId,
      toolName,
      ...(typeof data.parentStepId === "string" && data.parentStepId !== "" ? { parentStepId: data.parentStepId } : {}),
      ...(meta ? { meta } : {}),
    };
    return { steps: [...base.steps, next] };
  }

  if (event.event === "tool-call-completed-v1") {
    const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
    if (!toolCallId) {
      return base;
    }
    const stepId = makeToolStepId(toolCallId);
    const toolName = typeof data.toolName === "string" && data.toolName !== "" ? data.toolName : "unknown";
    const now = Date.now();
    const durationMs =
      typeof data.durationMs === "number" && Number.isFinite(data.durationMs) ? Math.max(0, Math.floor(data.durationMs)) : undefined;
    const ok = typeof data.ok === "boolean" ? data.ok : true;
    const errorRaw = asRecord(data.error);
    const error = errorRaw
      ? {
          code: String(errorRaw.code ?? ""),
          message: String(errorRaw.message ?? ""),
        }
      : undefined;
    const output = hasOwn(data, "output") ? data.output : undefined;
    const parentStepId = typeof data.parentStepId === "string" && data.parentStepId !== "" ? data.parentStepId : undefined;
    const existing = base.steps.find((s) => s.stepId === stepId);

    if (!existing) {
      // 服务端权威【时长】：endTime 取客户端 now，startTime = endTime − durationMs（不再用服务端 time − durationMs）。
      const startTime = durationMs !== undefined ? Math.max(0, now - durationMs) : now;
      const next: ReasoningStep = {
        endTime: now,
        kind: "tool-call",
        label: `调用 ${toolName}`,
        ok,
        startTime,
        stepId,
        text: "",
        toolCallId,
        toolName,
        ...(parentStepId ? { parentStepId } : {}),
        ...(durationMs !== null && durationMs !== undefined ? { durationMs } : {}),
        ...(hasOwn(data, "output") ? { output } : {}),
        ...(error ? { error } : {}),
      };
      return { steps: [...base.steps, next] };
    }

    return {
      steps: base.steps.map((s) =>
        s.stepId === stepId
          ? {
              ...s,
              endTime: now,
              label: s.label || `调用 ${toolName}`,
              ok,
              toolName: s.toolName ?? toolName,
              ...(parentStepId && !s.parentStepId ? { parentStepId } : {}),
              ...(durationMs !== null && durationMs !== undefined ? { durationMs } : {}),
              ...(hasOwn(data, "output") ? { output } : {}),
              ...(error ? { error } : {}),
            }
          : s,
      ),
    };
  }

  return base;
}

/**
 * Client-side force-close on stream disconnect (ADR-0008 §D5.4)。
 * 与 server mapper 在 error/done 时强制 END 活跃 step 对偶 — 客户端断连等价语义。
 */
export function forceCloseActiveReasoning(
  tree: ReasoningTree | undefined,
  reason: { code: string; message: string },
  endTime: number = Date.now(),
): ReasoningTree {
  const base: ReasoningTree = tree ?? createEmptyReasoningTree();
  return {
    steps: base.steps.map((s) => (s.ok === undefined ? mergeObject({}, s, { endTime, error: reason, ok: false }) : s)),
  };
}

/**
 * 思考阶段耗时展示：小于 1s 用 ms，否则按 s → m → h 递进。
 */
export function formatReasoningElapsedMs(elapsedMs: number): string {
  const ms = Math.max(0, Math.floor(Number(elapsedMs)));
  if (!Number.isFinite(ms)) {
    return "0ms";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const secTotal = ms / 1000;
  if (ms < 60_000) {
    if (secTotal < 10) {
      const rounded = Math.round(secTotal * 10) / 10;
      return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
    }
    return `${Math.round(secTotal)}s`;
  }
  if (ms < 3600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return s === 0 ? `${m}m` : `${m}m${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

/** 是否非空可见。 */
export function hasVisibleReasoning(tree: ReasoningTree | undefined): boolean {
  return (tree?.steps.length ?? 0) > 0;
}

/**
 * 缩略思考态语义分类（对标 cursor/claude 网页那种「正在做什么」提示）。
 * - `thinking`：模型自身推理
 * - `web-search` / `knowledge-retrieval` / `skill-load`：engine 已知的具体活动种类，
 *   来自 wire 层 `tool-call-started-v1.meta.activity`（见 `@cube-ai/contracts`）
 * - `tool`：未识别的工具调用（含 agent 自定义 groundingPrefetch 领域工具，engine 域无关、
 *   不臆猜其类目）
 * - `working`：`lifecycle` / `tool-loop` 伞 step 通用兜底——**刻意不带轮次号语义**，
 *   下游可直接映射成「处理中」而不必展示内部循环轮次（避免像调试页面）
 */
export type StepActivity = "thinking" | "web-search" | "knowledge-retrieval" | "skill-load" | "tool" | "working";

/**
 * 把 step 归一化成一个稳定枚举，供下游「缩略内容」渲染直接查表——
 * 不必对 `toolName` / `label` 裸串做猜测或硬编码（后者随 label 文案变动即失配）。
 */
export function resolveStepActivity(step: ReasoningStep): StepActivity {
  if (step.kind === "model-reasoning") {
    return "thinking";
  }
  if (step.kind === "tool-call") {
    const activity = step.meta?.activity;
    if (activity === "web-search" || activity === "knowledge-retrieval" || activity === "skill-load") {
      return activity;
    }
    return "tool";
  }
  return "working";
}

/**
 * 默认展开白名单：`turnStart` 轮次伞 step（承载主处理过程）+ `model-reasoning` 始终默认 open；
 * `turnStop`（校验里程碑）默认折叠。
 */
export function shouldExpandReasoningStepByDefault(step: ReasoningStep): boolean {
  if (step.kind === "model-reasoning") {
    return true;
  }
  if (step.kind === "lifecycle" && step.point === "turnStart") {
    return true;
  }
  return false;
}
