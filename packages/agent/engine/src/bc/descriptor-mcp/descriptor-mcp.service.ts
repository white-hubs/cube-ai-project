/**
 * DescriptorMcpService — 管理 ops 工具集的**对外面**核心（ADR-0027 §8）。
 *
 * engine **首次作为 MCP 服务端（出站角色）**：把同一批管理 ops（与进程内 handler 同核
 * {@link runDescriptorOp}）经 JSON-RPC 暴露，供 engine 之外、任何 MCP-capable 的 agent host
 * 直接管理本中台 descriptor。仅实现门面所需的标准方法：`initialize` / `tools/list` /
 * `tools/call`（外加 `ping`）。
 *
 * 鉴权/租户：tenant 由调用方（controller）从平台 token 经 platform-adapter 解析后传入，
 * 与 HTTP 路径一致——能力包无自有鉴权（ADR-0002/§8）。
 *
 * 服务端 draft-safe 硬保证（engine 是被调方、非编排者，§9）：create/update 只产 draft
 * （天然安全）；publish / 软删需显式 `confirmed:true`，缺省/false → 明确报错（人面 consent
 * 交给 MCP client host）。
 */
import { Injectable } from '@dangao/bun-server';
import { DescriptorManagementService } from '../descriptor/descriptor-management.service';
import {
  CONFIRM_REQUIRED_OPS,
  managementMcpToolList,
  managementToolDefByName,
  runDescriptorOp,
} from '../tools/handlers/descriptor-ops';

/**
 * engine MCP 门面支持的协议版本（降序，含 Streamable HTTP 引入后的版本）。
 * `initialize` 回显 client 请求的版本（若受支持），否则回我们的最新版（首元素）。
 */
export const DESCRIPTOR_MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
/** 缺省/最新协议版本（client 未协商或请求了不支持版本时回退）。 */
export const DESCRIPTOR_MCP_PROTOCOL_VERSION = DESCRIPTOR_MCP_PROTOCOL_VERSIONS[0];
export const DESCRIPTOR_MCP_SERVER_INFO = {
  name: 'cube-descriptor-mcp',
  version: '0.1.0',
} as const;

/** initialize 协议协商：受支持则回显 client 请求版本，否则回最新。 */
export function negotiateProtocolVersion(params: unknown): string {
  const requested =
    params && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>)['protocolVersion']
      : undefined;
  if (
    typeof requested === 'string' &&
    (DESCRIPTOR_MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    return requested;
  }
  return DESCRIPTOR_MCP_PROTOCOL_VERSION;
}

/** JSON-RPC 错误码（含为本门面约定的 confirmation 拒绝映射）。 */
export const JSON_RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** confirmation 拒绝时塞进 error.data.code，便于 client 区分（与进程内强 consent 对齐）。 */
export const CONFIRMATION_REQUIRED_CODE = 'FAILED_PRECONDITION_CONFIRMATION_REQUIRED';

function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

function failure(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

interface ErrorLike {
  code?: unknown;
  message?: unknown;
}

@Injectable()
export class DescriptorMcpService {
  constructor(private readonly svc: DescriptorManagementService) {}

  /**
   * 派发单条 JSON-RPC 请求。tenant/actor 已由调用方鉴权解析；本方法不读取入参里的 tenant。
   */
  async handle(
    req: JsonRpcRequest,
    tenant: number,
    actor?: string,
  ): Promise<JsonRpcResponse> {
    const id: JsonRpcId = req?.id ?? null;
    const method = req?.method;
    if (typeof method !== 'string' || method.length === 0) {
      return failure(id, JSON_RPC.INVALID_REQUEST, 'Missing JSON-RPC method');
    }

    switch (method) {
      case 'initialize':
        return success(id, {
          protocolVersion: negotiateProtocolVersion(req.params),
          capabilities: { tools: {} },
          serverInfo: DESCRIPTOR_MCP_SERVER_INFO,
        });
      case 'ping':
        return success(id, {});
      case 'tools/list':
        return success(id, { tools: managementMcpToolList() });
      case 'tools/call':
        return this.handleToolsCall(id, req.params, tenant, actor);
      default:
        return failure(id, JSON_RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  private async handleToolsCall(
    id: JsonRpcId,
    params: unknown,
    tenant: number,
    actor?: string,
  ): Promise<JsonRpcResponse> {
    const p =
      params && typeof params === 'object' && !Array.isArray(params)
        ? (params as Record<string, unknown>)
        : {};
    const name = typeof p['name'] === 'string' ? p['name'] : '';
    const args =
      p['arguments'] && typeof p['arguments'] === 'object' && !Array.isArray(p['arguments'])
        ? (p['arguments'] as Record<string, unknown>)
        : {};

    const def = managementToolDefByName(name);
    if (!def) {
      return failure(id, JSON_RPC.INVALID_PARAMS, `Unknown tool: ${name || '(missing)'}`);
    }

    // 服务端 draft-safe 硬保证：动运行时的 op 需显式 confirmed:true（§9）。
    if (CONFIRM_REQUIRED_OPS.has(def.op) && args['confirmed'] !== true) {
      return failure(
        id,
        JSON_RPC.INVALID_PARAMS,
        `Tool ${name} affects runtime and requires { "confirmed": true } to proceed`,
        { code: CONFIRMATION_REQUIRED_CODE, tool: name },
      );
    }

    try {
      const result = await runDescriptorOp(this.svc, def.op, tenant, args, actor);
      return success(id, {
        content: [{ type: 'text', text: stableStringify(result) }],
        structuredContent: result,
        isError: false,
      });
    } catch (e) {
      const err = e as ErrorLike;
      const code = typeof err?.code === 'string' ? err.code : 'INTERNAL_UNKNOWN';
      const message = typeof err?.message === 'string' ? err.message : String(e);
      return failure(id, JSON_RPC.INTERNAL_ERROR, message, { code, tool: name });
    }
  }
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
