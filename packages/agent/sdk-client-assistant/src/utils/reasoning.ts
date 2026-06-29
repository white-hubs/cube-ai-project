type MergeSources<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer R) => void ? R : never;

function mergeObject<T extends object, S extends readonly object[]>(target: T, ...sources: S): T & MergeSources<S[number]> {
  const clone = { ...target } as T & MergeSources<S[number]>;
  return Object.assign(clone, ...sources);
}

/**
 * Reasoning reducer (@cube-ai/contracts SSE wire schema / ADR-0008 §D5.4) + UI helpers.
 * Ported from ghcloud `assistant-chat.utils.ts`.
 */
import type { ReasoningPhase, ReasoningStep, ReasoningTree } from "../types";

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
 */
export function reduceReasoningEvent(tree: ReasoningTree | undefined, event: NormalizedReasoningEvent): ReasoningTree {
  const base: ReasoningTree = tree ?? createEmptyReasoningTree();
  const data = event.data;

  if (event.event === "reasoning-step-v1") {
    const stepId = typeof data.stepId === "string" ? data.stepId : "";
    const kindRaw = typeof data.kind === "string" ? data.kind : "";
    const eventTag = typeof data.event === "string" ? data.event : "";
    if (!stepId || (kindRaw !== "phase" && kindRaw !== "model-reasoning" && kindRaw !== "tool-loop")) {
      return base;
    }
    const kind = kindRaw as "phase" | "model-reasoning" | "tool-loop";
    const time = typeof data.time === "number" ? data.time : Date.now();
    const label = typeof data.label === "string" ? data.label : kind;
    if (eventTag === "START") {
      const existing = base.steps.find((s) => s.stepId === stepId);
      if (existing) {
        return base;
      }
      const next: ReasoningStep = {
        kind,
        label,
        startTime: time,
        stepId,
        text: "",
        ...(typeof data.parentStepId === "string" && data.parentStepId !== "" ? { parentStepId: data.parentStepId } : {}),
        ...(typeof data.phase === "string" ? { phase: data.phase as ReasoningPhase } : {}),
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
        steps: base.steps.map((s) => (s.stepId === stepId ? { ...s, endTime: time, ok, ...(error ? { error } : {}) } : s)),
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
    const time = typeof data.time === "number" ? data.time : Date.now();
    const args = asRecord(data.args) ?? {};
    const meta = asRecord(data.meta);
    const next: ReasoningStep = {
      args,
      kind: "tool-call",
      label: `调用 ${toolName}`,
      startTime: time,
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
    const time = typeof data.time === "number" ? data.time : Date.now();
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
      const startTime = durationMs !== null && durationMs !== undefined ? Math.max(0, time - durationMs) : time;
      const next: ReasoningStep = {
        endTime: time,
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
              endTime: time,
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
 * 默认展开白名单：`planning / execution / output` phase + `model-reasoning` 始终默认 open。
 */
export function shouldExpandReasoningStepByDefault(step: ReasoningStep): boolean {
  if (step.kind === "model-reasoning") {
    return true;
  }
  if (step.phase === "planning" || step.phase === "execution" || step.phase === "output") {
    return true;
  }
  return false;
}
