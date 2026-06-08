import { describe, expect, it } from 'bun:test'
import { mcpListTransportParamsFromLfMcpTemplate } from './lf-mcp-tool-options-enrich'

describe('mcpListTransportParamsFromLfMcpTemplate', () => {
  it('parses stream URL, headers, and timeout seconds', () => {
    const tpl = {
      mcp_server: {
        value: {
          name: 'demo',
          config: {
            url: 'https://mcp.example/sse',
            timeout: 50,
            headers: {
              'X-Auth': 'secret',
            },
          },
        },
      },
    }
    const p = mcpListTransportParamsFromLfMcpTemplate(tpl)
    expect(p).not.toBeNull()
    expect(p!.url).toBe('https://mcp.example/sse')
    expect(p!.headers).toEqual({ 'X-Auth': 'secret' })
    expect(p!.timeoutMs).toBe(50_000)
  })

  it('returns null without url (stdio / empty)', () => {
    expect(
      mcpListTransportParamsFromLfMcpTemplate({
        mcp_server: { value: { name: 's', config: { command: 'npx' } } },
      }),
    ).toBeNull()
    expect(mcpListTransportParamsFromLfMcpTemplate({})).toBeNull()
  })

  it('uses millisecond timeout when value is large', () => {
    const p = mcpListTransportParamsFromLfMcpTemplate({
      mcp_server: {
        value: {
          config: {
            url: 'http://localhost/mcp',
            timeout: 45_000,
          },
        },
      },
    })
    expect(p).not.toBeNull()
    expect(p!.timeoutMs).toBe(45_000)
  })
})
