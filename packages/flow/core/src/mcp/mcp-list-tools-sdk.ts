import { Client } from '@modelcontextprotocol/sdk/client'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export type McpListedTool = { name: string; description: string; inputSchema: unknown | null }

function descriptionFromListedToolEntry(tool: {
  description?: unknown
  inputSchema?: unknown
}): string {
  const d = tool.description
  if (typeof d === 'string' && d.trim()) return d.trim()
  const sch = tool.inputSchema
  if (sch != null && typeof sch === 'object' && !Array.isArray(sch)) {
    const sd = (sch as Record<string, unknown>)['description']
    if (typeof sd === 'string' && sd.trim()) return sd.trim()
  }
  return ''
}

export type McpListToolsSdkResult =
  | {
      ok: true
      toolNames: string[]
      tools: McpListedTool[]
      transport: 'streamable-http' | 'sse'
      attemptedUrl: string
    }
  | { ok: false; toolNames: []; tools: []; error: string; attemptedUrl: string }

function requestInitForMcp(headers: Record<string, string>, timeoutMs: number): RequestInit {
  const h = new Headers()
  for (const [k, v] of Object.entries(headers)) {
    if (v) h.set(k, v)
  }
  const ms = Math.min(Math.max(timeoutMs, 3000), 120_000)
  return {
    headers: h,
    signal: AbortSignal.timeout(ms),
  }
}

/**
 * 与 Langflow（`streamablehttp_client` → `sse_client`）及官方
 * `streamableHttpWithSseFallbackClient` 一致：先 Streamable HTTP，失败再 legacy SSE。
 */
async function connectClientWithStreamableThenSse(
  baseUrl: URL,
  requestInit: RequestInit,
): Promise<{ client: Client; transport: Transport; transportKind: 'streamable-http' | 'sse' }> {
  const opts = { requestInit }
  const primary = new Client({ name: 'cube-ai-flow', version: '1.0.0' })
  try {
    const transport = new StreamableHTTPClientTransport(baseUrl, opts)
    await primary.connect(transport)
    return { client: primary, transport, transportKind: 'streamable-http' }
  } catch {
    const fallback = new Client({ name: 'cube-ai-flow', version: '1.0.0' })
    const transport = new SSEClientTransport(baseUrl, opts)
    await fallback.connect(transport)
    return { client: fallback, transport, transportKind: 'sse' }
  }
}

/**
 * 与历史 hand-rolled 代理一致：当只填了 `/sse` 时顺带尝试同 host 的 `/mcp` 等（Streamable 常挂在此路径）。
 * @internal 单测使用
 */
export function mcpToolsCandidateUrls(primary: string): string[] {
  const out: string[] = [primary]
  try {
    const u = new URL(primary)
    const path = (u.pathname.replace(/\/+$/, '') || '/').toLowerCase()
    const isSsePath = path === '/sse' || path.endsWith('/sse')
    const stripTrailingSse = (p: string): string => {
      const x = p.replace(/\/+$/, '') || '/'
      if (x.toLowerCase() === '/sse') return ''
      if (x.toLowerCase().endsWith('/sse')) return x.slice(0, -4).replace(/\/+$/, '') || ''
      return x.replace(/\/+$/, '') || ''
    }
    const basePath = stripTrailingSse(u.pathname)
    const originBase = basePath ? `${u.origin}${basePath}` : u.origin
    if (isSsePath) {
      out.push(`${originBase}/mcp`, `${originBase}/`, `${u.origin}/mcp`, `${u.origin}/`)
    } else {
      out.push(`${u.origin}/mcp`, `${originBase}/mcp`)
    }
  } catch {
    /* ignore */
  }
  return [...new Set(out.map((x) => (x.replace(/\/+$/, '') || x).trim()))]
}

/** 使用 MCP TypeScript SDK 连接并 `listTools`（含 initialize 协议握手） */
export async function listMcpToolNamesWithSdk(
  primaryUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<McpListToolsSdkResult> {
  const candidates = mcpToolsCandidateUrls(primaryUrl.trim())
  let lastErr = 'no candidates'
  const perAttemptMs = Math.min(Math.max(timeoutMs, 3000), 120_000)

  for (const urlStr of candidates) {
    let baseUrl: URL
    try {
      baseUrl = new URL(urlStr)
    } catch {
      continue
    }

    let transport: Transport | undefined
    try {
      const requestInit = requestInitForMcp(headers, perAttemptMs)
      const { client, transport: t, transportKind } = await connectClientWithStreamableThenSse(
        baseUrl,
        requestInit,
      )
      transport = t
      const listed = await client.listTools()
      const raw = listed.tools ?? []
      const tools: McpListedTool[] = []
      const toolNames: string[] = []
      for (const tool of raw) {
        const n = tool?.name
        if (typeof n !== 'string' || n.trim() === '') continue
        const name = n.trim()
        toolNames.push(name)
        tools.push({
          name,
          description: descriptionFromListedToolEntry(tool),
          inputSchema: tool.inputSchema ?? null,
        })
      }
      return { ok: true, toolNames, tools, transport: transportKind, attemptedUrl: urlStr }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    } finally {
      if (transport) {
        try {
          await transport.close()
        } catch {
          /* ignore */
        }
      }
    }
  }

  return {
    ok: false,
    toolNames: [],
    tools: [],
    error: lastErr.slice(0, 500),
    attemptedUrl: candidates[candidates.length - 1] ?? primaryUrl,
  }
}
