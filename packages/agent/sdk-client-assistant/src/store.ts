/**
 * AssistantStore — framework-agnostic application-domain state container.
 *
 * Single subscribe + snapshot API (N1)。语义方法（O1）：send / cancel / openSession /
 * createSession / deleteSession / patchSession / respondGrant / loadSessions /
 * reset / dispose.
 *
 * Multi-session multi-stream（ADR-0008 §D5.1）：每个 session 独立的 stream + sending
 * + activeTurnId + lastTurnStatus。
 *
 * Ref: ADR-0008 §D5。
 */
import {
  SessionBusyError,
  StreamDisconnectedError,
  StoreDisposedError,
  StartTurnFailedError,
  buildImageRefBlock,
  buildMultimodalTurnBody,
  buildTextMessage,
} from "@cube-ai/agent-sdk-client";
import type { StartTurnBody } from "@cube-ai/agent-sdk-client";
import type { ImageAttachment, RuntimeRefs } from "@cube-ai/contracts";

import type { AssistantEnginePort, NormalizedSseEvent } from "./port";
import type { ReasoningStore } from "./reasoning-store";
import { createMemoryReasoningStore } from "./reasoning-store";
import type {
  AssistantMessage,
  AssistantSessionSummary,
  LlmOption,
  PendingGrant,
  PersistedTokenUsage,
  ReasoningTree,
  TokenUsageAttribution,
  TokenUsageSnapshot,
  TokenUsageTriplet,
  ToolEvent,
  TurnTokenUsage,
  TurnFailureSummary,
  TurnStatus,
} from "./types";
import { flattenAssistantContentPayload, parseMessageAttachments } from "./utils/content";
import { extractAssistantMessageId, extractMessageDeltaChunk, extractTurnId } from "./utils/message-delta";
import { createEmptyReasoningTree, forceCloseActiveReasoning, reduceReasoningEvent } from "./utils/reasoning";
import { isPlaceholderSessionTitle } from "./utils/sessions";
import { extractTurnFailureSummary } from "./utils/turn-failure";

export interface AssistantStoreOptions {
  engine: AssistantEnginePort;
  reasoningStore?: ReasoningStore;
  /** 默认 agent id（缺省时 send 自动 createSession 用）。 */
  defaultAgentId?: string;
  defaultModelCode?: string;
  /** 占位 message id 前缀（与 ghcloud 兼容；默认 'assistant-'） */
  placeholderIdPrefix?: string;
  /** 推导新会话标题；默认 `text.slice(0, 20)` */
  deriveTitleFromText?: (text: string) => string;
  /**
   * @deprecated send() 已按「会话是否已有 user 消息」推导标题；保留仅供兼容，不再参与 send。
   */
  isPlaceholderTitle?: (title: string) => boolean;
  /** turn 结束后 placeholder id 仍未被替换时，是否 listMessages 兜底（默认 true） */
  fallbackResolveAssistantId?: boolean;
  /**
   * 创建后自动加载：
   *   - 'sessions'           → 仅 listSessions
   *   - 'sessions-and-first' → listSessions + openSession(first)
   *   - false                → 不动
   */
  autoLoad?: "sessions" | "sessions-and-first" | false;
  debugEventBuffer?: { max: number } | false;
}

export interface AssistantState {
  sessions: AssistantSessionSummary[];
  currentSessionId: string | null;
  messagesBySessionId: Record<string, AssistantMessage[]>;
  sendingBySessionId: Record<string, boolean>;
  activeTurnIdBySessionId: Record<string, string | null>;
  lastTurnStatusBySessionId: Record<string, TurnStatus>;
  lastTurnFailureBySessionId: Record<string, TurnFailureSummary | null>;
  /** 同步 sending state 给 UI 的便利字段 = `sendingBySessionId[currentSessionId] === true`。 */
  sending: boolean;
  /** awaiting grant = pendingGrants.length > 0 && sending */
  awaitingGrant: boolean;
  pendingGrants: PendingGrant[];
  toolEventsBySessionId: Record<string, ToolEvent[]>;
  tokenUsageBySessionId: Record<string, TurnTokenUsage | null>;
  /** 调试事件循环缓冲（仅开发态；通过 debugEventBuffer 配置） */
  debugEvents: Array<{ ts: number; event: string; data: Record<string, unknown> }>;
  models: LlmOption[];
  loadingSessions: boolean;
  loadingModels: boolean;
}

export type StoreListener = (state: Readonly<AssistantState>) => void;

interface SendOptions {
  modelCode?: string;
  providerCode?: string;
  providerId?: string;
  runtimeRefs?: RuntimeRefs;
  /** Image attachments (ADR-0008 §D4); requires prior `FilesApi.upload`. */
  attachments?: ImageAttachment[];
}

function buildStartTurnBody(text: string, attachments: ImageAttachment[]): StartTurnBody {
  const trimmed = text.trim();
  if (attachments.length === 0) {
    return {
      content: buildTextMessage(trimmed),
      attachments: [],
    };
  }
  const blocks = [];
  if (trimmed.length > 0) {
    blocks.push({ type: "text" as const, text: trimmed });
  }
  for (const att of attachments) {
    blocks.push(buildImageRefBlock(att.attachmentId));
  }
  return buildMultimodalTurnBody(blocks, attachments);
}

const DEFAULT_DERIVE_TITLE = (text: string): string => text.trim().slice(0, 20);

function readTokenUsageTriplet(raw: unknown): TokenUsageTriplet | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const { input, output, total } = obj;
  if (typeof input !== "number" || typeof output !== "number" || typeof total !== "number") {
    return null;
  }
  return {
    input: Math.max(0, Math.trunc(input)),
    output: Math.max(0, Math.trunc(output)),
    total: Math.max(0, Math.trunc(total)),
  };
}

function readTokenUsageDeltaAsTriplet(raw: unknown): TokenUsageTriplet | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const { input, output } = obj;
  if (typeof input !== "number" || typeof output !== "number") return null;
  const safeInput = Math.max(0, Math.trunc(input));
  const safeOutput = Math.max(0, Math.trunc(output));
  return { input: safeInput, output: safeOutput, total: safeInput + safeOutput };
}

function readTokenUsageAttribution(raw: unknown): TokenUsageAttribution | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.kind !== "string") return undefined;
  return {
    id: obj.id,
    kind: obj.kind,
    ...(typeof obj.parentId === "string" ? { parentId: obj.parentId } : {}),
    ...(typeof obj.label === "string" ? { label: obj.label } : {}),
    ...(obj.meta != null && typeof obj.meta === "object" && !Array.isArray(obj.meta) ? { meta: obj.meta as Record<string, unknown> } : {}),
  };
}

function emptyState(): AssistantState {
  return {
    sessions: [],
    currentSessionId: null,
    messagesBySessionId: {},
    sendingBySessionId: {},
    activeTurnIdBySessionId: {},
    lastTurnStatusBySessionId: {},
    lastTurnFailureBySessionId: {},
    sending: false,
    awaitingGrant: false,
    pendingGrants: [],
    toolEventsBySessionId: {},
    tokenUsageBySessionId: {},
    debugEvents: [],
    models: [],
    loadingSessions: false,
    loadingModels: false,
  };
}

interface TurnStreamHandle {
  sessionId: string;
  turnId: string;
  abort: AbortController;
  /** Background promise；store 持有以等待 graceful cleanup（不暴露给业务）。 */
  loop: Promise<void>;
}

function streamKey(sessionId: string, turnId: string): string {
  return `${sessionId}::${turnId}`;
}

export class AssistantStore {
  private state: AssistantState = emptyState();
  private readonly listeners = new Set<StoreListener>();
  private readonly engine: AssistantEnginePort;
  private readonly reasoningStore: ReasoningStore;
  private readonly placeholderIdPrefix: string;
  private readonly deriveTitleFromText: (text: string) => string;
  private readonly isPlaceholderTitle: (title: string) => boolean;
  private readonly fallbackResolveAssistantId: boolean;
  private readonly debugMax: number;
  private readonly defaultAgentId: string | undefined;
  private readonly defaultModelCode: string | undefined;
  /**
   * 一 turn 一 stream（ADR-0008 修订 §D5.1.v2，ghcloud 原意）：
   * key = `${sessionId}::${turnId}`。流在自己 turn 的 terminal event 上自动关闭，
   * 避免跨 turn 事件污染 reasoning 树。
   */
  private readonly streams = new Map<string, TurnStreamHandle>();
  private disposed = false;

  constructor(opts: AssistantStoreOptions) {
    this.engine = opts.engine;
    this.reasoningStore = opts.reasoningStore ?? createMemoryReasoningStore();
    this.placeholderIdPrefix = opts.placeholderIdPrefix ?? "assistant-";
    this.deriveTitleFromText = opts.deriveTitleFromText ?? DEFAULT_DERIVE_TITLE;
    this.isPlaceholderTitle = opts.isPlaceholderTitle ?? isPlaceholderSessionTitle;
    this.fallbackResolveAssistantId = opts.fallbackResolveAssistantId ?? true;
    this.defaultAgentId = opts.defaultAgentId;
    this.defaultModelCode = opts.defaultModelCode;
    this.debugMax = opts.debugEventBuffer === false ? 0 : (opts.debugEventBuffer?.max ?? 0);

    const autoLoad = opts.autoLoad ?? false;
    if (autoLoad !== false) {
      void this.bootstrap(autoLoad);
    }
  }

  // ---------------------------------------------------------------------------
  // Subscription API
  // ---------------------------------------------------------------------------

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): Readonly<AssistantState> {
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  reset(): void {
    this.assertAlive("reset");
    for (const handle of this.streams.values()) {
      handle.abort.abort();
    }
    this.streams.clear();
    this.state = emptyState();
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    for (const handle of this.streams.values()) {
      handle.abort.abort();
    }
    this.streams.clear();
    this.state = emptyState();
    this.disposed = true;
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------
  // Session API
  // ---------------------------------------------------------------------------

  async loadSessions(): Promise<void> {
    this.assertAlive("loadSessions");
    this.setState({ loadingSessions: true });
    try {
      const { items } = await this.engine.listSessions();
      this.setState({ sessions: items });
    } finally {
      this.setState({ loadingSessions: false });
    }
  }

  /**
   * 直接覆写 `state.models`（外部注入 listModels 用）。
   * 走 setState + emit 链路；不要直接改 `state.models`，否则任何后续 store 触发的事件
   * 都会通过 `Object.assign(reactiveState, next)` 把这份 models 清掉（subscribe 回调
   * 拿到的是 store 的最新内部状态）。
   */
  setModels(models: LlmOption[]): void {
    this.assertAlive("setModels");
    this.setState({ models });
  }

  setLoadingModels(loading: boolean): void {
    this.assertAlive("setLoadingModels");
    this.setState({ loadingModels: loading });
  }

  async openSession(sessionId: string): Promise<void> {
    this.assertAlive("openSession");
    this.setState({ currentSessionId: sessionId });
    this.syncSendingFromCurrent();
    // 不在此开 SSE — 一 turn 一 stream（在 send() 拿到 turnId 之后才开）；
    // 浏览刷新后历史 turn 的事件不会被重放进任何活跃 stream。
    await this.refreshMessages(sessionId);
  }

  async createSession(req: {
    agentId?: string;
    title?: string;
    modelCode?: string;
    purpose?: "chat" | "debug";
    agentVersionNo?: number;
    context?: Record<string, unknown>;
  }): Promise<string> {
    this.assertAlive("createSession");
    const agentId = req.agentId ?? this.defaultAgentId;
    if (!agentId) {
      throw new Error("createSession: agentId is required (no defaultAgentId in ProvideAssistantOptions)");
    }
    const modelCode = req.modelCode ?? this.defaultModelCode;
    const created = await this.engine.createSession({
      agentId,
      ...(req.title !== undefined ? { title: req.title } : {}),
      ...(modelCode !== undefined ? { modelCode } : {}),
      ...(req.purpose !== undefined ? { purpose: req.purpose } : {}),
      ...(req.agentVersionNo !== undefined ? { agentVersionNo: req.agentVersionNo } : {}),
      ...(req.context !== undefined ? { context: req.context } : {}),
    });
    const session: AssistantSessionSummary = {
      id: created.id,
      title: created.title ?? req.title ?? "",
      updatedAt: created.createTime,
    };
    this.setState({
      sessions: [session, ...this.state.sessions],
      currentSessionId: created.id,
    });
    // 一 turn 一 stream：刚创建的空 session 还没 turn — 不开 stream。
    return created.id;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.assertAlive("deleteSession");
    await this.engine.deleteSession(sessionId);
    // 关闭该 session 下所有活跃的 per-turn streams
    for (const [key, handle] of this.streams) {
      if (handle.sessionId === sessionId) {
        handle.abort.abort();
        this.streams.delete(key);
      }
    }
    const next: Partial<AssistantState> = {
      sessions: this.state.sessions.filter((s) => s.id !== sessionId),
    };
    if (this.state.currentSessionId === sessionId) {
      next.currentSessionId = null;
      next.sending = false;
    }
    const newMsgs = { ...this.state.messagesBySessionId };
    delete newMsgs[sessionId];
    next.messagesBySessionId = newMsgs;
    const newSending = { ...this.state.sendingBySessionId };
    delete newSending[sessionId];
    next.sendingBySessionId = newSending;
    const newTurns = { ...this.state.activeTurnIdBySessionId };
    delete newTurns[sessionId];
    next.activeTurnIdBySessionId = newTurns;
    const newStatus = { ...this.state.lastTurnStatusBySessionId };
    delete newStatus[sessionId];
    next.lastTurnStatusBySessionId = newStatus;
    const newTools = { ...this.state.toolEventsBySessionId };
    delete newTools[sessionId];
    next.toolEventsBySessionId = newTools;
    this.setState(next);
  }

  async patchSession(sessionId: string, patch: { title?: string; status?: "ACTIVE" | "CLOSED" }): Promise<void> {
    this.assertAlive("patchSession");
    await this.engine.patchSession(sessionId, patch);
    if (patch.title != null) {
      const sessions = this.state.sessions.map((s) => (s.id === sessionId ? { ...s, title: patch.title as string } : s));
      this.setState({ sessions });
    }
  }

  // ---------------------------------------------------------------------------
  // Send / Cancel
  // ---------------------------------------------------------------------------

  /**
   * 发送一条用户消息。
   *
   *   1. 本地预检：当前 session sending=true → 抛 `SessionBusyError.local()`
   *   2. 若无 currentSessionId → 自动 createSession（标题 = `deriveTitleFromText`）
   *   2b. 若当前会话尚无用户消息 → `patchSession` 用首条用户消息推导标题
   *   3. 占位 user + placeholder assistant 立即入 messages（UX 响应）
   *   4. ensureStream（复用既有，否则起新）
   *   5. engine.startTurn → activeTurnId
   *   6. SSE 事件由 stream loop 推动消息 reducer
   *   失败时回滚两条占位 + 复位 sending + 抛错给业务侧。
   */
  async send(text: string, opts: SendOptions = {}): Promise<{ turnId: string }> {
    this.assertAlive("send");
    const trimmed = text.trim();
    const attachments = opts.attachments ?? [];
    if (trimmed.length === 0 && attachments.length === 0) {
      throw new Error("send requires non-empty text or at least one image attachment");
    }

    let sessionId = this.state.currentSessionId;
    if (sessionId && this.state.sendingBySessionId[sessionId]) {
      throw SessionBusyError.local();
    }

    // 1. ensure session
    if (!sessionId) {
      const id = await this.createSession({
        title: this.deriveTitleFromText(trimmed),
      });
      sessionId = id;
    }

    // 2. 首条用户消息时推导并持久化标题（按会话消息状态，不依赖 title 文案）
    const priorMessages = this.state.messagesBySessionId[sessionId] ?? [];
    const isFirstUserMessage = !priorMessages.some((m) => m.role === "user");
    if (isFirstUserMessage) {
      const newTitle = this.deriveTitleFromText(trimmed || "[图片]");
      void this.patchSession(sessionId, { title: newTitle }).catch(() => {
        /* 标题失败不阻塞主链路 */
      });
    }

    // 3. push placeholders
    const userMsg: AssistantMessage = {
      id: `${this.placeholderIdPrefix}user-${crypto.randomUUID()}`,
      role: "user",
      content: trimmed,
      ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
      createdAt: Date.now(),
    };
    const assistantPlaceholderId = `${this.placeholderIdPrefix}${crypto.randomUUID()}`;
    const assistantMsg: AssistantMessage = {
      id: assistantPlaceholderId,
      role: "assistant",
      content: "",
      createdAt: Date.now() + 1,
      reasoning: createEmptyReasoningTree(),
    };

    this.pushMessages(sessionId, [userMsg, assistantMsg]);
    this.setSessionSending(sessionId, true);

    // 4. startTurn（拿 turnId 后再开 stream）
    let turnId: string;
    try {
      const modelCode = opts.modelCode ?? this.defaultModelCode;
      const turnBody = buildStartTurnBody(trimmed, attachments);
      const res = await this.engine.startTurn(sessionId, {
        ...turnBody,
        ...(modelCode !== undefined ? { modelCode } : {}),
        ...(opts.providerCode !== undefined ? { providerCode: opts.providerCode } : {}),
        ...(opts.providerId !== undefined ? { providerId: opts.providerId } : {}),
        ...(opts.runtimeRefs !== undefined ? { runtimeRefs: opts.runtimeRefs } : {}),
      });
      turnId = res.turnId;
    } catch (e) {
      // rollback placeholders
      this.removeMessages(sessionId, [userMsg.id, assistantPlaceholderId]);
      this.setSessionSending(sessionId, false);
      if (e instanceof StartTurnFailedError || e instanceof SessionBusyError) throw e;
      throw e;
    }

    this.setState({
      activeTurnIdBySessionId: {
        ...this.state.activeTurnIdBySessionId,
        [sessionId]: turnId,
      },
      lastTurnStatusBySessionId: {
        ...this.state.lastTurnStatusBySessionId,
        [sessionId]: "running",
      },
    });

    // 5. 开 per-turn stream — 仅监听本 turn 的事件，turn 终态自动关闭
    this.startTurnStream(sessionId, turnId);

    return { turnId };
  }

  /**
   * 取消当前 session 的活跃 turn：
   *   - POST cancel（fire-and-forget；错误吞）
   *   - 立刻把 sending 置 false（UX 响应）；engine 端 turn-cancelled-v1 事件由 SSE 兜底
   */
  async cancel(): Promise<void> {
    this.assertAlive("cancel");
    const sessionId = this.state.currentSessionId;
    if (!sessionId) return;
    const turnId = this.state.activeTurnIdBySessionId[sessionId];
    if (!turnId) return;
    this.setSessionSending(sessionId, false);
    try {
      await this.engine.cancelTurn(sessionId, turnId);
    } catch {
      /* fire-and-forget */
    }
    // 兜底关闭本 turn 的 stream：若 engine cancel HTTP 失败 / 未发出
    // turn-cancelled-v1，runTurnStream 不会自然 break — 这里主动 abort。
    this.stopTurnStream(sessionId, turnId);
  }

  // ---------------------------------------------------------------------------
  // Grant
  // ---------------------------------------------------------------------------

  async respondGrant(input: {
    grantRequestId: string;
    decision: "APPROVE" | "DENY";
    scopeChoice?: "ONCE" | "SESSION" | "PERSISTENT";
    rememberTtlSeconds?: number;
    note?: string;
  }): Promise<void> {
    this.assertAlive("respondGrant");
    const pendingGrants = this.state.pendingGrants.filter((g) => g.grantRequestId !== input.grantRequestId);
    this.setState({
      pendingGrants,
      awaitingGrant: pendingGrants.length > 0 && this.state.sending,
    });
    try {
      await this.engine.respondGrant(input);
    } catch {
      /* engine grant 应答失败时不回滚 — engine 会重发 SSE，state 会自然纠正 */
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: stream lifecycle
  // ---------------------------------------------------------------------------

  private startTurnStream(sessionId: string, turnId: string): void {
    const key = streamKey(sessionId, turnId);
    if (this.streams.has(key)) return;
    const abort = new AbortController();
    const loop = this.runTurnStream(sessionId, turnId, abort.signal).catch(() => {
      /* swallowed; handled inside runTurnStream */
    });
    this.streams.set(key, { sessionId, turnId, abort, loop });
  }

  private stopTurnStream(sessionId: string, turnId: string): void {
    const key = streamKey(sessionId, turnId);
    const handle = this.streams.get(key);
    if (!handle) return;
    handle.abort.abort();
    this.streams.delete(key);
  }

  private async runTurnStream(sessionId: string, turnId: string, signal: AbortSignal): Promise<void> {
    try {
      // engine 侧用 `?turnId=` 把本 turn 的回放 + live fan-out 都隔离掉；
      // 客户端再加一层 `event.data.turnId !== turnId` 防御（应对老 engine / proxy 改写）。
      for await (const ev of this.engine.streamEvents(sessionId, { turnId, signal })) {
        if (signal.aborted) break;
        const evTurnId = (ev.data as { turnId?: unknown }).turnId;
        if (typeof evTurnId === "string" && evTurnId !== "" && evTurnId !== turnId) {
          continue;
        }
        this.handleEvent(sessionId, ev);
        if (ev.event === "turn-completed-v1" || ev.event === "turn-failed-v1" || ev.event === "turn-cancelled-v1") {
          // 本 turn 终态 — 自然收尾退出（不必等服务端 done）
          break;
        }
      }
    } catch (e) {
      if (e instanceof StreamDisconnectedError) {
        // 强 END 活跃 reasoning + 把 sending 复位
        this.forceCloseSessionOnDisconnect(sessionId, e);
      }
      // 其它错误 swallow — Store 不暴露内部 stream 异常给业务
    } finally {
      const key = streamKey(sessionId, turnId);
      if (this.streams.get(key)?.abort.signal === signal) {
        this.streams.delete(key);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: event reducer
  // ---------------------------------------------------------------------------

  private handleEvent(sessionId: string, ev: NormalizedSseEvent): void {
    this.recordDebugEvent(ev);
    const data = ev.data;

    switch (ev.event) {
      case "message-delta-v1": {
        const chunk = extractMessageDeltaChunk(data);
        const serverMessageId = extractAssistantMessageId(data);
        const turnId = extractTurnId(data) ?? undefined;
        if (chunk) {
          this.appendAssistantContent(sessionId, chunk, serverMessageId, turnId);
        } else if (serverMessageId) {
          this.replacePlaceholderIdWithServer(sessionId, serverMessageId, turnId);
        }
        return;
      }
      case "message-completed-v1": {
        const serverMessageId = extractAssistantMessageId(data);
        const turnId = extractTurnId(data) ?? undefined;
        if (serverMessageId) {
          this.replacePlaceholderIdWithServer(sessionId, serverMessageId, turnId);
        }
        const finalContent = flattenAssistantContentPayload(
          (data as { content?: unknown; messageContent?: unknown }).content ?? (data as { messageContent?: unknown }).messageContent,
        );
        if (finalContent !== "") {
          this.setLastAssistantContent(sessionId, finalContent);
        }
        return;
      }
      case "reasoning-step-v1":
      case "reasoning-delta-v1": {
        this.foldReasoning(sessionId, ev);
        return;
      }
      case "tool-call-started-v1":
      case "tool-call-completed-v1": {
        this.foldReasoning(sessionId, ev);
        this.appendToolEvent(sessionId, ev);
        return;
      }
      case "usage-delta-v1":
      case "usage-delta-v2": {
        this.applyUsageDelta(sessionId, ev);
        return;
      }
      case "turn-started-v1": {
        const turnId = extractTurnId(data) ?? undefined;
        if (turnId) {
          this.setState({
            activeTurnIdBySessionId: {
              ...this.state.activeTurnIdBySessionId,
              [sessionId]: turnId,
            },
            lastTurnStatusBySessionId: {
              ...this.state.lastTurnStatusBySessionId,
              [sessionId]: "running",
            },
            tokenUsageBySessionId: {
              ...this.state.tokenUsageBySessionId,
              [sessionId]: {
                turnId,
                cumulative: { input: 0, output: 0, total: 0 },
                items: [],
                updatedAt: Date.now(),
              },
            },
          });
        }
        return;
      }
      case "turn-completed-v1": {
        this.applyTurnCompletedUsage(sessionId, ev);
        this.finalizeTurn(sessionId, "completed", null);
        return;
      }
      case "turn-failed-v1": {
        const summary = extractTurnFailureSummary(data);
        this.setLastAssistantContent(sessionId, summary.message);
        this.finalizeTurn(sessionId, "failed", summary);
        return;
      }
      case "turn-cancelled-v1": {
        this.finalizeTurn(sessionId, "cancelled", null);
        return;
      }
      case "grant-request-v1": {
        const grant = this.normalizeGrantRequest(data);
        if (!grant) return;
        const next = [...this.state.pendingGrants, grant];
        this.setState({
          pendingGrants: next,
          awaitingGrant: this.state.sending,
        });
        return;
      }
      case "tool-use-started-v1":
      case "tool-use-completed-v1": {
        this.appendToolEvent(sessionId, ev);
        return;
      }
      default:
        return;
    }
  }

  private foldReasoning(sessionId: string, ev: NormalizedSseEvent): void {
    const messages = this.state.messagesBySessionId[sessionId] ?? [];
    const lastIdx = findLastAssistantIdx(messages);
    if (lastIdx < 0) return;
    const target = messages[lastIdx]!;
    const next = reduceReasoningEvent(target.reasoning, { event: ev.event, data: ev.data });
    if (next === target.reasoning) return;
    const updated: AssistantMessage = { ...target, reasoning: next };
    const newMessages = messages.slice();
    newMessages[lastIdx] = updated;
    this.setState({
      messagesBySessionId: {
        ...this.state.messagesBySessionId,
        [sessionId]: newMessages,
      },
    });
  }

  private appendAssistantContent(sessionId: string, chunk: string, serverMessageId: string | null, turnId: string | undefined): void {
    const messages = this.state.messagesBySessionId[sessionId] ?? [];
    const lastIdx = findLastAssistantIdx(messages);
    if (lastIdx < 0) return;
    const target = messages[lastIdx]!;
    let id = target.id;
    if (serverMessageId && id.startsWith(this.placeholderIdPrefix)) {
      id = serverMessageId;
    }
    const next: AssistantMessage = {
      ...target,
      id,
      content: `${target.content}${chunk}`,
      ...(turnId ? { turnId } : {}),
    };
    const newMessages = messages.slice();
    newMessages[lastIdx] = next;
    this.setState({
      messagesBySessionId: {
        ...this.state.messagesBySessionId,
        [sessionId]: newMessages,
      },
    });
  }

  private replacePlaceholderIdWithServer(sessionId: string, serverMessageId: string, turnId: string | undefined): void {
    const messages = this.state.messagesBySessionId[sessionId] ?? [];
    const lastIdx = findLastAssistantIdx(messages);
    if (lastIdx < 0) return;
    const target = messages[lastIdx]!;
    if (!target.id.startsWith(this.placeholderIdPrefix)) return;
    const newMessages = messages.slice();
    newMessages[lastIdx] = {
      ...target,
      id: serverMessageId,
      ...(turnId ? { turnId } : {}),
    };
    this.setState({
      messagesBySessionId: {
        ...this.state.messagesBySessionId,
        [sessionId]: newMessages,
      },
    });
  }

  private setLastAssistantContent(sessionId: string, content: string): void {
    const messages = this.state.messagesBySessionId[sessionId] ?? [];
    const lastIdx = findLastAssistantIdx(messages);
    if (lastIdx < 0) return;
    const target = messages[lastIdx]!;
    if (target.content === content) return;
    const newMessages = messages.slice();
    newMessages[lastIdx] = { ...target, content };
    this.setState({
      messagesBySessionId: {
        ...this.state.messagesBySessionId,
        [sessionId]: newMessages,
      },
    });
  }

  private finalizeTurn(sessionId: string, status: TurnStatus, failure: TurnFailureSummary | null): void {
    // 1. 把当前 turn 的 tokenUsage 快照归档到 last assistant message，并随 reasoning 一起 commit。
    //    `terminalKind` 与 `status` 三态一一对应（completed/cancelled/failed）。
    //    任意一份非空就触发 IDB 写（reasoning 或 tokenUsage 至少一份非空）。
    const messages = this.state.messagesBySessionId[sessionId] ?? [];
    const lastIdx = findLastAssistantIdx(messages);
    if (lastIdx >= 0) {
      const target = messages[lastIdx]!;
      const archived = this.archiveTokenUsageOnMessage(sessionId, lastIdx, status);
      const messageForCommit = archived ?? target;
      if (messageForCommit.reasoning || messageForCommit.tokenUsage) {
        void this.commitReasoning(sessionId, messageForCommit);
      }
    }
    this.setState({
      sendingBySessionId: {
        ...this.state.sendingBySessionId,
        [sessionId]: false,
      },
      activeTurnIdBySessionId: {
        ...this.state.activeTurnIdBySessionId,
        [sessionId]: null,
      },
      lastTurnStatusBySessionId: {
        ...this.state.lastTurnStatusBySessionId,
        [sessionId]: status,
      },
      lastTurnFailureBySessionId: {
        ...this.state.lastTurnFailureBySessionId,
        [sessionId]: failure,
      },
    });
    this.syncSendingFromCurrent();

    // 2. per-turn stream 由 runTurnStream 在 terminal event 处自然 break 退出；
    //    无需在此显式 stopTurnStream（cancel 路径除外，由 cancel() 主动关闭）。

    // 3. 兜底解析 assistant id（若仍是 placeholder）
    if (this.fallbackResolveAssistantId && lastIdx >= 0) {
      const target = messages[lastIdx]!;
      if (target.id.startsWith(this.placeholderIdPrefix)) {
        void this.fallbackResolveLastAssistantId(sessionId, target.id);
      }
    }
  }

  private async commitReasoning(sessionId: string, message: AssistantMessage): Promise<void> {
    if (!message.reasoning && !message.tokenUsage) return;
    if (message.id.startsWith(this.placeholderIdPrefix)) return;
    try {
      await this.reasoningStore.put(sessionId, message.id, message.reasoning ?? { steps: [] }, message.tokenUsage);
    } catch {
      /* IDB error 不影响 UI */
    }
  }

  /**
   * 把 `tokenUsageBySessionId[sid]` 的当时快照归档到指定 assistant message。
   * 仅当 turn 与 message 的 turnId 匹配（且 cumulative 非零或 items 非空）才写入。
   * 返回归档后的 message 引用（用于 commit）；未归档时返回 null。
   */
  private archiveTokenUsageOnMessage(sessionId: string, messageIdx: number, status: TurnStatus): AssistantMessage | null {
    const live = this.state.tokenUsageBySessionId[sessionId];
    if (!live) return null;
    const messages = this.state.messagesBySessionId[sessionId] ?? [];
    const target = messages[messageIdx];
    if (!target) return null;
    if (target.turnId !== undefined && target.turnId !== live.turnId) return null;
    const cumZero = live.cumulative.input === 0 && live.cumulative.output === 0 && live.cumulative.total === 0;
    if (cumZero && live.items.length === 0) return null;
    const terminalKind: "completed" | "cancelled" | "failed" =
      status === "completed" || status === "cancelled" || status === "failed" ? status : "completed";
    const archived: PersistedTokenUsage = {
      cumulative: live.cumulative,
      items: live.items.slice(),
      terminalKind,
    };
    const newMessages = messages.slice();
    newMessages[messageIdx] = { ...target, tokenUsage: archived };
    this.setState({
      messagesBySessionId: {
        ...this.state.messagesBySessionId,
        [sessionId]: newMessages,
      },
    });
    return newMessages[messageIdx]!;
  }

  private async fallbackResolveLastAssistantId(sessionId: string, placeholderId: string): Promise<void> {
    try {
      const r = await this.engine.listMessages(sessionId, { limit: 5 });
      let latestAssistant: (typeof r.items)[number] | undefined;
      for (let i = r.items.length - 1; i >= 0; i -= 1) {
        const message = r.items[i];
        if (message.role === "assistant") {
          latestAssistant = message;
          break;
        }
      }
      if (!latestAssistant) return;
      const messages = this.state.messagesBySessionId[sessionId] ?? [];
      const idx = messages.findIndex((m) => m.id === placeholderId);
      if (idx < 0) return;
      const newMessages = messages.slice();
      const target = newMessages[idx]!;
      const resolvedTurnId = latestAssistant.turnId ?? target.turnId;
      newMessages[idx] = {
        ...target,
        id: latestAssistant.id,
        ...(resolvedTurnId !== undefined ? { turnId: resolvedTurnId } : {}),
      };
      this.setState({
        messagesBySessionId: {
          ...this.state.messagesBySessionId,
          [sessionId]: newMessages,
        },
      });
      if (target.reasoning) {
        await this.commitReasoning(sessionId, newMessages[idx]!);
      }
    } catch {
      /* swallow */
    }
  }

  private forceCloseSessionOnDisconnect(sessionId: string, e: StreamDisconnectedError): void {
    const messages = this.state.messagesBySessionId[sessionId] ?? [];
    const lastIdx = findLastAssistantIdx(messages);
    if (lastIdx >= 0) {
      const target = messages[lastIdx]!;
      if (target.reasoning) {
        const next: ReasoningTree = forceCloseActiveReasoning(target.reasoning, {
          code: "STREAM_DISCONNECTED",
          message: e.message,
        });
        const newMessages = messages.slice();
        newMessages[lastIdx] = { ...target, reasoning: next };
        this.setState({
          messagesBySessionId: {
            ...this.state.messagesBySessionId,
            [sessionId]: newMessages,
          },
        });
      }
    }
    this.setSessionSending(sessionId, false);
  }

  private appendToolEvent(sessionId: string, ev: NormalizedSseEvent): void {
    const data = ev.data;
    const id =
      typeof data.toolCallId === "string"
        ? data.toolCallId
        : typeof data.toolUseId === "string"
          ? data.toolUseId
          : typeof data.id === "string"
            ? data.id
            : "";
    if (!id) return;
    const toolName = typeof data.toolName === "string" ? data.toolName : "unknown";
    const time = typeof data.time === "number" ? data.time : Date.now();
    const turnId = typeof data.turnId === "string" ? data.turnId : undefined;
    const list = this.state.toolEventsBySessionId[sessionId] ?? [];
    if (ev.event === "tool-call-started-v1" || ev.event === "tool-use-started-v1") {
      const next: ToolEvent = {
        id,
        toolName,
        phase: "started",
        startedAt: time,
        ...(turnId ? { turnId } : {}),
      };
      this.setState({
        toolEventsBySessionId: {
          ...this.state.toolEventsBySessionId,
          [sessionId]: [...list, next],
        },
      });
      return;
    }
    if (ev.event === "tool-call-completed-v1" || ev.event === "tool-use-completed-v1") {
      const resultPreview = (data as { resultPreview?: unknown }).resultPreview ?? (data as { output?: unknown }).output;
      const idx = list.findIndex((t) => t.id === id);
      if (idx < 0) {
        const next: ToolEvent = {
          id,
          toolName,
          phase: "completed",
          startedAt: time,
          completedAt: time,
          resultPreview,
          ...(turnId ? { turnId } : {}),
        };
        this.setState({
          toolEventsBySessionId: {
            ...this.state.toolEventsBySessionId,
            [sessionId]: [...list, next],
          },
        });
        return;
      }
      const newList = list.slice();
      newList[idx] = {
        ...newList[idx]!,
        phase: "completed",
        completedAt: time,
        resultPreview,
        ...(turnId && !newList[idx]!.turnId ? { turnId } : {}),
      };
      this.setState({
        toolEventsBySessionId: {
          ...this.state.toolEventsBySessionId,
          [sessionId]: newList,
        },
      });
    }
  }

  private applyUsageDelta(sessionId: string, ev: NormalizedSseEvent): void {
    const data = ev.data;
    const turnId = extractTurnId(data) ?? this.state.activeTurnIdBySessionId[sessionId] ?? undefined;
    if (!turnId) return;
    const cumulative = readTokenUsageTriplet(data.cumulative);
    if (!cumulative) return;
    const usage = readTokenUsageTriplet(data.usage) ?? readTokenUsageDeltaAsTriplet(data.delta);
    const attribution = readTokenUsageAttribution(data.attribution);
    const accuracy = data.accuracy === "estimated" || data.accuracy === "final" ? data.accuracy : undefined;
    const terminal =
      data.terminal === "cancelled" || data.terminal === "failed" || data.terminal === "disconnected" ? data.terminal : undefined;
    const snapshot: TokenUsageSnapshot = {
      turnId,
      usage: usage ?? cumulative,
      cumulative,
      ...(attribution !== undefined ? { attribution } : {}),
      ...(accuracy !== undefined ? { accuracy } : {}),
      ...(terminal !== undefined ? { terminal } : {}),
      updatedAt: Date.now(),
    };
    const prev = this.state.tokenUsageBySessionId[sessionId];
    const items = prev?.turnId === turnId ? prev.items.slice() : [];
    if (attribution?.id) {
      const idx = items.findIndex((item) => item.attribution?.id === attribution.id);
      if (idx >= 0) {
        items[idx] = snapshot;
      } else {
        items.push(snapshot);
      }
    } else {
      // Unattributed usage-delta = turn-level aggregate (e.g. engine done-fallback).
      // It is NOT a per-LLM-call item; only refresh `cumulative`.
      // Keeps items[] free of phantom rows that would render as "LLM 估算中" in UIs.
      if (typeof console !== "undefined" && typeof console.debug === "function") {
        console.debug("[assistant-sdk] usage-delta without attribution: treated as turn aggregate (cumulative only)", { turnId });
      }
    }
    this.setState({
      tokenUsageBySessionId: {
        ...this.state.tokenUsageBySessionId,
        [sessionId]: {
          turnId,
          cumulative,
          items,
          updatedAt: snapshot.updatedAt,
        },
      },
    });
  }

  private applyTurnCompletedUsage(sessionId: string, ev: NormalizedSseEvent): void {
    const turnId = extractTurnId(ev.data);
    const cumulative = readTokenUsageTriplet(ev.data.tokenUsage);
    if (!turnId || !cumulative) return;
    const prev = this.state.tokenUsageBySessionId[sessionId];
    this.setState({
      tokenUsageBySessionId: {
        ...this.state.tokenUsageBySessionId,
        [sessionId]: {
          turnId,
          cumulative,
          items: prev?.turnId === turnId ? prev.items : [],
          updatedAt: Date.now(),
        },
      },
    });
  }

  private normalizeGrantRequest(data: Record<string, unknown>): PendingGrant | null {
    const grantRequestId = typeof data.grantRequestId === "string" ? data.grantRequestId : "";
    if (!grantRequestId) return null;
    const out: PendingGrant = { grantRequestId, raw: data };
    if (typeof data.turnId === "string") out.turnId = data.turnId;
    if (typeof data.toolName === "string") out.toolName = data.toolName;
    if (typeof data.reason === "string") out.reason = data.reason;
    if (data.argsPreview !== undefined) out.argsPreview = data.argsPreview;
    if (data.scopeHint === "ONCE" || data.scopeHint === "SESSION" || data.scopeHint === "PERSISTENT") {
      out.scopeHint = data.scopeHint;
    }
    if (typeof data.expiresTime === "number") out.expiresTime = data.expiresTime;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async bootstrap(mode: "sessions" | "sessions-and-first"): Promise<void> {
    try {
      await this.loadSessions();
      if (this.disposed) return;
      if (mode === "sessions-and-first") {
        const first = this.state.sessions[0];
        if (first) await this.openSession(first.id);
      }
    } catch {
      /* swallow */
    }
  }

  private async refreshMessages(sessionId: string): Promise<void> {
    try {
      const r = await this.engine.listMessages(sessionId, { limit: 200 });
      const items: AssistantMessage[] = r.items.map((m) => {
        const out: AssistantMessage = {
          id: m.id,
          role: m.role,
          content: flattenAssistantContentPayload(m.content),
          createdAt: m.createTime,
        };
        if (m.turnId != null) out.turnId = m.turnId;
        const parsedAttachments = parseMessageAttachments(m.attachments);
        if (parsedAttachments !== undefined) out.attachments = parsedAttachments;
        return out;
      });
      // 回填 reasoning + tokenUsage（schema v2 起 IDB 行同时承载两份元数据）
      const ids = items.filter((m) => m.role === "assistant").map((m) => m.id);
      const rows = await this.reasoningStore.bulkGet(sessionId, ids);
      for (const m of items) {
        if (m.role !== "assistant") continue;
        const row = rows.get(m.id);
        if (row == null) continue;
        m.reasoning = row.tree;
        if (row.tokenUsage !== undefined) m.tokenUsage = row.tokenUsage;
      }
      this.setState({
        messagesBySessionId: {
          ...this.state.messagesBySessionId,
          [sessionId]: items,
        },
      });
    } catch {
      /* swallow */
    }
  }

  private pushMessages(sessionId: string, msgs: AssistantMessage[]): void {
    const prev = this.state.messagesBySessionId[sessionId] ?? [];
    this.setState({
      messagesBySessionId: {
        ...this.state.messagesBySessionId,
        [sessionId]: [...prev, ...msgs],
      },
    });
  }

  private removeMessages(sessionId: string, ids: string[]): void {
    const idSet = new Set(ids);
    const prev = this.state.messagesBySessionId[sessionId] ?? [];
    this.setState({
      messagesBySessionId: {
        ...this.state.messagesBySessionId,
        [sessionId]: prev.filter((m) => !idSet.has(m.id)),
      },
    });
  }

  private setSessionSending(sessionId: string, sending: boolean): void {
    this.setState({
      sendingBySessionId: {
        ...this.state.sendingBySessionId,
        [sessionId]: sending,
      },
    });
    this.syncSendingFromCurrent();
  }

  private syncSendingFromCurrent(): void {
    const sessionId = this.state.currentSessionId;
    const sending = sessionId ? this.state.sendingBySessionId[sessionId] === true : false;
    this.setState({
      sending,
      awaitingGrant: this.state.pendingGrants.length > 0 && sending,
    });
  }

  private recordDebugEvent(ev: NormalizedSseEvent): void {
    if (this.debugMax <= 0) return;
    const list = [...this.state.debugEvents, { ts: Date.now(), event: ev.event, data: ev.data }];
    if (list.length > this.debugMax) list.splice(0, list.length - this.debugMax);
    this.setState({ debugEvents: list });
  }

  private setState(patch: Partial<AssistantState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        /* listener errors swallowed */
      }
    }
  }

  private assertAlive(method: string): void {
    if (this.disposed) throw new StoreDisposedError(method);
  }
}

function findLastAssistantIdx(messages: AssistantMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") return i;
  }
  return -1;
}

export function createAssistantStore(opts: AssistantStoreOptions): AssistantStore {
  return new AssistantStore(opts);
}
