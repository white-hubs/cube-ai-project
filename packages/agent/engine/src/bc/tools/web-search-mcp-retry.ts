/**
 * web-search MCP：`web_search` 在 categories=news 时常返回可解析的空 results[]；
 * 供 McpHandler 在调用 bridge 之后做一次仅 categories→general 的重试（query 等不变）。
 */

function collectMcpToolResultJsonStrings(result: unknown): string[] {
  const out: string[] = [];
  if (!result || typeof result !== 'object') return out;
  const r = result as Record<string, unknown>;

  const pushIfObjectJson = (s: unknown): void => {
    if (typeof s !== 'string') return;
    const t = s.trim();
    if (t.startsWith('{')) out.push(t);
  };

  const content = r['content'];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      pushIfObjectJson(rec['text']);
    }
  }

  const sc = r['structuredContent'];
  if (sc && typeof sc === 'object') {
    const res = (sc as Record<string, unknown>)['result'];
    if (typeof res === 'string') pushIfObjectJson(res);
    else if (res && typeof res === 'object') {
      try {
        out.push(JSON.stringify(res));
      } catch {
        /* ignore */
      }
    }
  }

  return out;
}

function isWebSearchResultJson(j: Record<string, unknown>): boolean {
  return typeof j['query'] === 'string' || Array.isArray(j['results']);
}

/** 解析 MCP tools/call 返回体，判断是否为零条 web 检索结果。 */
export function webSearchMcpResultHasZeroResults(result: unknown): boolean {
  const emptySignals: boolean[] = [];
  for (const s of collectMcpToolResultJsonStrings(result)) {
    try {
      const j = JSON.parse(s) as Record<string, unknown>;
      if (!isWebSearchResultJson(j)) continue;
      const results = j['results'];
      if (Array.isArray(results)) {
        if (results.length > 0) return false;
        emptySignals.push(true);
        continue;
      }
      if (typeof j['count'] === 'number' && j['count'] === 0) emptySignals.push(true);
    } catch {
      continue;
    }
  }
  return emptySignals.length > 0 && emptySignals.every(Boolean);
}
