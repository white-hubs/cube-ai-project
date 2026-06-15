/**
 * DescriptorMcpController — 管理 ops 工具集 MCP server 门面的 HTTP 入口（ADR-0027 §8）。
 *
 * 实现 MCP **Streamable HTTP** 传输（2025-03-26+），单一端点 `POST /mcp/descriptor`：
 *  - `Accept` 协商：client 接受 `application/json` → 单 JSON 响应；仅接受 `text/event-stream`
 *    → SSE 单消息流（每条 JSON-RPC 响应一个 `message` 事件）。
 *  - `initialize` 响应携带 `Mcp-Session-Id`（无传入则新铸）；后续请求回显传入值。
 *    本门面无状态（tenant 来自平台 token，非 session），故不强制校验 session 存在性。
 *  - 仅含通知/响应（无 id）的请求 → `202 Accepted` 空体。
 *  - `GET` / `DELETE`：本门面不提供服务端主动推流、无服务端 session 存储，分别回 405 / 204。
 *
 * 租户从请求上下文 subject 解析（与 `/agent/*` 管理面同一 platform-adapter 鉴权 seam，
 * 能力包无自有鉴权，ADR-0002/§8）。
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Controller, POST, GET, DELETE, Context, contextStore } from '@dangao/bun-server';
import type { DualSubject } from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import {
  DescriptorMcpService,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './descriptor-mcp.service';

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

function headerOf(ctx: Context, key: string): string | undefined {
  const getHeader = (ctx as unknown as { getHeader?: (k: string) => string | null }).getHeader;
  const v = getHeader ? getHeader(key) : undefined;
  return v ?? undefined;
}

/** JSON-RPC 请求（需响应）= 带 string|number id；其余（无 id / 通知）不产生响应。 */
function isRequest(entry: unknown): entry is JsonRpcRequest {
  if (!entry || typeof entry !== 'object') return false;
  const id = (entry as JsonRpcRequest).id;
  return typeof id === 'string' || typeof id === 'number';
}

function withSession(headers: Record<string, string>, sessionId?: string): Record<string, string> {
  return sessionId ? { ...headers, 'Mcp-Session-Id': sessionId } : headers;
}

function jsonResponse(payload: unknown, sessionId?: string): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: withSession({ 'Content-Type': 'application/json' }, sessionId),
  });
}

/** 每条 JSON-RPC 响应映射为一个默认 `message` SSE 事件，发完即 EOF 关闭。 */
function sseResponse(responses: JsonRpcResponse[], sessionId?: string): Response {
  const body = responses.map((r) => `event: message\ndata: ${JSON.stringify(r)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: withSession(
      {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
      sessionId,
    ),
  });
}

@Controller('/mcp/descriptor')
export class DescriptorMcpController {
  constructor(private readonly mcp: DescriptorMcpService) {}

  @POST('/')
  async rpc(): Promise<Response> {
    const ctx = requireCtx();
    const subject = readSubject(ctx);
    const tenant = subject.tenant;
    const actor = subject.user.userId;

    const accept = headerOf(ctx, 'accept') ?? '';
    const acceptsSse = accept.includes('text/event-stream');
    const acceptsJson = accept.includes('application/json') || accept.includes('*/*') || accept === '';

    const body = (await ctx.getBody()) as unknown;
    const wasArray = Array.isArray(body);
    const entries: unknown[] = wasArray ? (body as unknown[]) : [body ?? {}];

    const sessionIn = headerOf(ctx, 'mcp-session-id');
    const hasInitialize = entries.some(
      (e) => !!e && typeof e === 'object' && (e as JsonRpcRequest).method === 'initialize',
    );
    const sessionOut = hasInitialize ? (sessionIn ?? randomUUID()) : sessionIn;

    const requests = entries.filter(isRequest);
    // 仅通知/响应（无需回复）→ 202 Accepted 空体（Streamable HTTP 约定）。
    if (requests.length === 0) {
      return new Response(null, {
        status: 202,
        headers: withSession({}, sessionOut),
      });
    }

    const responses = await Promise.all(requests.map((e) => this.mcp.handle(e, tenant, actor)));

    // client 仅接受 SSE（不接受 JSON）→ 走 SSE；否则默认 application/json（最简、最广兼容）。
    if (acceptsSse && !acceptsJson) {
      return sseResponse(responses, sessionOut);
    }
    return jsonResponse(wasArray ? responses : responses[0], sessionOut);
  }

  /** 服务端不提供主动 server→client 推流 → 405（Streamable HTTP 允许）。 */
  @GET('/')
  openStream(): Response {
    return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } });
  }

  /** 无服务端 session 存储，session 终止为 no-op → 204。 */
  @DELETE('/')
  terminate(): Response {
    return new Response(null, { status: 204 });
  }
}
