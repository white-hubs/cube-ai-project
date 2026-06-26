import {
  type Session,
  type SseEvent,
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type ImageAttachment,
  type ImageRefMessageBlock,
  type MessageBlock,
  MessageContentV1Schema,
  type MessageContentV1,
  StartTurnRequestSchema,
  SessionSchema,
  TextMessageBlockSchema,
  HEADER_IDEMPOTENCY_KEY,
  SseEventSchema,
} from "@cube-ai/contracts";

export type { CreateSessionRequest, CreateSessionResponse } from "@cube-ai/contracts";
import { z } from "zod";

import type { AgenticClient } from "./client";
import type { AgenticClientConfig } from "./client";
import { AgenticClientError, StartTurnFailedError, SessionBusyError, StreamDisconnectedError } from "./errors";

const PageSchema = z.object({
  nextCursor: z.string().nullable().optional(),
  hasMore: z.boolean(),
});

const ListSessionsResponseSchema = z.object({
  items: z.array(SessionSchema),
  page: PageSchema,
});
export type ListSessionsResult = z.infer<typeof ListSessionsResponseSchema>;

const ListMessagesItemSchema = z
  .object({
    id: z.string(),
    turnId: z.string().nullable().optional(),
    sessionId: z.string().optional(),
    seq: z.number().int().nonnegative().optional(),
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.unknown(),
    createTime: z.number().int(),
  })
  .passthrough();

const ListMessagesResponseSchema = z.object({
  items: z.array(ListMessagesItemSchema),
  page: PageSchema.optional(),
});
export type ListMessagesResult = z.infer<typeof ListMessagesResponseSchema>;
export type ListMessagesItem = z.infer<typeof ListMessagesItemSchema>;

export interface ListSessionsFilter {
  cursor?: string;
  limit?: number;
  status?: "ACTIVE" | "CLOSED" | "ARCHIVED" | "ALL";
  /** 缺省 `chat`（不含 debug 调试会话） */
  purpose?: "chat" | "debug" | "ALL";
}

export interface PatchSessionRequest {
  title?: string;
  status?: "ACTIVE" | "CLOSED";
}

/** Convenience: 把字符串包成单 text-block 的 `message-content-v1`（ADR-0008 §D4 H1a builder）。 */
export function buildTextMessage(text: string): MessageContentV1 {
  return MessageContentV1Schema.parse({
    schema: "message-content-v1",
    blocks: [TextMessageBlockSchema.parse({ type: "text", text })],
  });
}

/** Convenience: 多 block content builder（业务侧自定义结构）。 */
export function buildMultiBlockMessage(blocks: MessageBlock[]): MessageContentV1 {
  return MessageContentV1Schema.parse({ schema: "message-content-v1", blocks });
}

export function buildImageRefBlock(attachmentId: string): ImageRefMessageBlock {
  return { type: "image_ref", attachmentId };
}
export type MessageImageAttachment = ImageAttachment;

export type StartTurnBody = z.input<typeof StartTurnRequestSchema>;

export function buildMultimodalTurnBody(blocks: MessageBlock[], attachments: MessageImageAttachment[]): StartTurnBody {
  return StartTurnRequestSchema.parse({
    content: buildMultiBlockMessage(blocks),
    attachments,
  });
}

export interface StartTurnOpts {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * Session API methods (ADR-0008 §D1)：
 *   - CRUD：create / get / list / patch / delete / listMessages
 *   - Turn：startTurn（POST `/messages` 拿 turnId）/ cancelTurn / streamEvents（GET `/events`）
 *
 * 旧的 `streamMessages` / `sendMessage` / `AgenticStream` 已删除——对真实 engine
 * 是死代码。Ref: docs/detailed-design/08-sdk/sdk-core.md §2.2
 */
export class SessionApi {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: AgenticClientConfig,
    private readonly client: AgenticClient,
  ) {
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
  }

  async create(req: CreateSessionRequest): Promise<CreateSessionResponse> {
    const body = CreateSessionRequestSchema.parse(req);
    const raw = await this.client.requestJson<unknown>({
      method: "POST",
      path: "/sessions",
      body,
    });
    return CreateSessionResponseSchema.parse(raw);
  }

  async get(sessionId: string): Promise<Session> {
    const raw = await this.client.requestJson<unknown>({
      method: "GET",
      path: `/sessions/${sessionId}`,
    });
    return SessionSchema.parse(raw);
  }

  async list(filter: ListSessionsFilter = {}): Promise<ListSessionsResult> {
    const raw = await this.client.requestJson<unknown>({
      method: "GET",
      path: "/sessions",
      query: {
        cursor: filter.cursor,
        limit: filter.limit,
        status: filter.status,
        purpose: filter.purpose ?? "chat",
      },
    });
    return ListSessionsResponseSchema.parse(raw);
  }

  async patch(sessionId: string, patch: PatchSessionRequest): Promise<void> {
    await this.client.requestJson<unknown>({
      method: "PATCH",
      path: `/sessions/${sessionId}`,
      body: patch,
    });
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.requestJson<unknown>({
      method: "DELETE",
      path: `/sessions/${sessionId}`,
    });
  }

  async listMessages(sessionId: string, opts: { limit?: number } = {}): Promise<ListMessagesResult> {
    const raw = await this.client.requestJson<unknown>({
      method: "GET",
      path: `/sessions/${sessionId}/messages`,
      query: { limit: opts.limit },
    });
    return ListMessagesResponseSchema.parse(raw);
  }

  /**
   * POST `/sessions/:sessionId/messages` → `{ turnId }`（同步 JSON 返回）。
   * 失败映射：
   *   - 409 RESOURCE_CONFLICT_TURN_RUNNING / "already has a running turn" → `SessionBusyError`
   *   - 其它 4xx/5xx/网络错 → `StartTurnFailedError`
   * 自动注入 `idempotency-key` （`crypto.randomUUID()`）；可被 `opts.idempotencyKey` override。
   */
  async startTurn(sessionId: string, body: StartTurnBody, opts: StartTurnOpts = {}): Promise<{ turnId: string }> {
    const idem = opts.idempotencyKey ?? crypto.randomUUID();
    try {
      const validatedBody = StartTurnRequestSchema.parse(body);
      const raw = await this.client.requestJson<unknown>({
        method: "POST",
        path: `/sessions/${sessionId}/messages`,
        body: validatedBody,
        idempotencyKey: idem,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const parsed = z.object({ turnId: z.string() }).safeParse(raw);
      if (!parsed.success) {
        throw new StartTurnFailedError("INTERNAL_UNKNOWN", null, "startTurn response did not contain a turnId", raw, null, Date.now());
      }
      return { turnId: parsed.data.turnId };
    } catch (e) {
      if (e instanceof SessionBusyError) throw e;
      if (e instanceof AgenticClientError) {
        throw new StartTurnFailedError(e.code, e.httpStatus, e.message, e.details, e.traceId, e.timestamp, e as unknown as Error);
      }
      throw new StartTurnFailedError(
        null,
        null,
        e instanceof Error ? e.message : String(e),
        null,
        null,
        Date.now(),
        e instanceof Error ? e : undefined,
      );
    }
  }

  /**
   * POST `/sessions/:sessionId/turns/:turnId/cancel`（ADR-0008 §D3）。
   * Fire-and-forget 语义在业务层 `AssistantStore.cancel` 处理；本方法仍如实返回 HTTP 结果。
   * Idempotent — engine 端 turn 非 RUNNING 时返回 404 RESOURCE_NOT_FOUND_SESSION。
   */
  async cancelTurn(sessionId: string, turnId: string): Promise<void> {
    await this.client.requestJson<unknown>({
      method: "POST",
      path: `/sessions/${sessionId}/turns/${turnId}/cancel`,
    });
  }

  /**
   * GET `/sessions/:sessionId/events[?turnId={turnId}]`。
   *
   * AsyncIterable 形态 — 业务侧 `for await (const ev of streamEvents(...)) { ... }`。
   *
   * - `turnId` 缺省：session-scope（v1 兼容），回放并广播整条 session 的事件。
   * - `turnId` 提供：per-turn（ADR-0008 §D5.1.v2），engine 仅回放 + fan-out 本 turn
   *   的事件；turn 终态后 server 自然 close。
   * - 非 2xx 响应：在第一次 yield 之前抛 `AgenticClientError`（含 `SessionBusyError` 等子类型）。
   * - reader 在 server `done` 之前出错：抛 `StreamDisconnectedError`。
   * - 业务 `signal.abort()`：generator 自然终止（不抛错）。
   *
   * 首版**不**自动重连（ADR-0008 §D1 TODO）。
   */
  async *streamEvents(
    sessionId: string,
    opts: { turnId?: string; lastEventId?: string; signal?: AbortSignal } = {},
  ): AsyncIterable<SseEvent> {
    const baseUrl = `${this.config.baseUrl}/sessions/${sessionId}/events`;
    const url = opts.turnId !== undefined && opts.turnId !== "" ? `${baseUrl}?turnId=${encodeURIComponent(opts.turnId)}` : baseUrl;
    const extra: Record<string, string> = {
      accept: "text/event-stream",
    };
    if (opts.lastEventId) extra["last-event-id"] = opts.lastEventId;

    const headers = await this.client.buildRequestHeaders(extra);

    let resp: Response;
    try {
      const init: RequestInit = { method: "GET", headers };
      if (opts.signal) init.signal = opts.signal;
      resp = await this.fetchImpl(url, init);
    } catch (e) {
      if (opts.signal?.aborted) return;
      throw new StreamDisconnectedError(e instanceof Error ? e.message : String(e), e instanceof Error ? e : undefined);
    }

    if (!resp.ok) {
      throw await AgenticClientError.fromResponse(resp);
    }
    if (!resp.body) return;

    const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
    const onAbort = (): void => {
      // 主动 cancel reader — 让阻塞的 read() 立刻以 done 或 reject 返回
      void reader.cancel().catch(() => {
        /* swallow */
      });
    };
    opts.signal?.addEventListener("abort", onAbort);

    let buffer = "";
    let currentId: string | undefined;
    let dataLines: string[] = [];

    try {
      if (opts.signal?.aborted) return;
      for (;;) {
        let chunk: { done: false; value: string } | { done: true; value?: undefined };
        try {
          chunk = (await reader.read()) as typeof chunk;
        } catch (e) {
          if (opts.signal?.aborted) return;
          throw new StreamDisconnectedError(e instanceof Error ? e.message : String(e), e instanceof Error ? e : undefined);
        }
        if (chunk.done) return;
        if (opts.signal?.aborted) return;
        buffer += chunk.value ?? "";
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          if (opts.signal?.aborted) return;
          const raw = buffer.slice(0, idx).replace(/\r$/, "");
          buffer = buffer.slice(idx + 1);
          if (raw.length === 0) {
            if (dataLines.length > 0) {
              const rawData = dataLines.join("\n");
              dataLines = [];
              const id = currentId;
              currentId = undefined;
              try {
                const parsed = JSON.parse(rawData);
                const result = SseEventSchema.safeParse(parsed);
                if (result.success) {
                  // Last-Event-ID 累计由 caller 持有（ADR-0008 §D5.1 / Q6 A1）；
                  // SDK 不藏状态。`id` 仅供 caller 透传。
                  void id;
                  yield result.data;
                }
                // unknown schema soft-skip
              } catch {
                // malformed JSON → skip
              }
            }
            continue;
          }
          if (raw.startsWith(":")) continue;
          const colon = raw.indexOf(":");
          if (colon === -1) continue;
          const field = raw.slice(0, colon).trim();
          const val = raw.slice(colon + 1).replace(/^ /, "");
          switch (field) {
            case "id":
              currentId = val;
              break;
            case "event":
              /* preserved for future use */ break;
            case "data":
              dataLines.push(val);
              break;
            default:
              break;
          }
        }
      }
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
      try {
        await reader.cancel();
      } catch {
        /* swallow */
      }
    }
  }
}

// keep import side-effect to prevent tree-shaking of HEADER_IDEMPOTENCY_KEY in
// downstream typecheck (it's used historically; reserved for future explicit references)
void HEADER_IDEMPOTENCY_KEY;
