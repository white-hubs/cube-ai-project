/**
 * MCP `web-search` 服务：在 `listTools` 注册前为 `web_search` / `fetch_page` 等工具追加引擎侧说明，
 * 引导模型正确使用 categories、节制并行 fetch（与 McpHandler 的 news→general 空结果重试互补）。
 */

const TOOL_DESCRIPTOR_DESCRIPTION_MAX = 2048;

/** 追加在 MCP 原始 `web_search` 描述之后。 */
const WEB_SEARCH_DESC_SUFFIX = `

【引擎补充｜web_search】
- 参数 categories：news 易在综合/中文热点类问题下返回 0 条（仍可能算调用成功）；general 覆盖面更广，日报式、要闻汇总请优先 general。news 且 0 条时引擎会自动以 general 补检一次，请勿为同义改写连续多次调用。
- 若首次 web_search（建议 general）已返回多条带 title/snippet 的结果，除非用户追问仍缺的信息域，否则不要仅换同义 query 再次 web_search，以免上下文暴涨、拖垮后续 LLM 步。`;

const WEB_SEARCH_CATEGORIES_PARAM_DESC = `news：新闻垂类，部分环境易返回空列表；general：综合检索，适合「今日资讯 / 热点汇总」。默认或不确定时优先用 general。`;

/** 追加在 MCP 原始 `fetch_page` 描述之后。 */
const FETCH_PAGE_DESC_SUFFIX = `

【引擎补充｜fetch_page】
- 若上一步 web_search 摘要已含标题与 snippet，且用户只要要闻/要点列表，应优先直接基于摘要组织答案，不要为了「更完整」而串联多次 fetch_page。
- 除非用户明确要求核对原文细节，否则单轮内 fetch_page 宜控制在少量（例如 1～2 次），优先选与问题最相关的一条 URL。`;

const FETCH_PAGE_URL_PARAM_DESC = `请仅在 web_search 摘要不足以回答时再抓取；避免与已有 snippet 重复的大量全文抓取。`;

function mergeToolDescription(base: string, suffix: string): string {
  const b = base.trim();
  const s = suffix.trim();
  const body = b.length > 0 ? `${b}\n${s}` : s;
  if (body.length <= TOOL_DESCRIPTOR_DESCRIPTION_MAX) return body;
  const reserve = Math.min(s.length + 8, TOOL_DESCRIPTOR_DESCRIPTION_MAX);
  const headBudget = TOOL_DESCRIPTOR_DESCRIPTION_MAX - reserve;
  if (headBudget <= 0) return s.slice(0, TOOL_DESCRIPTOR_DESCRIPTION_MAX);
  const head = b.length > 0 ? `${b.slice(0, headBudget)}…` : "";
  return `${head}\n${s}`.slice(0, TOOL_DESCRIPTOR_DESCRIPTION_MAX);
}

function mergeCategoriesProperty(props: Record<string, unknown>): void {
  const cat = props["categories"];
  if (cat && typeof cat === "object" && !Array.isArray(cat)) {
    const o = { ...(cat as Record<string, unknown>) };
    const prev = typeof o["description"] === "string" ? (o["description"] as string).trim() : "";
    o["description"] = prev.length > 0 ? `${prev}\n${WEB_SEARCH_CATEGORIES_PARAM_DESC}` : WEB_SEARCH_CATEGORIES_PARAM_DESC;
    props["categories"] = o;
  } else {
    props["categories"] = {
      type: "string",
      description: WEB_SEARCH_CATEGORIES_PARAM_DESC,
    };
  }
}

function mergeUrlProperty(props: Record<string, unknown>): void {
  const url = props["url"];
  if (url && typeof url === "object" && !Array.isArray(url)) {
    const o = { ...(url as Record<string, unknown>) };
    const prev = typeof o["description"] === "string" ? (o["description"] as string).trim() : "";
    o["description"] = prev.length > 0 ? `${prev}\n${FETCH_PAGE_URL_PARAM_DESC}` : FETCH_PAGE_URL_PARAM_DESC;
    props["url"] = o;
  } else {
    props["url"] = {
      type: "string",
      description: FETCH_PAGE_URL_PARAM_DESC,
    };
  }
}

/**
 * 在 `listTools` 组装 descriptor 时调用：仅处理 server id 为 `web-search` 的 `web_search` / `fetch_page`。
 */
export function augmentWebSearchMcpToolDescriptor(args: {
  serverName: string;
  mcpToolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}): { description: string; inputSchema: Record<string, unknown> } {
  if (args.serverName !== "web-search") {
    return { description: args.description, inputSchema: args.inputSchema };
  }

  if (args.mcpToolName === "web_search") {
    const inputSchema = structuredClone(args.inputSchema) as Record<string, unknown>;
    const rawProps = inputSchema["properties"];
    if (rawProps && typeof rawProps === "object" && !Array.isArray(rawProps)) {
      const props = { ...(rawProps as Record<string, unknown>) };
      mergeCategoriesProperty(props);
      inputSchema["properties"] = props;
    }
    return {
      description: mergeToolDescription(args.description ?? "", WEB_SEARCH_DESC_SUFFIX),
      inputSchema,
    };
  }

  if (args.mcpToolName === "fetch_page") {
    const inputSchema = structuredClone(args.inputSchema) as Record<string, unknown>;
    const rawProps = inputSchema["properties"];
    if (rawProps && typeof rawProps === "object" && !Array.isArray(rawProps)) {
      const props = { ...(rawProps as Record<string, unknown>) };
      mergeUrlProperty(props);
      inputSchema["properties"] = props;
    }
    return {
      description: mergeToolDescription(args.description ?? "", FETCH_PAGE_DESC_SUFFIX),
      inputSchema,
    };
  }

  return { description: args.description, inputSchema: args.inputSchema };
}
