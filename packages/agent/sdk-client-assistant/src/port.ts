/**
 * Engine port — DI 接口；AssistantStore 通过它访问 cube-agentic-engine。
 * 默认实现 `createAgenticEnginePort(client)` 与 sdk-core 衔接，测试时可注入 fake。
 *
 * 设计原则：
 *   - 不暴露 raw HTTP；仅业务语义方法。
 *   - `streamEvents` 返回 AsyncIterable<NormalizedSseEvent>，统一 `{ id?, event, data }` 形态
 *     （与 ghcloud `parseSseChunk` 输出对齐），让 Store 一处归一化所有 schema。
 *   - 所有方法都接受可选 `signal: AbortSignal`，由 Store 决定生命周期。
 *
 * Ref: ADR-0008 §D4.
 */
import type { SseEvent, StartTurnBody } from '@cube-ai/agent-sdk-client';
import type { ImageAttachment, RuntimeRefs } from '@cube-ai/contracts';
import type { AssistantSessionSummary, LlmOption } from './types';

export interface AssistantEnginePort {
  startTurn(
    sessionId: string,
    body: StartTurnBody & {
      runtimeRefs?: RuntimeRefs;
    },
    opts?: { signal?: AbortSignal },
  ): Promise<{ turnId: string }>;

  streamEvents(
    sessionId: string,
    opts?: { turnId?: string; lastEventId?: string; signal?: AbortSignal },
  ): AsyncIterable<NormalizedSseEvent>;

  listMessages(
    sessionId: string,
    opts?: { limit?: number },
  ): Promise<{ items: PortMessageItem[] }>;

  createSession(req: {
    agentId: string;
    title?: string;
    modelCode?: string;
    context?: Record<string, unknown>;
  }): Promise<{ id: string; title: string | null; createTime: number }>;

  listSessions(opts?: {
    limit?: number;
    cursor?: string;
  }): Promise<{ items: AssistantSessionSummary[]; hasMore: boolean }>;

  getSession(sessionId: string): Promise<{
    id: string;
    title: string | null;
    updateTime?: number;
  } | null>;

  patchSession(
    sessionId: string,
    patch: { title?: string; status?: 'ACTIVE' | 'CLOSED' },
  ): Promise<void>;

  deleteSession(sessionId: string): Promise<void>;

  cancelTurn(sessionId: string, turnId: string): Promise<void>;

  respondGrant(input: GrantResponseInput): Promise<void>;

  listModels?(): Promise<LlmOption[]>;
}

/** Normalized SSE event delivered to Store consumers. */
export interface NormalizedSseEvent {
  id?: string;
  /** Schema 名（去掉 `-v1` 后缀的方便业务匹配？保留全名一致更佳）— 使用 schema 全名 (`turn-started-v1` 等)。 */
  event: string;
  data: Record<string, unknown>;
  /** 原始 sdk-core SseEvent（保留以便业务侧二次解析）。 */
  raw?: SseEvent;
}

export interface PortMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: unknown;
  createTime: number;
  turnId?: string | null;
  attachments?: ImageAttachment[];
}

export interface GrantResponseInput {
  grantRequestId: string;
  /**
   * Engine `GrantResponseRequest.decision` 枚举（agentic-contracts）—保持大写。
   * UI 侧若有自己的小写枚举，调用前自行 map。
   */
  decision: 'APPROVE' | 'DENY';
  scopeChoice?: 'ONCE' | 'SESSION' | 'PERSISTENT';
  rememberTtlSeconds?: number;
  note?: string;
}
