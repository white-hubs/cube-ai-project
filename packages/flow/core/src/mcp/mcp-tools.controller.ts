import { ApiBody, ApiOperation, ApiResponse, BadRequestException, Body, Controller, POST } from '@dangao/bun-server'
import { MockableEndpoint } from '@cube-ai/ai-center/platform/server-mock'
import { listMcpToolNamesWithSdk } from './mcp-list-tools-sdk'

function asHeaderRecord(raw: Record<string, unknown> | undefined): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

/**
 * 代理枚举 MCP 工具：使用与 Langflow 一致的 `@modelcontextprotocol/sdk`
 *（Streamable HTTP → 失败再 SSE，`Client.initialize` + `listTools`）。
 */
@Controller('/mcp')
export class McpToolsController {
  /**
   * 枚举目标 MCP Server 的工具列表。
   *
   * @param body.url MCP 服务地址（必填）
   * @param body.headers 可选，请求头键值（仅 string 值生效）
   * @param body.timeoutMs 可选，超时毫秒，范围 3000~120000
   * @returns ok 是否成功；toolNames 工具名列表；tools 工具详情；error 失败原因；transport 实际连接协议
   */
  @POST('/tools-list')
  @ApiOperation({
    summary: '枚举 MCP 工具',
    description: '连接目标 MCP 服务并返回工具名称与输入 schema（优先 Streamable HTTP，失败后回退 SSE）。',
    operationId: 'listMcpTools',
  })
  @ApiBody({
    description: 'MCP 服务连接参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'MCP 服务 URL（必填）' },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: '可选，自定义请求头',
        },
        timeoutMs: { type: 'number', description: '可选，超时毫秒（3000~120000）' },
      },
      required: ['url'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '枚举结果',
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', description: '是否成功' },
        toolNames: { type: 'array', items: { type: 'string' }, description: '工具名列表' },
        tools: {
          type: 'array',
          description: '工具详情',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '工具名' },
              description: { type: 'string', description: '工具描述' },
              inputSchema: { description: '输入参数 schema（可能为空）', nullable: true },
            },
            required: ['name', 'description'],
          },
        },
        attemptedUrl: { type: 'string', description: '实际尝试连接的 URL' },
        transport: { type: 'string', description: '成功时实际使用的传输协议' },
        error: { type: 'string', description: '失败原因（仅 ok=false 时出现）' },
      },
      required: ['ok', 'toolNames', 'tools', 'attemptedUrl'],
    } as Record<string, unknown>,
  })
  @MockableEndpoint('mcp.toolsList')
  async listTools(
    @Body()
    body: {
      url?: string | null
      headers?: Record<string, unknown> | null
      timeoutMs?: number | null
    },
  ) {
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) throw new BadRequestException('url is required')
    const hdrs = asHeaderRecord(body.headers ?? undefined)
    let timeoutMs = typeof body.timeoutMs === 'number' && Number.isFinite(body.timeoutMs) ? body.timeoutMs : 15_000
    timeoutMs = Math.min(Math.max(timeoutMs, 3000), 120_000)

    const result = await listMcpToolNamesWithSdk(url, hdrs, timeoutMs)
    if (!result.ok) {
      return {
        ok: false as const,
        toolNames: [] as string[],
        tools: [] as { name: string; description: string; inputSchema: unknown | null }[],
        error: result.error,
        attemptedUrl: result.attemptedUrl,
      }
    }
    return {
      ok: true as const,
      toolNames: result.toolNames,
      tools: result.tools,
      attemptedUrl: result.attemptedUrl,
      transport: result.transport,
    }
  }
}
