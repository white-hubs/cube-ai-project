import 'reflect-metadata';
import {
  Controller,
  POST,
  GET,
  PATCH,
  DELETE,
  Context,
  contextStore,
} from '@dangao/bun-server';
import { z } from 'zod';
import {
  CreateSessionRequestSchema,
  ImageAttachmentSchema,
  MessageContentV1Schema,
  RuntimeRefsSchema,
  UpdateSessionRequestSchema,
  SfidSchema,
} from '@cube-ai/contracts';
import type { DualSubject } from '@cube-ai/contracts';
import {
  createSessionSseStreamResponse,
  parseLastEventIdHeader,
  DrainService,
  SessionSseEmitter,
} from '@cube-ai/bun-server-ext-sse';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { SessionService } from './session.service';
import { TurnService } from './turn.service';

const ListSessionsQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'CLOSED', 'ARCHIVED', 'ALL']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const SendMessageBodySchema = z.object({
  content: MessageContentV1Schema.optional(),
  attachments: z.array(ImageAttachmentSchema).max(4).default([]),
  prompt: z.string().optional(),
  modelCode: z.string().optional(),
  /** Per-turn embedding model (ADR-0008); env `AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL` when omitted. */
  skillEmbeddingModelCode: z.string().max(128).optional(),
  providerCode: z.string().optional(),
  providerId: z.string().optional(),
  runtimeRefs: RuntimeRefsSchema.optional(),
});

const ListSessionMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function requireCtx(): Context {
  const ctx = contextStore.getStore();
  if (!ctx) {
    throw AgenticEngineError.fromCode(
      'INTERNAL_UNKNOWN',
      'Request Context missing — ensure ContextStore middleware is active',
      {},
    );
  }
  return ctx;
}

function readSubject(ctx: Context): DualSubject {
  const subj = (ctx as unknown as { state?: { subject?: DualSubject } }).state?.subject;
  if (!subj?.user?.userId) {
    throw AgenticEngineError.fromCode('UNAUTHENTICATED_TOKEN_INVALID', 'Authentication required', {});
  }
  return subj;
}

function extractPromptFromBlocks(blocks: unknown[]): string {
  const texts = blocks
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const rec = block as Record<string, unknown>;
      return rec.type === 'text' && typeof rec.text === 'string' ? rec.text.trim() : '';
    })
    .filter((t) => t.length > 0);
  return texts.join('\n').trim();
}

function countImageRefs(blocks: unknown[]): number {
  return blocks.reduce<number>((count, block) => {
    if (!block || typeof block !== 'object') return count;
    return (block as Record<string, unknown>).type === 'image_ref' ? count + 1 : count;
  }, 0);
}

function validateImageAttachments(
  blocks: unknown[],
  attachments: Array<{ attachmentId: string }>,
): { ok: true } | { ok: false; message: string } {
  const attachmentIds = new Set(attachments.map((attachment) => attachment.attachmentId));
  const referenced = new Set<string>();
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const rec = block as Record<string, unknown>;
    if (rec.type !== 'image_ref') continue;
    const attachmentId = typeof rec.attachmentId === 'string' ? rec.attachmentId : '';
    if (!attachmentIds.has(attachmentId)) {
      return { ok: false, message: `image_ref attachmentId "${attachmentId}" must match an attachment` };
    }
    referenced.add(attachmentId);
  }
  for (const attachment of attachments) {
    if (!referenced.has(attachment.attachmentId)) {
      return {
        ok: false,
        message: `attachment "${attachment.attachmentId}" must be referenced by an image_ref block`,
      };
    }
  }
  return { ok: true };
}

/** 从 pathname 取 19 位 SFID；单测的 mock Context 可能无 `path`，回退到 `getParam` */
function readSessionIdPathParam(ctx: Context): string {
  const pathStr = ctx.path;
  if (pathStr) {
    const m = pathStr.match(/\/sessions\/(\d{19})(?:\/|$)/);
    if (m?.[1]) return m[1];
  }
  return ctx.getParam('sessionId') ?? '';
}

/** 从 pathname 取 turnId（19 位 SFID）；与 readSessionIdPathParam 一致的回退策略 */
function readTurnIdPathParam(ctx: Context): string {
  const pathStr = ctx.path;
  if (pathStr) {
    const m = pathStr.match(/\/turns\/(\d{19})(?:\/|$)/);
    if (m?.[1]) return m[1];
  }
  return ctx.getParam('turnId') ?? '';
}

/**
 * SessionController — HTTP entry points for Session BC.
 *
 * 路由方法不使用 `@Param` / `@Body` 参数装饰器（Bun 编译链路对参数装饰器的支持不稳定）。
 * 路径参数与 body 从 `Context` 读取（framework 在路由匹配后填充 `params` / `getBody()`）。
 *
 * ref: docs/detailed-design/01-api/session.md §S1–S5
 *      docs/detailed-design/03-core-adapters/concurrency-and-replay.md §3.4
 */
@Controller('/sessions')
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly turnService: TurnService,
    private readonly sseEmitter: SessionSseEmitter,
    private readonly drainService: DrainService,
  ) {}

  /** S2 — GET /sessions */
  @GET('/')
  listSessions(): Promise<{ items: unknown[]; page: { nextCursor?: string; hasMore: boolean } }> {
    const ctx = requireCtx();
    const raw = Object.fromEntries(ctx.query.entries()) as Record<string, string>;
    const query = ListSessionsQuerySchema.parse(raw);
    const subject = readSubject(ctx);

    let statuses: ('ACTIVE' | 'CLOSED' | 'ARCHIVED')[] | undefined;
    if (query.status === 'ALL') {
      statuses = ['ACTIVE', 'CLOSED', 'ARCHIVED'];
    } else if (
      query.status === 'ACTIVE' ||
      query.status === 'CLOSED' ||
      query.status === 'ARCHIVED'
    ) {
      statuses = [query.status];
    }

    return this.sessionService
      .listSessions({
        tenant: subject.tenant,
        userId: subject.user.userId,
        cursor: query.cursor,
        limit: query.limit,
        statuses,
      })
      .then(mapList);
  }

  /** S1 — POST /sessions */
  @POST('/')
  async create(): Promise<unknown> {
    const ctx = requireCtx();
    const body = await ctx.getBody();

    const parsed = CreateSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'Request body validation failed',
        { issues: parsed.error.issues },
      );
    }

    if (
      parsed.data &&
      typeof parsed.data === 'object' &&
      parsed.data !== null &&
      'tenant' in parsed.data
    ) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'Request body must not contain tenant',
        {},
      );
    }

    const subject = readSubject(ctx);
    const session = await this.sessionService.createSession(
      subject.tenant,
      subject.user.userId,
      subject.user.displayName,
      parsed.data,
    );

    ctx.setStatus(201);
    return session;
  }

  /**
   * SSE — GET /sessions/:sessionId/events?turnId={turnId}
   *
   * SSE stream of turn events with Last-Event-ID replay support (P3-06)
   * + per-turn 过滤（ADR-0022 §D5.1.v2）：
   *   - 缺省（不传 `?turnId=`）→ session-scope；replay 整条 session 缓冲。v1 兼容。
   *   - `?turnId=<19位 SFID>`     → per-turn；只回放 + fan-out 本 turn 的事件。
   *
   * ref: concurrency-and-replay.md §3.4
   */
  @GET('/:sessionId/events')
  async streamEvents(): Promise<Response> {
    const ctx = requireCtx();
    const sessionId = readSessionIdPathParam(ctx);
    const subject = readSubject(ctx);

    const lastHeaderRaw =
      ctx.headers.get('last-event-id') ?? ctx.headers.get('Last-Event-ID') ?? undefined;
    const last = parseLastEventIdHeader(lastHeaderRaw);

    const turnIdRaw = ctx.query.get('turnId') ?? undefined;
    let turnId: string | undefined;
    if (turnIdRaw !== undefined && turnIdRaw !== '') {
      if (!SfidSchema.safeParse(turnIdRaw).success) {
        throw AgenticEngineError.fromCode(
          'INVALID_ARGUMENT_TURN_ID',
          'turnId must be a 19-digit SFID string',
          { turnId: turnIdRaw },
        );
      }
      turnId = turnIdRaw;
    }

    const signal =
      (ctx as unknown as { signal?: AbortSignal }).signal ?? new AbortController().signal;

    return createSessionSseStreamResponse({
      scope: { tenant: subject.tenant, sessionId },
      lastEventId: last,
      emitter: this.sseEmitter,
      drainService: this.drainService,
      signal,
      ...(turnId !== undefined ? { turnId } : {}),
    });
  }

  /** M2 — GET /sessions/:sessionId/messages（历史分页；见 session.md §11） */
  @GET('/:sessionId/messages')
  async listMessages(): Promise<unknown> {
    const ctx = requireCtx();
    const sessionId = readSessionIdPathParam(ctx);
    const sidParse = SfidSchema.safeParse(sessionId);
    if (!sidParse.success) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SESSION_ID',
        'sessionId must be a 19-digit SFID string',
        { sessionId },
      );
    }
    const raw = Object.fromEntries(ctx.query.entries()) as Record<string, string>;
    const query = ListSessionMessagesQuerySchema.parse(raw);
    const subject = readSubject(ctx);
    return this.sessionService.listSessionMessages({
      tenant: subject.tenant,
      sessionId,
      userId: subject.user.userId,
      limit: query.limit,
    });
  }

  /**
   * Cancel running turn — POST /sessions/:sessionId/turns/:turnId/cancel.
   *
   * 客户端触发的「用户主动停止」入口。委派到 `TurnService.cancelTurn` 完成
   *  - tachu.Engine.cancel(sessionId) → 中断 LLM / tool 运行
   *  - DB turns.status=CANCELLED
   *  - SSE `turn-cancelled-v1` 推送
   * Idempotency：若 turn 已非 RUNNING，service 抛 `RESOURCE_NOT_FOUND_SESSION`，
   * 控制器**不**额外吞错——HTTP 客户端按错误码判断"已停"或"已完成"。
   * 仅在路径 SFID 形态非法时本层拦截 (`INVALID_ARGUMENT_TURN_ID` /
   * `INVALID_ARGUMENT_SESSION_ID`)。
   *
   * ref: ADR-0022 §D3
   */
  @POST('/:sessionId/turns/:turnId/cancel')
  async cancelTurn(): Promise<void> {
    const ctx = requireCtx();
    const sessionId = readSessionIdPathParam(ctx);
    const turnId = readTurnIdPathParam(ctx);
    if (!SfidSchema.safeParse(sessionId).success) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SESSION_ID',
        'sessionId must be a 19-digit SFID string',
        { sessionId },
      );
    }
    if (!SfidSchema.safeParse(turnId).success) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_TURN_ID',
        'turnId must be a 19-digit SFID string',
        { turnId },
      );
    }
    const subject = readSubject(ctx);
    await this.turnService.cancelTurn(turnId, subject.tenant, 'USER_REQUEST');
    ctx.setStatus(204);
  }

  /** M1 — Turn（TurnService 由 P3-05 实装） */
  @POST('/:sessionId/messages')
  async startTurn(): Promise<{ turnId: string }> {
    const ctx = requireCtx();
    const sessionId = readSessionIdPathParam(ctx);
    const rawBody = await ctx.getBody();
    const parsed = SendMessageBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'messages body validation failed',
        { issues: parsed.error.issues },
      );
    }
    const attachments = parsed.data.attachments ?? [];
    const blocksPrompt = parsed.data.content?.blocks ? extractPromptFromBlocks(parsed.data.content.blocks) : '';
    const imageRefCount = parsed.data.content?.blocks ? countImageRefs(parsed.data.content.blocks) : 0;
    if (imageRefCount > 4) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'A single message can reference at most 4 images',
        {},
      );
    }
    if (parsed.data.content?.blocks) {
      const imageValidation = validateImageAttachments(parsed.data.content.blocks, attachments);
      if (!imageValidation.ok) {
        throw AgenticEngineError.fromCode(
          'INVALID_ARGUMENT_SCHEMA_VIOLATION',
          imageValidation.message,
          {},
        );
      }
    }
    const legacyPrompt = parsed.data.prompt?.trim() ?? '';
    let prompt = parsed.data.content ? blocksPrompt : legacyPrompt;
    const IMAGE_ONLY_DEFAULT_PROMPT = '请根据用户上传的图片内容回答。';
    if (prompt === '' && imageRefCount > 0) {
      prompt = IMAGE_ONLY_DEFAULT_PROMPT;
    }
    if (!parsed.data.content && !legacyPrompt) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'Either content.blocks text or prompt must be provided',
        {},
      );
    }
    let content =
      parsed.data.content ??
      ({
        schema: 'message-content-v1',
        blocks: [{ type: 'text', text: legacyPrompt }],
      } as const);
    if (parsed.data.content && blocksPrompt === '' && imageRefCount > 0) {
      content = {
        schema: 'message-content-v1',
        blocks: [{ type: 'text', text: prompt }, ...parsed.data.content.blocks],
      };
    }
    const subject = readSubject(ctx);
    const turnId = await this.turnService.startTurn(sessionId, subject.tenant, prompt, {
      content,
      attachments,
      modelCode: parsed.data.modelCode,
      skillEmbeddingModelCode: parsed.data.skillEmbeddingModelCode,
      providerCode: parsed.data.providerCode,
      providerId: parsed.data.providerId,
      userId: subject.user.userId,
      scopes: subject.user.scopes,
      ...(parsed.data.runtimeRefs !== undefined ? { runtimeRefs: parsed.data.runtimeRefs } : {}),
    });
    return { turnId };
  }

  /** S3 — GET /sessions/:sessionId */
  @GET('/:sessionId')
  async getById(): Promise<unknown> {
    const ctx = requireCtx();
    const sessionId = readSessionIdPathParam(ctx);

    const sidParse = SfidSchema.safeParse(sessionId);
    if (!sidParse.success) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SESSION_ID',
        'sessionId must be a 19-digit SFID string',
        { sessionId },
      );
    }

    const subject = readSubject(ctx);
    const session = await this.sessionService.getSession(sessionId, subject.tenant);
    if (!session) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_SESSION',
        `Session ${sessionId} not found`,
        { sessionId },
      );
    }
    return session;
  }

  /** S4 — PATCH /sessions/:sessionId */
  @PATCH('/:sessionId')
  async update(): Promise<{ ok: true }> {
    const ctx = requireCtx();
    const sessionId = readSessionIdPathParam(ctx);

    const sidParse = SfidSchema.safeParse(sessionId);
    if (!sidParse.success) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SESSION_ID',
        'sessionId must be a 19-digit SFID string',
        { sessionId },
      );
    }

    const body = await ctx.getBody();
    const parsed = UpdateSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'PATCH body validation failed',
        { issues: parsed.error.issues },
      );
    }

    const subject = readSubject(ctx);

    await this.sessionService.patchSession(subject.tenant, sessionId, subject.user.userId, {
      title: parsed.data.title,
      status: parsed.data.status,
    });

    return { ok: true };
  }

  /** S5 — DELETE /sessions/:sessionId */
  @DELETE('/:sessionId')
  async remove(): Promise<void> {
    const ctx = requireCtx();
    const sessionId = readSessionIdPathParam(ctx);

    const sidParse = SfidSchema.safeParse(sessionId);
    if (!sidParse.success) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SESSION_ID',
        'sessionId must be a 19-digit SFID string',
        { sessionId },
      );
    }

    const subject = readSubject(ctx);
    await this.sessionService.deleteSession(subject.tenant, sessionId, subject.user.userId);
    ctx.setStatus(204);
  }
}

function mapList(result: {
  items: unknown[];
  nextCursor?: string;
  hasMore: boolean;
}): { items: unknown[]; page: { nextCursor?: string; hasMore: boolean } } {
  return {
    items: result.items,
    page: { nextCursor: result.nextCursor, hasMore: result.hasMore },
  };
}
