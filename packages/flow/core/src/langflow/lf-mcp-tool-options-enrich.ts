import { type McpListedTool, listMcpToolNamesWithSdk } from "../mcp/mcp-list-tools-sdk";

/**
 * 设为 `0` 时跳过 Push 前对 MCP 的 live `listTools`（内网不可达或仅需离线合并时用）。
 */
function envTruthyPushFetchToolOptions(): boolean {
  const v = process.env["CUBE_AI_LF_PUSH_FETCH_MCP_TOOL_OPTIONS"];
  if (v === "0" || v === "false" || v === "no") {
    return false;
  }
  return true;
}

/** 从已合并的 LF `template.mcp_server`（McpInput 值）解析 StreamableHTTP/SSE 的 listTools 参数；stdio 无 url 时返回 null。 */
export function mcpListTransportParamsFromLfMcpTemplate(template: Record<string, unknown>): {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
} | null {
  const mcpSlot = template["mcp_server"];
  if (!mcpSlot || typeof mcpSlot !== "object" || mcpSlot === null || !("value" in mcpSlot)) {
    return null;
  }
  const valRaw = (mcpSlot as Record<string, unknown>)["value"];
  if (!valRaw || typeof valRaw !== "object" || Array.isArray(valRaw)) {
    return null;
  }
  const val = valRaw as Record<string, unknown>;
  const cfgRaw = val["config"];
  if (!cfgRaw || typeof cfgRaw !== "object" || Array.isArray(cfgRaw)) {
    return null;
  }
  const c = cfgRaw as Record<string, unknown>;
  const urlRaw = c["url"];
  const url = typeof urlRaw === "string" && urlRaw.trim() ? urlRaw.trim() : "";
  if (!url) {
    return null;
  }

  const headers: Record<string, string> = {};
  const h = c["headers"];
  if (h !== null && h !== undefined && typeof h === "object" && !Array.isArray(h)) {
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) {
        headers[k] = v;
      }
    }
  }

  const timeoutFromField = (x: unknown): number | null => {
    if (typeof x !== "number" || !Number.isFinite(x) || x <= 0) {
      return null;
    }
    return x <= 360 ? Math.min(x * 1000, 120_000) : Math.min(x, 120_000);
  };

  let timeoutMs = 25_000;
  const t1 = timeoutFromField(c["timeout"]);
  const t2 = timeoutFromField(c["sse_read_timeout"]);
  if (t1 !== null && t1 !== undefined) {
    timeoutMs = t1;
  }
  if (t2 !== null && t2 !== undefined) {
    timeoutMs = Math.max(timeoutMs, t2);
  }
  timeoutMs = Math.min(Math.max(timeoutMs, 3000), 120_000);

  return { headers, timeoutMs, url };
}

function readTemplateToolSlotValue(toolSlot: unknown): string {
  if (!toolSlot || typeof toolSlot !== "object" || toolSlot === null || !("value" in toolSlot)) {
    return "";
  }
  const v = (toolSlot as Record<string, unknown>)["value"];
  if (typeof v === "string") {
    return v.trim();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return "";
}

/**
 * Push 前：对 `data` 内各 MCPTools 节点按 `mcp_server.value.config.url` 拉全量 `listTools`，写入 `template.tool.options`
 *（与 Langflow 画布刷新后的下拉一致）。失败时保留 `cubeGraphToLfFlowData` 已有 options / 仅含选中项的合并结果。
 * @returns Langflow 节点 `id` → 该次 `listTools` 的完整条目（供 reconcile 写入 `tools_metadata` 的真实 description）
 */
export async function enrichLfFlowDataWithLiveMcpToolOptions(lfData: Record<string, unknown>): Promise<Map<string, McpListedTool[]>> {
  const listedByLfNodeId = new Map<string, McpListedTool[]>();
  if (!envTruthyPushFetchToolOptions()) {
    return listedByLfNodeId;
  }

  const rawNodes = lfData["nodes"];
  if (!Array.isArray(rawNodes)) {
    return listedByLfNodeId;
  }

  const listCache = new Map<string, { toolNames: string[]; tools: McpListedTool[] }>();

  for (const raw of rawNodes) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const node = raw as Record<string, unknown>;
    const lfId = typeof node["id"] === "string" ? node["id"] : "";
    const wrap = node["data"];
    if (!wrap || typeof wrap !== "object") {
      continue;
    }
    if ((wrap as Record<string, unknown>)["type"] !== "MCPTools") {
      continue;
    }

    const inner = (wrap as Record<string, unknown>)["node"];
    if (!inner || typeof inner !== "object") {
      continue;
    }
    const tpl = (inner as Record<string, unknown>)["template"];
    if (!tpl || typeof tpl !== "object") {
      continue;
    }

    const T = tpl as Record<string, unknown>;
    const params = mcpListTransportParamsFromLfMcpTemplate(T);
    if (!params) {
      continue;
    }

    const cacheKey = `${params.url}\n${JSON.stringify(params.headers)}`;
    let cached = listCache.get(cacheKey);
    if (!cached) {
      const res = await listMcpToolNamesWithSdk(params.url, params.headers, params.timeoutMs);
      if (!res.ok) {
        console.warn(`[cube-ai] enrichLfFlowDataWithLiveMcpToolOptions: listTools failed for ${params.url.slice(0, 96)} — ${res.error}`);
        continue;
      }
      cached = { toolNames: res.toolNames, tools: res.tools };
      listCache.set(cacheKey, cached);
    }
    const names = cached.toolNames;

    const toolSlot = T["tool"];
    if (!toolSlot || typeof toolSlot !== "object" || toolSlot === null) {
      continue;
    }
    const s = toolSlot as Record<string, unknown>;
    s["options"] = [...names];

    const selected = readTemplateToolSlotValue(toolSlot);
    if (selected && !names.includes(selected)) {
      s["options"] = [...names, selected];
    }

    if (lfId) {
      listedByLfNodeId.set(lfId, cached.tools);
    }
  }

  return listedByLfNodeId;
}
