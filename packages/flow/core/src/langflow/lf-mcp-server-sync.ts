import type { CubeFlowGraph, CubeFlowNode } from "../contracts/cube-flow";
import type { LangflowClient } from "./langflow-client";

/**
 * 与 web `sortedMcpProtocolKeys` 对齐：协议桶顶层键（值为对象），不含裸 `config`。
 */
function sortedMcpBucketKeys(o: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === "config") {
      continue;
    }
    if (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) {
      keys.push(k);
    }
  }
  keys.sort((a, b) => {
    if (a === "bizData") {
      return -1;
    }
    if (b === "bizData") {
      return 1;
    }
    return a.localeCompare(b);
  });
  return keys;
}

/** 从 Cube 节点 `mcp_server` 值解析 LF 全局注册名与 POST body（url/headers/command 等） */
export function cubeMcpServerToLfRegistration(val: unknown): {
  lfName: string;
  lfBody: Record<string, unknown>;
} | null {
  if (val === null || val === undefined) {
    return null;
  }
  if (typeof val === "string") {
    const n = val.trim();
    return n ? { lfBody: {}, lfName: n } : null;
  }
  if (typeof val !== "object" || Array.isArray(val)) {
    return null;
  }
  const o = val as Record<string, unknown>;
  if (typeof o["name"] === "string" && o["name"].trim()) {
    const lfName = o["name"].trim();
    const lfBody: Record<string, unknown> = {};
    const cfg = o["config"];
    if (cfg !== null && cfg !== undefined && typeof cfg === "object" && !Array.isArray(cfg)) {
      Object.assign(lfBody, lfBodyFromBucket(cfg as Record<string, unknown>));
    }
    /** 导出/规范后常见 `{ name, bizData: { url, … } }`（config 已迁入 bizData）；勿只读 config 否则 body 为空、不会 POST LF。 */
    const bd = o["bizData"];
    if (bd !== null && bd !== undefined && typeof bd === "object" && !Array.isArray(bd)) {
      Object.assign(lfBody, lfBodyFromBucket(bd as Record<string, unknown>));
    }
    return { lfBody, lfName };
  }
  const keys = sortedMcpBucketKeys(o);
  if (keys.length === 0) {
    return null;
  }
  const lfName = keys[0]!;
  const bucket = o[lfName];
  if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
    return null;
  }
  return { lfBody: lfBodyFromBucket(bucket as Record<string, unknown>), lfName };
}

/**
 * Langflow `McpInput` / `MCPToolsComponent.update_tool_list` 使用 `mcp_server` 为 `{ name, config? }`（`config` 含 url 等），
 * 不是 Cube 协议桶 `{ bizData: { url } }`。写入 LF `template.mcp_server.value` 前统一为此形状。
 */
export function cubeMcpServerToLangflowMcpInputValue(val: unknown, verifySsl?: unknown): unknown {
  if (val === null || val === undefined) {
    return val;
  }
  if (typeof val === "string") {
    const n = val.trim();
    return n ? { name: n } : val;
  }
  const reg = cubeMcpServerToLfRegistration(val);
  if (!reg) {
    return val;
  }
  const config: Record<string, unknown> = { ...reg.lfBody };
  if (typeof verifySsl === "boolean" && config["verify_ssl"] === undefined) {
    config["verify_ssl"] = verifySsl;
  }
  if (Object.keys(config).length > 0) {
    return { config, name: reg.lfName };
  }
  return { name: reg.lfName };
}

/** 已是 LF `McpInput` 接受的 `{ name, config? }`（无 Cube `bizData` 桶）时，merge 切勿再跑 `normalizeMcpServerValueForFlowExport`（会把 config 挪成 bizData）。 */
export function isLangflowMcpInputServerValue(val: unknown): boolean {
  if (val === null || val === undefined || typeof val !== "object" || Array.isArray(val)) {
    return false;
  }
  const o = val as Record<string, unknown>;
  if (typeof o["name"] !== "string" || !o["name"].trim()) {
    return false;
  }
  if (o["bizData"] !== null && o["bizData"] !== undefined) {
    return false;
  }
  const c = o["config"];
  if (c !== undefined && c !== null && (typeof c !== "object" || Array.isArray(c))) {
    return false;
  }
  return true;
}

function lfBodyFromBucket(bucket: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const urlRaw = bucket["url"];
  const epRaw = bucket["endpoint"];
  if (typeof urlRaw === "string" && urlRaw.trim()) {
    out["url"] = urlRaw.trim();
  } else if (typeof epRaw === "string" && epRaw.trim()) {
    out["url"] = epRaw.trim();
  }
  const h = bucket["headers"];
  if (h !== null && h !== undefined && typeof h === "object" && !Array.isArray(h)) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
      if (typeof v === "string") {
        headers[k] = v;
      }
    }
    if (Object.keys(headers).length > 0) {
      out["headers"] = headers;
    }
  }
  if (typeof bucket["command"] === "string" && bucket["command"].trim()) {
    out["command"] = bucket["command"].trim();
  }
  const args = bucket["args"];
  if (Array.isArray(args) && args.every((x) => typeof x === "string")) {
    out["args"] = args as string[];
  }
  const env = bucket["env"];
  if (env !== null && env !== undefined && typeof env === "object" && !Array.isArray(env)) {
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
      if (typeof v === "string") {
        e[k] = v;
      }
    }
    if (Object.keys(e).length > 0) {
      out["env"] = e;
    }
  }
  const t = bucket["timeout"];
  if (typeof t === "number" && Number.isFinite(t)) {
    out["timeout"] = t;
  }
  const sseRt = bucket["sse_read_timeout"];
  if (typeof sseRt === "number" && Number.isFinite(sseRt)) {
    out["sse_read_timeout"] = sseRt;
  }
  return out;
}

function cloneGraph(g: CubeFlowGraph): CubeFlowGraph {
  return structuredClone(g) as CubeFlowGraph;
}

function hasMcpTransport(body: Record<string, unknown>): boolean {
  return (typeof body["url"] === "string" && body["url"].length > 0) || (typeof body["command"] === "string" && body["command"].length > 0);
}

/**
 * 在推送 Langflow 前：对 MCPTools 引用的 MCP 在 LF 全局 ` /api/v2/mcp/servers` 中按需创建，
 * 并把节点 `config.mcp_server` 规范为 LF `McpInput` 可读的 `{ name, config? }`（保留 url 等，供后续 `cubeGraphToLfFlowData` 写入 template；勿只写 `{ name }` 否则会丢失 `config.url`）。
 *
 * 返回 **新图副本**，不修改入参（避免 SQLite 图被改成仅 LF 友好的形状）。
 */
export async function normalizeGraphMcpServersForLangflowPush(lf: LangflowClient, graph: CubeFlowGraph): Promise<CubeFlowGraph> {
  const out = cloneGraph(graph);
  /** 不依赖 GET /api/v2/mcp/servers（部分部署下与 flow PATCH 鉴权不一致）；有连接信息则直接幂等 POST。 */
  /** 同一 flow 内多颗 MCPTools 指向同一服务时只 POST 一次 */
  const postedThisSync = new Set<string>();
  for (const n of out.nodes) {
    if (n.cubeType !== "cube.lf.MCPTools") {
      continue;
    }
    await ensureOneMcpNode(lf, n, postedThisSync);
  }
  return out;
}

async function ensureOneMcpNode(lf: LangflowClient, n: CubeFlowNode, postedThisSync: Set<string>): Promise<void> {
  const reg = cubeMcpServerToLfRegistration(n.config["mcp_server"]);
  if (!reg) {
    return;
  }

  const verifySsl = n.config["verify_ssl"];
  const body = { ...reg.lfBody };
  if (typeof verifySsl === "boolean") {
    body["verify_ssl"] = verifySsl;
  }

  if (hasMcpTransport(body) && !postedThisSync.has(reg.lfName)) {
    try {
      await lf.addMcpV2Server(reg.lfName, body);
    } catch (e) {
      console.warn(`[cube-ai] Langflow POST /api/v2/mcp/servers/${reg.lfName} failed:`, e);
    }
    postedThisSync.add(reg.lfName);
  }

  /** 合并进 LF template 需要 `config.url`；勿只写 `{ name }`。 */
  const mcpForLfMerge = Object.keys(body).length > 0 ? { config: body, name: reg.lfName } : { name: reg.lfName };
  n.config = { ...n.config, mcp_server: mcpForLfMerge };
}
