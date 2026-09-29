import { Inject, Injectable } from "@dangao/bun-server";
import type { EngineOutput } from "@tachu/core";
import type Redis from "ioredis";
import type pino from "pino";

import { OUTBOX_WRITER_TOKEN, type OutboxWriter, type TransactionContext } from "@cube-ai/bun-server-ext-outbox";
import { SessionSseEmitter } from "@cube-ai/bun-server-ext-sse";
import {
  EffectiveRouteResolvedEventSchema,
  TurnCancelledEventSchema,
  TurnCompletedEventSchema,
  TurnStartedEventSchema,
  TurnFailedEventSchema,
  IntentRoutingEventSchema,
  type BusinessQueryClarificationChoice,
  type ImageAttachment,
  type MessageContentV1,
} from "@cube-ai/contracts";
import type { RuntimeRefs } from "@cube-ai/contracts";

import { AgenticEngineError } from "../../infra/errors/agentic-error";
import { LoggerFactory } from "../../infra/observability/logger.factory";
import { debugBodyField } from "../../infra/observability/turn-debug-log";
import { SfidService } from "../../infra/sfid/sfid.service";
import { LocalFileService } from "../files/local-file.service";
import { JobDataService } from "../jobs/job-data.service";
import { EngineFactory, type AgentSnapshotShape } from "../tachu/engine-factory";
import { computeIntentToolRouting, type IntentRoutingBlock } from "../tool-activation";
import type { CallIdentity } from "../tools/tool-context";
import { isBusinessDataTool } from "../tools/tool-result-visibility";
import { guardFinalAnswerEngineOutput } from "./final-answer-visibility-guard";
import type { SessionRepository } from "./repository/session.repository";
import { SESSION_ADMIN_SCOPE } from "./session-owner";
import { REDIS_CLIENT_TOKEN, SESSION_REPO_TOKEN, TURN_LOCK_SERVICE_TOKEN, TURN_REPO_TOKEN } from "./session.tokens";
import { extractUserVisibleAnswerText } from "./tachu-sse-mapper";
import { createTachuSseMapperState, forceCloseActiveReasoning, mapStreamChunkToSseEvents } from "./tachu-sse-mapper";
import { TurnLockService } from "./turn-lock.service";
import { TurnRepository } from "./turn.repository";

const DEFAULT_LOCK_TTL_SEC = 30;
const IDEMPOTENCY_TTL_SEC = 86_400;

/** 将 tachu `EngineOutput.content` 规范为 `messages.content_json` blocks 数组（与 worker finalizeSuccess 一致）。 */
function engineOutputToPersistedContent(output: EngineOutput): unknown {
  const raw = output.content;
  if (typeof raw === "string") {
    return [{ type: "text", text: raw }];
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw != null && typeof raw === "object") {
    return [raw];
  }
  return [{ type: "text", text: "" }];
}

/** 供 pino 结构化输出。 */
function serializeUnknownError(e: unknown): Record<string, unknown> {
  if (e instanceof AgenticEngineError) {
    return {
      name: e.name,
      code: e.code,
      message: e.message,
      httpStatus: e.httpStatus,
      category: e.category,
      details: e.details,
      stack: e.stack,
    };
  }
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return { name: "NonError", message: String(e) };
}

export type TurnCancelReason = "USER_REQUEST" | "CLIENT_DISCONNECT" | "TIMEOUT" | "ADMINISTRATIVE";

export interface StartTurnOptions {
  idempotencyKey?: string;
  modelCode?: string;
  /** Per-turn embedding model override (ADR-0008); falls back to env when omitted. */
  skillEmbeddingModelCode?: string;
  providerCode?: string;
  providerId?: string;
  userId?: string;
  scopes?: readonly string[];
  runtimeRefs?: RuntimeRefs;
  clarificationChoice?: BusinessQueryClarificationChoice;
  content?: MessageContentV1;
  attachments?: ImageAttachment[];
  /**
   * 调用方用户原始身份（出站 MCP 身份透传）；由控制器在请求上下文尚存时捕获后传入。
   * turn 的 LLM 阶段 fire-and-forget、脱离原请求 ALS，故必须在此显式携带（不可事后懒读）。
   */
  callIdentity?: CallIdentity;
}

/**
 * Turn lifecycle: lock → persist → SSE → async LLM → release.
 *
 * SSE 路径：所有面向客户端的事件统一通过 `SessionSseEmitter.emit()` 发送
 *   （内部 = replay buffer append + broadcast to live subscribers）。
 *
 * ref: lifecycle.md §3 · concurrency-and-replay.md §2 · P1-06 §3.7 · P3-06
 */
@Injectable()
export class TurnService {
  private readonly log: pino.Logger;

  constructor(
    @Inject(SfidService) private readonly sfid: SfidService,
    private readonly sseEmitter: SessionSseEmitter,
    @Inject(TURN_LOCK_SERVICE_TOKEN) private readonly turnLock: TurnLockService,
    @Inject(TURN_REPO_TOKEN) private readonly turns: TurnRepository,
    @Inject(SESSION_REPO_TOKEN) private readonly sessions: SessionRepository,
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis | null,
    private readonly jobData: JobDataService,
    private readonly localFiles: LocalFileService,
    private readonly tachuEngine: EngineFactory,
    @Inject(OUTBOX_WRITER_TOKEN) private readonly outbox: OutboxWriter,
    private readonly loggerFactory: LoggerFactory,
  ) {
    this.log = this.loggerFactory.getLogger("agentic.engine.session.turn");
  }

  private idemKey(tenant: number, key: string): string {
    return `agentic:engine:session:idempotency:${tenant}:${key}`;
  }

  /**
   * Start Turn: acquire lock → optional idempotent replay → INSERT RUNNING → SSE → background LLM.
   */
  async startTurn(sessionId: string, tenant: number, prompt: string, options: StartTurnOptions = {}): Promise<string> {
    // P3 — turn-start 归属门禁：只有 session 归属者（或本租户 admin）能驱动该 session。
    // 与现有读路径 authz 语义对齐；非归属 / 未落库直接拒，绝不取锁、绝不插 turn。
    // 这是「串消息」隔离的门禁面之一（配合全局唯一 sessionId），不再依赖脆弱的 ctx 透传。
    const admin = options.scopes?.includes(SESSION_ADMIN_SCOPE) ?? false;
    const owned = await this.sessions.findByIdAsOwner(tenant, sessionId, options.userId ?? "", { admin });
    if (!owned) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_SESSION", `Session ${sessionId} not found`, { sessionId });
    }

    const startTurnAt = Date.now();
    const turnId = this.sfid.next();

    // 同步段各跳耗时（lock / DB 事务），随 turn.started 一并落日志，便于对比线上-本地。
    let lockMs = 0;
    let dbPersistMs = 0;

    let lockHeld = false;
    const lockAt = Date.now();
    try {
      lockHeld = await this.turnLock.tryAcquire(sessionId, turnId, DEFAULT_LOCK_TTL_SEC);
    } catch (e: unknown) {
      if (e instanceof AgenticEngineError && e.httpStatus === 503) throw e;
      throw new AgenticEngineError(503, "UNAVAILABLE_LOCK_SERVICE", `Turn lock unavailable: ${String(e)}`, { sessionId });
    }
    lockMs = Date.now() - lockAt;

    if (!lockHeld) {
      throw AgenticEngineError.fromCode("RESOURCE_CONFLICT_SESSION_BUSY", `Session ${sessionId} already has a running turn`, { sessionId });
    }

    const idem = options.idempotencyKey?.trim();
    if (idem && this.redis) {
      try {
        const hit = await this.redis.get(this.idemKey(tenant, idem));
        if (hit) {
          const parsed = JSON.parse(hit) as { turnId?: string };
          if (parsed.turnId) {
            await this.turnLock.release(sessionId, turnId);
            return parsed.turnId;
          }
        }
      } catch {
        await this.turnLock.release(sessionId, turnId);
        throw new AgenticEngineError(503, "UNAVAILABLE_LOCK_SERVICE", "Redis idempotency check failed", { sessionId });
      }
    }

    try {
      this.turns.requirePool();
    } catch {
      await this.turnLock.release(sessionId, turnId);
      throw new AgenticEngineError(503, "UNAVAILABLE_DATABASE", "MySQL not configured (AGENTIC_ENGINE_MYSQL_URL)", { sessionId });
    }

    const userMessageId = this.sfid.next();
    const userContent = options.content ?? {
      schema: "message-content-v1",
      blocks: [{ type: "text", text: prompt }],
    };
    const attachments = options.attachments ?? [];

    let turnNo = 1;
    const persistAt = Date.now();
    try {
      turnNo = await this.turns.insertRunningTurn({
        turnId,
        tenant,
        sessionId,
        idempotencyKey: idem ?? null,
        inputEnvelope: {
          schema: "input-envelope-v1",
          text: prompt,
          content: userContent,
          attachments,
          sessionId,
          turnId,
          ...(options.runtimeRefs !== undefined ? { runtimeRefs: options.runtimeRefs } : {}),
          ...(options.clarificationChoice !== undefined ? { clarificationChoice: options.clarificationChoice } : {}),
        },
        userMessageId,
        userPromptText: prompt,
        userContentJson: userContent.blocks,
        attachmentsJson: attachments,
      });
      if (attachments.length > 0) {
        await this.localFiles.bindAttachmentsToMessage({
          tenant,
          sessionId,
          messageId: userMessageId,
          attachments,
        });
      }
    } catch (e: unknown) {
      await this.turnLock.release(sessionId, turnId);
      throw e;
    }
    dbPersistMs = Date.now() - persistAt;
    const started = TurnStartedEventSchema.parse({
      schema: "turn-started-v1",
      turnId,
      turnNo,
      startTime: Date.now(),
      userMessageId,
    });

    await this.sseEmitter.emit({ tenant, sessionId }, turnId, {
      sseEvent: "turn.started",
      payload: started,
    });

    this.log.debug(
      {
        sessionId,
        tenant,
        turnId,
        turnNo,
        lockMs,
        dbPersistMs,
        syncTotalMs: Date.now() - startTurnAt,
        modelCode: options.modelCode ?? null,
        skillEmbeddingModelCode: options.skillEmbeddingModelCode ?? process.env["AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL"] ?? null,
        idempotencyKey: idem ?? null,
        promptCharCount: prompt.length,
        ...debugBodyField("promptBody", prompt),
      },
      "turn.started",
    );

    if (idem && this.redis) {
      await this.redis.set(this.idemKey(tenant, idem), JSON.stringify({ turnId }), "EX", IDEMPOTENCY_TTL_SEC);
    }

    void this.runLlmPhase({
      sessionId,
      tenant,
      turnId,
      prompt,
      content: userContent,
      attachments,
      modelCode: options.modelCode?.trim() || undefined,
      skillEmbeddingModelCode: options.skillEmbeddingModelCode?.trim() || undefined,
      providerCode: options.providerCode?.trim() || undefined,
      providerId: options.providerId?.trim() || undefined,
      userId: options.userId,
      scopes: options.scopes,
      ...(options.callIdentity !== undefined ? { callIdentity: options.callIdentity } : {}),
      ...(options.runtimeRefs !== undefined ? { runtimeRefs: options.runtimeRefs } : {}),
      ...(options.clarificationChoice !== undefined ? { clarificationChoice: options.clarificationChoice } : {}),
    }).catch((err: unknown) => {
      this.log.error(
        {
          sessionId,
          tenant,
          turnId,
          err: serializeUnknownError(err),
        },
        "turn.llm.phase.unhandledRejection",
      );
    });

    return turnId;
  }

  /**
   * 跑一轮 LLM —— tachu.Engine.runStream 的会话桥。
   *
   * 关键合约（与 mapper + EngineFactory 配合）：
   *   - 加载本会话冻结的 agent snapshot（含 CUBE.md 已拼好的 system prompt 与
   *     默认 model），传给 EngineFactory；turn body 的 modelCode 优先级最高。
   *   - 把 tachu StreamChunk 流逐个交给 `mapStreamChunkToSseEvents` 翻译成 SSE
   *     事件并 forward 到 SseEmitter；不再造任何 SSE 事件，唯一权威 = mapper。
   *   - `done` chunk 携带 `EngineOutput`，本方法读出 `metadata.tokenUsage` 用于
   *     DB 写完成 + outbox 发账单事件。
   *   - 错误路径分两层：
   *       a) tachu 在 9 阶段流水线内捕获到错误 → 以 `error` chunk 形态流出，mapper
   *          已发 turn.failed SSE；本方法把状态落 DB，**不再重复 emit**。
   *       b) tachu 自身异常 throw（例如 dispose 后调用） → 走 catch 分支，手工
   *          emit turn.failed。
   */
  private async runLlmPhase(arg: {
    sessionId: string;
    tenant: number;
    turnId: string;
    prompt: string;
    content?: MessageContentV1;
    attachments?: ImageAttachment[];
    modelCode?: string;
    skillEmbeddingModelCode?: string;
    providerCode?: string;
    providerId?: string;
    userId?: string;
    scopes?: readonly string[];
    callIdentity?: CallIdentity;
    runtimeRefs?: RuntimeRefs;
    clarificationChoice?: BusinessQueryClarificationChoice;
  }): Promise<void> {
    const assistantMessageId = this.sfid.next();
    const startTime = Date.now();
    const mapperState = createTachuSseMapperState({
      turnId: arg.turnId,
      messageId: assistantMessageId,
      startTime,
      // reasoning-step-v1 的 stepId 走与 turnId/messageId 同体系的
      // SFID，便于前端 Map<stepId, ReasoningStep> 索引与日志查询。
      nextSfid: () => this.sfid.next(),
    });

    // 读取会话冻结的 agent snapshot。读不到不致命：tachu 会用默认 system prompt
    // 与 EngineFactory 的回退 model。
    const snapshotLoadAt = Date.now();
    const agentSnapshot = await this.loadAgentSnapshot(arg.sessionId, arg.tenant);
    const snapshotLoadMs = Date.now() - snapshotLoadAt;
    const routeResolveAt = Date.now();
    const route = await this.tachuEngine.resolveEffectiveRoute({
      prompt: arg.prompt,
      content: arg.content,
      turnModelCode: arg.modelCode,
      ...(agentSnapshot !== null ? { agentSnapshot } : {}),
    });
    const routeResolveMs = Date.now() - routeResolveAt;
    const resolvedModel = route.effectiveModelCode;

    const acContent = agentSnapshot?.agent?.content as { toolRefs?: unknown; intentRouting?: unknown } | undefined;
    const toolRefs = Array.isArray(acContent?.toolRefs)
      ? acContent.toolRefs.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    const routing = computeIntentToolRouting({
      prompt: arg.prompt,
      toolRefs,
      intentBlock: (acContent?.intentRouting ?? null) as IntentRoutingBlock | null,
    });

    if (process.env["AGENTIC_INTENT_ROUTING_SSE"] !== "0") {
      const irPayload = IntentRoutingEventSchema.parse({
        schema: "intent-routing-v1",
        turnId: arg.turnId,
        state: routing.state,
        ...(routing.multiMatch ? { multiMatch: true } : {}),
      });
      await this.sseEmitter.emit({ tenant: arg.tenant, sessionId: arg.sessionId }, arg.turnId, {
        sseEvent: "intent.routing",
        payload: irPayload as unknown as Record<string, unknown>,
      });
    }

    this.log.debug(
      {
        sessionId: arg.sessionId,
        tenant: arg.tenant,
        turnId: arg.turnId,
        traceId: arg.turnId,
        resolvedModel,
        snapshotLoadMs,
        routeResolveMs,
        requestedModelCode: route.requestedModelCode,
        routeReason: route.reason,
        hasSnapshot: agentSnapshot !== null,
        hasUserId: Boolean(arg.userId),
        promptCharCount: arg.prompt.length,
        ...debugBodyField("promptBody", arg.prompt),
        ...debugBodyField("intentRoutingBody", routing),
      },
      "turn.llm.phase.start",
    );

    const routeResolved = EffectiveRouteResolvedEventSchema.parse({
      schema: "effective-route-resolved-v1",
      turnId: arg.turnId,
      requested: {
        ...(arg.modelCode !== undefined ? { modelCode: arg.modelCode } : {}),
        ...(arg.providerCode !== undefined ? { providerCode: arg.providerCode } : {}),
        ...(arg.providerId !== undefined ? { providerId: arg.providerId } : {}),
      },
      effective: {
        modelCode: route.effectiveModelCode,
        providerCode: route.effectiveProviderCode,
        ...(arg.providerId !== undefined ? { providerId: arg.providerId } : {}),
      },
      reason: route.reason,
    });
    await this.sseEmitter.emit({ tenant: arg.tenant, sessionId: arg.sessionId }, arg.turnId, {
      sseEvent: "turn.route.resolved",
      payload: routeResolved as unknown as Record<string, unknown>,
    });

    let finalOutput: EngineOutput | undefined;
    let errorEmittedByMapper = false;
    let errorPayload: { code: string; message: string; retryable: boolean } | undefined;
    let sensitiveBusinessDataToolUsed = false;
    // 首个引擎事件的到达时刻（相对 phase.start）：把 host 预取 + tachu 的
    // 会话/安全/工具路由/技能激活(embedding) 等「首字前」开销收成一个可测数。
    let firstEngineChunkLogged = false;

    try {
      for await (const chunk of this.tachuEngine.runStream({
        sessionId: arg.sessionId,
        turnId: arg.turnId,
        tenant: arg.tenant,
        ...(arg.userId !== undefined ? { userId: arg.userId } : {}),
        ...(arg.scopes !== undefined ? { scopes: arg.scopes } : {}),
        ...(arg.callIdentity !== undefined ? { callIdentity: arg.callIdentity } : {}),
        prompt: arg.prompt,
        ...(arg.content !== undefined ? { content: arg.content } : {}),
        ...(arg.attachments !== undefined ? { attachments: arg.attachments } : {}),
        ...(arg.runtimeRefs !== undefined ? { runtimeRefs: arg.runtimeRefs } : {}),
        ...(arg.clarificationChoice !== undefined ? { clarificationChoice: arg.clarificationChoice } : {}),
        ...(resolvedModel !== undefined ? { turnModelCode: resolvedModel } : {}),
        ...(arg.skillEmbeddingModelCode !== undefined ? { skillEmbeddingModelCode: arg.skillEmbeddingModelCode } : {}),
        ...(agentSnapshot !== null ? { agentSnapshot } : {}),
        nextStreamId: () => this.sfid.next(),
      })) {
        if (!firstEngineChunkLogged) {
          firstEngineChunkLogged = true;
          this.log.debug(
            {
              sessionId: arg.sessionId,
              tenant: arg.tenant,
              turnId: arg.turnId,
              traceId: arg.turnId,
              // startTime = phase.start 基准；此值 ≈ 首字前的全部准备开销。
              sincePhaseStartMs: Date.now() - startTime,
              firstChunkType: chunk.type,
            },
            "turn.llm.phase.firstEngineChunk",
          );
        }
        let chunkForSse = chunk;
        if (chunk.type === "tool-call-end" && isBusinessDataTool(chunk.tool)) {
          sensitiveBusinessDataToolUsed = true;
        }
        if (chunk.type === "done") {
          const guarded = guardFinalAnswerEngineOutput(chunk.output, { sensitiveToolUsed: sensitiveBusinessDataToolUsed });
          if (guarded.blocked) {
            this.log.warn(
              {
                sessionId: arg.sessionId,
                tenant: arg.tenant,
                turnId: arg.turnId,
                traceId: arg.turnId,
                reasons: guarded.reasons,
              },
              "turn.llm.phase.finalAnswerVisibilityGuard.blocked",
            );
          }
          chunkForSse = { ...chunk, output: guarded.output } as typeof chunk;
        }
        // 1. 翻译并 forward
        const sseEvents = mapStreamChunkToSseEvents(mapperState, chunkForSse);
        for (const ev of sseEvents) {
          await this.sseEmitter.emit(
            { tenant: arg.tenant, sessionId: arg.sessionId },
            arg.turnId,
            // payload 已经是各 schema 的 z.infer 类型；SseEmitter 接受 unknown payload。
            { sseEvent: ev.sseEvent, payload: ev.payload as unknown as Record<string, unknown> },
          );
        }
        // 2. 追踪关键状态
        if (chunkForSse.type === "done") {
          finalOutput = chunkForSse.output;
        } else if (chunkForSse.type === "error") {
          errorEmittedByMapper = true;
          errorPayload = {
            code: chunkForSse.error.code,
            message: chunkForSse.error.message,
            retryable: chunkForSse.error.retryable,
          };
        }
      }
    } catch (e: unknown) {
      // 外层 throw —— tachu 自身崩溃（罕见，例如 Engine 已 dispose）。手工补发 turn.failed。
      const failCode = e instanceof AgenticEngineError ? e.code : "INTERNAL_LLM_FAILED";
      const failMessage = e instanceof AgenticEngineError ? e.message : String(e);
      this.log.error(
        {
          sessionId: arg.sessionId,
          tenant: arg.tenant,
          turnId: arg.turnId,
          resolvedModel,
          failCode,
          err: serializeUnknownError(e),
        },
        "turn.llm.phase.failed",
      );
      // runStream 抛错时强制把所有活跃 reasoning step END，
      // 让前端 reasoning 树永远闭合。在 turn.failed 之前发，保持事件先后逻辑一致。
      const closureEvents = forceCloseActiveReasoning(mapperState, {
        code: "TURN_INTERRUPTED",
        message: failMessage,
      });
      for (const ev of closureEvents) {
        await this.sseEmitter.emit({ tenant: arg.tenant, sessionId: arg.sessionId }, arg.turnId, {
          sseEvent: ev.sseEvent,
          payload: ev.payload as unknown as Record<string, unknown>,
        });
      }
      try {
        await this.turns.markTurnError({
          turnId: arg.turnId,
          tenant: arg.tenant,
          errorCode: failCode,
          message: failMessage,
        });
      } catch (dbErr: unknown) {
        this.log.warn({ err: serializeUnknownError(dbErr), turnId: arg.turnId }, "turn.llm.phase.markTurnError.failed");
      }
      const failed = TurnFailedEventSchema.parse({
        schema: "turn-failed-v1",
        turnId: arg.turnId,
        error: {
          code: failCode,
          message: failMessage,
          retryable: false,
        },
        endTime: Date.now(),
      });
      await this.sseEmitter.emit({ tenant: arg.tenant, sessionId: arg.sessionId }, arg.turnId, {
        sseEvent: "turn.failed",
        payload: failed,
      });
      await this.turnLock.release(arg.sessionId, arg.turnId);
      return;
    }

    // 流走完了 —— 三种终态：error chunk → 已 SSE，只补 DB；done → 完成；既无 error
    // 也无 done → 视为异常未完成（保护性，不应发生）。
    try {
      if (errorEmittedByMapper && errorPayload) {
        await this.turns.markTurnError({
          turnId: arg.turnId,
          tenant: arg.tenant,
          errorCode: errorPayload.code,
          message: errorPayload.message,
        });
      } else if (finalOutput) {
        const tokenUsage = {
          input: finalOutput.metadata.tokenUsage.input,
          output: finalOutput.metadata.tokenUsage.output,
          total: finalOutput.metadata.tokenUsage.total,
        };
        const seq = await this.jobData.nextMessageSeqForTurn(arg.turnId);
        await this.jobData.insertAssistantMessage({
          id: assistantMessageId,
          tenant: arg.tenant,
          sessionId: arg.sessionId,
          turnId: arg.turnId,
          seq,
          contentJson: engineOutputToPersistedContent(finalOutput),
        });
        await this.turns.completeTurn({
          turnId: arg.turnId,
          tenant: arg.tenant,
          tokenUsage,
          finalMessageId: assistantMessageId,
        });
        await this.emitUsageLlmCall({
          tenant: arg.tenant,
          sessionId: arg.sessionId,
          turnId: arg.turnId,
          model: resolvedModel,
          promptTokens: tokenUsage.input,
          completionTokens: tokenUsage.output,
          costUsd: 0,
        });
        this.log.debug(
          {
            sessionId: arg.sessionId,
            tenant: arg.tenant,
            turnId: arg.turnId,
            traceId: arg.turnId,
            resolvedModel,
            usage: tokenUsage,
            ...debugBodyField("answerBody", extractUserVisibleAnswerText(finalOutput)),
            ...debugBodyField("engineOutputBody", finalOutput),
          },
          "turn.llm.phase.completed",
        );
      } else {
        // tachu 既没 yield done 也没 yield error —— 异常通路，按 INTERNAL 失败处理。
        this.log.warn({ sessionId: arg.sessionId, turnId: arg.turnId }, "turn.llm.phase.noTerminalChunk");
        await this.turns.markTurnError({
          turnId: arg.turnId,
          tenant: arg.tenant,
          errorCode: "INTERNAL_LLM_FAILED",
          message: "engine.runStream finished without done or error",
        });
        const failed = TurnFailedEventSchema.parse({
          schema: "turn-failed-v1",
          turnId: arg.turnId,
          error: {
            code: "INTERNAL_LLM_FAILED",
            message: "engine.runStream finished without done or error",
            retryable: false,
          },
          endTime: Date.now(),
        });
        await this.sseEmitter.emit({ tenant: arg.tenant, sessionId: arg.sessionId }, arg.turnId, {
          sseEvent: "turn.failed",
          payload: failed,
        });
      }
    } finally {
      await this.turnLock.release(arg.sessionId, arg.turnId);
    }
  }

  /**
   * 把 SessionRow 里的 `agent_snapshot_json` 解析成 EngineFactory 期望的 shape。
   * 读不到 / 解析失败时返回 null，不抛错——会话功能仍可降级到默认 prompt + 默认 model。
   */
  private async loadAgentSnapshot(sessionId: string, tenant: number): Promise<AgentSnapshotShape | null> {
    try {
      const row = await this.sessions.findById(tenant, sessionId);
      if (!row) return null;
      const snap = row.agentSnapshotJson;
      if (snap && typeof snap === "object" && !Array.isArray(snap)) {
        return snap as AgentSnapshotShape;
      }
      return null;
    } catch (e: unknown) {
      this.log.warn({ err: serializeUnknownError(e), sessionId, tenant }, "turn.llm.phase.loadAgentSnapshot.failed");
      return null;
    }
  }

  /**
   * 取消运行中的 turn —— DB + SSE + tachu.Engine.cancel(sessionId) 三件套。
   *
   * 关键变化（vs. 旧实现）：不再维护 `pendingAbort: Map<turnId, AbortController>`，
   * 取消信号通过 tachu.Engine.cancel(sessionId) 注入；这是 tachu 内部
   * `runtimeState` 维护的、与 sessionId 严格 1:1 的 cancel hook。
   */
  async cancelTurn(turnId: string, tenant: number, reason: TurnCancelReason): Promise<void> {
    const row = await this.turns.getTurnRow(turnId, tenant);
    if (!row || row.status !== "RUNNING") {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_SESSION", `Turn ${turnId} not running`, { turnId });
    }

    // 通知 tachu 中断该 sessionId 上的活跃 run；幂等、最坏情况 no-op。
    try {
      this.tachuEngine.cancel(row.sessionId, `cancelled-by-user:${reason}`);
    } catch (e: unknown) {
      this.log.warn({ err: serializeUnknownError(e), turnId, sessionId: row.sessionId }, "turn.cancel.engine.cancel.failed");
    }

    await this.turns.cancelTurn({
      turnId,
      tenant,
    });

    const cancelled = TurnCancelledEventSchema.parse({
      schema: "turn-cancelled-v1",
      turnId,
      reason,
      endTime: Date.now(),
    });

    await this.sseEmitter.emit({ tenant, sessionId: row.sessionId }, turnId, {
      sseEvent: "turn.cancelled",
      payload: cancelled,
    });
  }

  /** Persist completion + SSE (when orchestrator finishes outside auto-path). */
  async completeTurn(
    turnId: string,
    tenant: number,
    finalMessageId: string,
    tokenUsage: { input: number; output: number; total: number },
  ): Promise<void> {
    const row = await this.turns.getTurnRow(turnId, tenant);
    if (!row) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_SESSION", `Turn ${turnId} not found`, { turnId });
    }

    await this.turns.completeTurn({
      turnId,
      tenant,
      tokenUsage,
      finalMessageId,
    });

    const completed = TurnCompletedEventSchema.parse({
      schema: "turn-completed-v1",
      turnId,
      finalMessageId,
      tokenUsage,
      durationMs: 0,
      endTime: Date.now(),
    });

    await this.sseEmitter.emit({ tenant, sessionId: row.sessionId }, turnId, {
      sseEvent: "turn.completed",
      payload: completed,
    });
  }

  /**
   * Emit `usage.llm_call` to outbox after a successful turn (best-effort).
   *
   * Channel `usage_event` + target `agentic-usage-events` aligns with
   * `UsageEventProducerImpl.emit` (P3-11) so the downstream usage consumer
   * (09-usage-events) can route this event uniformly.
   *
   * Failures here MUST NOT propagate — turn already succeeded; outbox-relay
   * metrics + audit.write will surface persistent emission gaps.
   *
   * ref: docs/detailed-design/09-usage-events/outbox-contract.md §3.2
   */
  private async emitUsageLlmCall(arg: {
    tenant: number;
    sessionId: string;
    turnId: string;
    model: string;
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: number;
  }): Promise<void> {
    try {
      await this.outbox.append(null as unknown as TransactionContext, {
        tenant: arg.tenant,
        channel: "usage_event",
        eventType: "usage.llm_call",
        payloadJson: {
          sessionId: arg.sessionId,
          turnId: arg.turnId,
          model: arg.model,
          promptTokens: arg.promptTokens ?? 0,
          completionTokens: arg.completionTokens ?? 0,
          costUsd: arg.costUsd ?? 0,
          timestamp: Date.now(),
        },
        target: "agentic-usage-events",
        scheduleTime: Date.now(),
      });
    } catch (e: unknown) {
      this.log.warn({ err: serializeUnknownError(e), sessionId: arg.sessionId, turnId: arg.turnId }, "usage.llm_call.outbox.append.failed");
    }
  }
}
