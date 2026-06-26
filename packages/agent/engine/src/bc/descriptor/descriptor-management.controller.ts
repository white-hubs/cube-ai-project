/**
 * DescriptorManagementController —— agent 管理面（console face，ADR-0016 §8 / ADR-0018 §2）。
 *
 * 对外是 `/agent/console` 路径（ai-center 的 domain-prefix-mounts 在装配时将此控制器
 * 的 @Controller 基路径覆写为 `/agent/console`，ADR-0008）；消费面继续独占 `/v1/*`（ADR-0008 addendum 不变）。
 * 三种 kind（agent/skill/rule）对称暴露（下列为外部路径）：
 *   POST   /agent/{kind}                结构化创建（draft）
 *   GET    /agent/{kind}                列租户资产
 *   GET    /agent/{kind}/:id            取单个
 *   PATCH  /agent/{kind}/:id            更新（新草稿版本）
 *   DELETE /agent/{kind}/:id            软删
 *   POST   /agent/{kind}/:id/publish    发布 head
 *   POST   /agent/{kind}:fromDocument   text/plain 文档 upsert（ADR-0018）
 *
 * tenant 由请求上下文 subject 解析（ADR-0012 addendum：唯一隔离维度）。
 */
import "reflect-metadata";
import { Controller, POST, GET, PATCH, DELETE, Context, contextStore } from "@dangao/bun-server";

import { ProposeRequestSchema, type DualSubject, type TenantDescriptorKind } from "@cube-ai/contracts";

import { AgenticEngineError } from "../../infra/errors/agentic-error";
import { DescriptorManagementService, type ProposeStreamEvent } from "./descriptor-management.service";
import { isDescriptorAdmin } from "./descriptor-owner";

function requireCtx(): Context {
  const ctx = contextStore.getStore();
  if (!ctx) {
    throw AgenticEngineError.fromCode("INTERNAL_UNKNOWN", "Request Context missing — ensure ContextStore middleware is active", {});
  }
  return ctx;
}

function readSubject(ctx: Context): DualSubject {
  const subj = (ctx as unknown as { state?: { subject?: DualSubject } }).state?.subject;
  if (!subj?.user?.userId) {
    throw AgenticEngineError.fromCode("UNAUTHENTICATED_TOKEN_INVALID", "Authentication required", {});
  }
  return subj;
}

function tenantOf(ctx: Context): number {
  return readSubject(ctx).tenant;
}

function actorOf(ctx: Context): string {
  return readSubject(ctx).user.userId;
}

function descriptorAdminOf(ctx: Context): boolean {
  return isDescriptorAdmin(readSubject(ctx));
}

/** bun-server 将 `:suffix` 解析为动态参数，`:fromDocument` 与 `:propose` 会落到同一条路由；按后缀分发。 */
function normalizeColonAction(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  return value.startsWith(":") ? value.slice(1) : value;
}

function colonActionOf(ctx: Context): string {
  return normalizeColonAction(ctx.getParam("action"));
}

async function rawTextBody(ctx: Context): Promise<string> {
  const text = await ctx.request.text();
  if (!text || !text.trim()) {
    throw AgenticEngineError.fromCode("INVALID_ARGUMENT_DESCRIPTOR_DOCUMENT", "Descriptor document body must be non-empty text/plain", {});
  }
  return text;
}

async function jsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = (await ctx.getBody()) as unknown;
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

// @Controller('') 保持领域无关；ai-center 的 domain-prefix-mounts 在装配时将此控制器
// 覆写挂载到 `/agent/console`（apps/ai-center/src/assembler/domain-prefix-mounts.ts）。
@Controller("")
export class DescriptorManagementController {
  constructor(protected readonly svc: DescriptorManagementService) {}

  // ─── agent ────────────────────────────────────────────────────────────────
  @POST("/agents")
  createAgent() {
    return this.create("agent");
  }
  @GET("/agents")
  listAgents() {
    return this.list("agent");
  }
  @GET("/agents/:id")
  getAgent() {
    return this.get();
  }
  @PATCH("/agents/:id")
  updateAgent() {
    return this.update("agent");
  }
  @DELETE("/agents/:id")
  deleteAgent() {
    return this.remove();
  }
  @POST("/agents/:id/publish")
  publishAgent() {
    return this.publish();
  }
  @GET("/agents/:id/versions")
  listAgentVersions() {
    return this.listVersions();
  }
  @GET("/agents/:id/versions/:no")
  getAgentVersion() {
    return this.getVersion();
  }
  @POST("/agents/:id/rollback")
  rollbackAgent() {
    return this.rollback();
  }
  @POST("/agents:action")
  agentColonAction() {
    return this.dispatchColonAction("agent");
  }

  // ─── skill ────────────────────────────────────────────────────────────────
  @POST("/skills")
  createSkill() {
    return this.create("skill");
  }
  @GET("/skills")
  listSkills() {
    return this.list("skill");
  }
  @GET("/skills/:id")
  getSkill() {
    return this.get();
  }
  @PATCH("/skills/:id")
  updateSkill() {
    return this.update("skill");
  }
  @DELETE("/skills/:id")
  deleteSkill() {
    return this.remove();
  }
  @POST("/skills/:id/publish")
  publishSkill() {
    return this.publish();
  }
  @GET("/skills/:id/versions")
  listSkillVersions() {
    return this.listVersions();
  }
  @GET("/skills/:id/versions/:no")
  getSkillVersion() {
    return this.getVersion();
  }
  @POST("/skills/:id/rollback")
  rollbackSkill() {
    return this.rollback();
  }
  @POST("/skills:action")
  skillColonAction() {
    return this.dispatchColonAction("skill");
  }

  // ─── rule ─────────────────────────────────────────────────────────────────
  @POST("/rules")
  createRule() {
    return this.create("rule");
  }
  @GET("/rules")
  listRules() {
    return this.list("rule");
  }
  @GET("/rules/:id")
  getRule() {
    return this.get();
  }
  @PATCH("/rules/:id")
  updateRule() {
    return this.update("rule");
  }
  @DELETE("/rules/:id")
  deleteRule() {
    return this.remove();
  }
  @POST("/rules/:id/publish")
  publishRule() {
    return this.publish();
  }
  @GET("/rules/:id/versions")
  listRuleVersions() {
    return this.listVersions();
  }
  @GET("/rules/:id/versions/:no")
  getRuleVersion() {
    return this.getVersion();
  }
  @POST("/rules/:id/rollback")
  rollbackRule() {
    return this.rollback();
  }
  @POST("/rules:action")
  ruleColonAction() {
    return this.dispatchColonAction("rule");
  }

  // ─── shared handlers ────────────────────────────────────────────────────────
  private async create(kind: TenantDescriptorKind) {
    const ctx = requireCtx();
    const body = await jsonBody(ctx);
    return this.svc.create(tenantOf(ctx), kind, body, actorOf(ctx));
  }

  private async list(kind: TenantDescriptorKind) {
    const ctx = requireCtx();
    const items = await this.svc.list(tenantOf(ctx), kind);
    return { items };
  }

  private async get() {
    const ctx = requireCtx();
    return this.svc.get(tenantOf(ctx), requireId(ctx));
  }

  private async update(kind: TenantDescriptorKind) {
    const ctx = requireCtx();
    const body = await jsonBody(ctx);
    const content = "content" in body ? body.content : body;
    return this.svc.update(tenantOf(ctx), kind, requireId(ctx), content, actorOf(ctx));
  }

  private async remove() {
    const ctx = requireCtx();
    await this.svc.remove(tenantOf(ctx), requireId(ctx), actorOf(ctx), {
      isAdmin: descriptorAdminOf(ctx),
    });
    ctx.setStatus(204);
    return undefined;
  }

  private async publish() {
    const ctx = requireCtx();
    return this.svc.publish(tenantOf(ctx), requireId(ctx), actorOf(ctx));
  }

  private async listVersions() {
    const ctx = requireCtx();
    const items = await this.svc.listVersions(tenantOf(ctx), requireId(ctx), actorOf(ctx));
    return { items };
  }

  private async getVersion() {
    const ctx = requireCtx();
    const versionNo = requireVersionNo(ctx);
    const content = await this.svc.getVersionContent(tenantOf(ctx), requireId(ctx), versionNo, actorOf(ctx));
    return { content };
  }

  private async rollback() {
    const ctx = requireCtx();
    const body = await jsonBody(ctx);
    const versionNo = Number(body.versionNo);
    if (!Number.isInteger(versionNo) || versionNo <= 0) {
      throw AgenticEngineError.fromCode("INVALID_ARGUMENT_SCHEMA_VIOLATION", "rollback versionNo must be a positive integer", {
        versionNo: body.versionNo,
      });
    }
    return this.svc.rollback(tenantOf(ctx), requireId(ctx), versionNo, actorOf(ctx));
  }

  private async dispatchColonAction(kind: TenantDescriptorKind) {
    const action = colonActionOf(requireCtx());
    if (action === "fromDocument") {
      return this.fromDocument(kind);
    }
    if (action === "propose") {
      return this.propose(kind);
    }
    throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Unknown descriptor action: ${action || "(empty)"}`, {
      kind,
      action,
    });
  }

  /** 供单测直接调用（不经 HTTP 路由）。 */
  agentFromDocument() {
    return this.fromDocument("agent");
  }

  agentPropose() {
    return this.propose("agent");
  }

  skillFromDocument() {
    return this.fromDocument("skill");
  }

  skillPropose() {
    return this.propose("skill");
  }

  ruleFromDocument() {
    return this.fromDocument("rule");
  }

  rulePropose() {
    return this.propose("rule");
  }

  private async fromDocument(kind: TenantDescriptorKind) {
    const ctx = requireCtx();
    const raw = await rawTextBody(ctx);
    return this.svc.fromDocument(tenantOf(ctx), kind, raw, actorOf(ctx));
  }

  /**
   * ADR-0027 §5：`POST /agent/{kind}:propose` SSE。
   * 先流 prose token delta（生成的 prompt/instructions/rule 文本）供人实时看，
   * 末尾一个 `proposal` 事件搭载完整 {@link ProposeResult} 信封。
   */
  private async propose(kind: TenantDescriptorKind): Promise<Response> {
    const ctx = requireCtx();
    const tenant = tenantOf(ctx);
    const body = await jsonBody(ctx);
    const parsed = ProposeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw AgenticEngineError.fromCode("INVALID_ARGUMENT_SCHEMA_VIOLATION", "propose request body validation failed", {
        issues: parsed.error.issues,
      });
    }
    return proposeSseResponse(this.svc.proposeStream(tenant, kind, parsed.data));
  }
}

function sseRecord(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * 两阶段真流式（ADR-0027 §5）：直接把 {@link ProposeStreamEvent} 序列映射到 SSE——
 * phase-1 的每个 prose token → `delta` 事件，phase-2 终态信封 → `proposal` 事件；正常 EOF 关闭。
 * 流中途异常以 `error` 事件透出，避免悬挂。
 */
function proposeSseResponse(events: AsyncIterable<ProposeStreamEvent>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const push = (s: string) => controller.enqueue(enc.encode(s));
      try {
        for await (const ev of events) {
          if (ev.type === "delta") {
            push(sseRecord("delta", { delta: ev.delta }));
          } else {
            push(sseRecord("proposal", ev.result));
          }
        }
      } catch (e) {
        push(sseRecord("error", { message: e instanceof Error ? e.message : String(e) }));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Legacy alias for callers still on pre-ADR-0008 paths (`/agent/agents` etc.).
 * Canonical management face remains `/agent/console/*` (ADR-0016).
 */
@Controller("")
export class DescriptorManagementLegacyController extends DescriptorManagementController {}

function requireId(ctx: Context): string {
  const id = ctx.getParam("id")?.trim();
  if (!id) {
    throw AgenticEngineError.fromCode("INVALID_ARGUMENT_DESCRIPTOR_ID", "Descriptor id is required", {});
  }
  return id;
}

function requireVersionNo(ctx: Context): number {
  const raw = ctx.getParam("no")?.trim();
  const versionNo = Number(raw);
  if (!Number.isInteger(versionNo) || versionNo <= 0) {
    throw AgenticEngineError.fromCode("INVALID_ARGUMENT_SCHEMA_VIOLATION", "Descriptor version number must be a positive integer", {
      versionNo: raw,
    });
  }
  return versionNo;
}
