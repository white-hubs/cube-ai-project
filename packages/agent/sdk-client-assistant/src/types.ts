/**
 * Application-domain types for assistant/chatbot UIs.
 * Framework-agnostic — no Vue / React / SolidJS dependencies.
 *
 * Ref: ADR-0008 §D4 / @cube-ai/contracts SSE wire schema
 */
import type { ImageAttachment } from "@cube-ai/contracts";

export type { ImageAttachment };

export type AssistantRole = "user" | "assistant" | "system" | "tool";

/**
 * 对外 loop-lifecycle 轮次里程碑（与 `@cube-ai/contracts` `reasoning-step-v1.point` 对齐）。
 * tachu rc.13：引擎不再对外泄漏内部 phase 名，只暴露 `turnStart` / `turnStop`。
 * 不直接 import contracts 的字面量类型以避免循环 / 包体积膨胀；保持本地拷贝。
 */
export type ReasoningLifecyclePoint = "turnStart" | "turnStop";

/** 单个 reasoning step（服务端 reasoning step + SDK 合成的 tool-call step）。 */
export interface ReasoningStep {
  stepId: string;
  /** 顶层 lifecycle step 缺省；嵌套 model-reasoning / tool-loop / tool-call 子 step 必填。 */
  parentStepId?: string;
  kind: "lifecycle" | "model-reasoning" | "tool-loop" | "tool-call";
  label: string;
  point?: ReasoningLifecyclePoint;
  /** `kind === 'tool-call'` 时由 SDK 从 tool-call-* 事件合成。 */
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  output?: unknown;
  durationMs?: number;
  meta?: Record<string, unknown>;
  /** `undefined` = 进行中；START 后 / END 前的窗口期。 */
  ok?: boolean;
  error?: { code: string; message: string };
  /** START 事件携带的时间（ms）。 */
  startTime: number;
  /** END 事件携带的时间；未结束为 undefined。 */
  endTime?: number;
  /** 同 step 内累积的 `reasoning-delta-v1.text`。 */
  text: string;
}

/** Reasoning 树：扁平 step 列表 + 拓扑解释由 UI 负责（避免改 step 时复制嵌套）。 */
export interface ReasoningTree {
  steps: ReasoningStep[];
}

export interface AssistantMessage {
  id: string;
  role: AssistantRole;
  content: string;
  /** User message image refs (from engine `attachments` on listMessages). */
  attachments?: ImageAttachment[];
  createdAt: number;
  /** 服务端 turn id；message-delta-v1 首次到达时由 SDK reducer 写入。 */
  turnId?: string;
  /**
   * 当前对话期的 reasoning 树（tachu 9 阶段骨架 + 模型 reasoning 嵌套）。
   * @cube-ai/contracts SSE wire schema：不入主 `messages` 表；SSE 内累积，turn 结束 commit 到 IDB，
   * `listMessages` 拉取后再 merge 回 UI。
   */
  reasoning?: ReasoningTree;
  /**
   * 本轮（turnId 对应）的 token 用量归档；终结事件
   * （turn-completed/cancelled/failed-v1）触发 SDK 把 `tokenUsageBySessionId`
   * 的当时快照拷贝到此处，并随 reasoning 一起 commit 到 IDB（schema v2）。
   * UI 渲染历史消息右下角合计 + reasoning step 内联 I/O 都从这里读。
   */
  tokenUsage?: PersistedTokenUsage;
}

/** 持久化在 message 上的 token 归档（与流式 `TurnTokenUsage` 区别在带 terminalKind）。 */
export interface PersistedTokenUsage {
  cumulative: TokenUsageTriplet;
  items: TokenUsageSnapshot[];
  /** turn 终结时的状态；UI 据此显示「（已取消）/（异常）」徽标。 */
  terminalKind: "completed" | "cancelled" | "failed";
}

export interface AssistantSessionSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface GroupedSessions {
  today: AssistantSessionSummary[];
  yesterday: AssistantSessionSummary[];
  earlier: AssistantSessionSummary[];
}

/** Chatbot UI 模型下拉条目（业务通过 `listModels` 注入） */
export interface LlmOption {
  modelCode: string;
  displayName: string;
  providerName: string;
}

/** `turn-failed-v1` 归一化摘要：协议层产物，不做 UI 文案截断 / i18n。 */
export interface TurnFailureSummary {
  code: string | null;
  message: string;
  raw: unknown;
}

/** Grant 中断态原始事件；UI 自行渲染卡片。 */
export interface PendingGrant {
  grantRequestId: string;
  turnId?: string;
  toolName?: string;
  reason?: string;
  argsPreview?: unknown;
  scopeHint?: "ONCE" | "SESSION" | "PERSISTENT";
  expiresTime?: number;
  /** 原始 SSE event 数据（用于业务想用未归一化的字段）。 */
  raw: Record<string, unknown>;
}

/** 工具事件 timeline 条目（ADR-0008 §D5.5）。 */
export interface ToolEvent {
  id: string;
  toolName: string;
  phase: "started" | "completed";
  startedAt: number;
  completedAt?: number;
  resultPreview?: unknown;
  turnId?: string;
}

export interface TokenUsageTriplet {
  input: number;
  output: number;
  total: number;
}

export interface TokenUsageAttribution {
  id: string;
  kind: string;
  parentId?: string;
  label?: string;
  meta?: Record<string, unknown>;
}

export interface TokenUsageSnapshot {
  turnId: string;
  usage: TokenUsageTriplet;
  cumulative: TokenUsageTriplet;
  attribution?: TokenUsageAttribution;
  accuracy?: "estimated" | "final";
  terminal?: "cancelled" | "failed" | "disconnected";
  updatedAt: number;
}

export interface TurnTokenUsage {
  turnId: string;
  cumulative: TokenUsageTriplet;
  items: TokenUsageSnapshot[];
  updatedAt: number;
}

/** Turn 在 session 上的状态机（ADR-0008 §D5.1）。 */
export type TurnStatus = "idle" | "running" | "completed" | "failed" | "cancelled";
