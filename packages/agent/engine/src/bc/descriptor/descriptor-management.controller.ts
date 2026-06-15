/**
 * DescriptorManagementController —— agent 管理面（console face，ADR-0016 §8 / ADR-0018 §2）。
 *
 * 挂 `/agent` 领域命名空间（与 flow/kb/llm 的「领域命名空间=管理面」对齐）；消费面继续独占
 * `/v1/*`（ADR-0008 addendum 不变）。三种 kind（agent/skill/rule）对称暴露：
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
import 'reflect-metadata';
import { Controller, POST, GET, PATCH, DELETE, Context, contextStore } from '@dangao/bun-server';
import {
  ProposeRequestSchema,
  type DualSubject,
  type TenantDescriptorKind,
} from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import {
  DescriptorManagementService,
  type ProposeStreamEvent,
} from './descriptor-management.service';

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

function tenantOf(ctx: Context): number {
  return readSubject(ctx).tenant;
}

function actorOf(ctx: Context): string {
  return readSubject(ctx).user.userId;
}

async function rawTextBody(ctx: Context): Promise<string> {
  const text = await ctx.request.text();
  if (!text || !text.trim()) {
    throw AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_DESCRIPTOR_DOCUMENT',
      'Descriptor document body must be non-empty text/plain',
      {},
    );
  }
  return text;
}

async function jsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = (await ctx.getBody()) as unknown;
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

@Controller('/agent')
export class DescriptorManagementController {
  constructor(private readonly svc: DescriptorManagementService) {}

  // ─── agent ────────────────────────────────────────────────────────────────
  @POST('/agents')
  createAgent() {
    return this.create('agent');
  }
  @GET('/agents')
  listAgents() {
    return this.list('agent');
  }
  @GET('/agents/:id')
  getAgent() {
    return this.get();
  }
  @PATCH('/agents/:id')
  updateAgent() {
    return this.update('agent');
  }
  @DELETE('/agents/:id')
  deleteAgent() {
    return this.remove();
  }
  @POST('/agents/:id/publish')
  publishAgent() {
    return this.publish();
  }
  @POST('/agents:fromDocument')
  agentFromDocument() {
    return this.fromDocument('agent');
  }
  @POST('/agents:propose')
  agentPropose() {
    return this.propose('agent');
  }

  // ─── skill ────────────────────────────────────────────────────────────────
  @POST('/skills')
  createSkill() {
    return this.create('skill');
  }
  @GET('/skills')
  listSkills() {
    return this.list('skill');
  }
  @GET('/skills/:id')
  getSkill() {
    return this.get();
  }
  @PATCH('/skills/:id')
  updateSkill() {
    return this.update('skill');
  }
  @DELETE('/skills/:id')
  deleteSkill() {
    return this.remove();
  }
  @POST('/skills/:id/publish')
  publishSkill() {
    return this.publish();
  }
  @POST('/skills:fromDocument')
  skillFromDocument() {
    return this.fromDocument('skill');
  }
  @POST('/skills:propose')
  skillPropose() {
    return this.propose('skill');
  }

  // ─── rule ─────────────────────────────────────────────────────────────────
  @POST('/rules')
  createRule() {
    return this.create('rule');
  }
  @GET('/rules')
  listRules() {
    return this.list('rule');
  }
  @GET('/rules/:id')
  getRule() {
    return this.get();
  }
  @PATCH('/rules/:id')
  updateRule() {
    return this.update('rule');
  }
  @DELETE('/rules/:id')
  deleteRule() {
    return this.remove();
  }
  @POST('/rules/:id/publish')
  publishRule() {
    return this.publish();
  }
  @POST('/rules:fromDocument')
  ruleFromDocument() {
    return this.fromDocument('rule');
  }
  @POST('/rules:propose')
  rulePropose() {
    return this.propose('rule');
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
    const content = 'content' in body ? body.content : body;
    return this.svc.update(tenantOf(ctx), kind, requireId(ctx), content, actorOf(ctx));
  }

  private async remove() {
    const ctx = requireCtx();
    await this.svc.remove(tenantOf(ctx), requireId(ctx), actorOf(ctx));
    ctx.setStatus(204);
    return undefined;
  }

  private async publish() {
    const ctx = requireCtx();
    return this.svc.publish(tenantOf(ctx), requireId(ctx), actorOf(ctx));
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
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'propose request body validation failed',
        { issues: parsed.error.issues },
      );
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
          if (ev.type === 'delta') {
            push(sseRecord('delta', { delta: ev.delta }));
          } else {
            push(sseRecord('proposal', ev.result));
          }
        }
      } catch (e) {
        push(sseRecord('error', { message: e instanceof Error ? e.message : String(e) }));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function requireId(ctx: Context): string {
  const id = ctx.getParam('id')?.trim();
  if (!id) {
    throw AgenticEngineError.fromCode('INVALID_ARGUMENT_DESCRIPTOR_ID', 'Descriptor id is required', {});
  }
  return id;
}
