import { MockRegistry } from '@cube-ai/ai-center/platform/server-mock'

MockRegistry.getInstance().define(
  'mcp.toolsList',
  false,
  () => ({
    ok: true as const,
    toolNames: [] as string[],
    tools: [] as { name: string; description: string; inputSchema: unknown | null }[],
    attemptedUrl: 'mock://mcp',
    transport: 'streamable-http' as const,
  }),
)
