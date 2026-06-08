import { describe, expect, test } from 'bun:test'
import type { CubeFlowGraph } from '../contracts/cube-flow'
import type { LangflowClient } from './langflow-client'
import {
  cubeMcpServerToLangflowMcpInputValue,
  cubeMcpServerToLfRegistration,
  isLangflowMcpInputServerValue,
  normalizeGraphMcpServersForLangflowPush,
} from './lf-mcp-server-sync'

describe('lf-mcp-server-sync', () => {
  test('cubeMcpServerToLfRegistration: string name', () => {
    expect(cubeMcpServerToLfRegistration('lf-starter_project')).toEqual({
      lfName: 'lf-starter_project',
      lfBody: {},
    })
  })

  test('cubeMcpServerToLfRegistration: legacy name + config', () => {
    expect(
      cubeMcpServerToLfRegistration({
        name: 'my-svc',
        config: { url: 'http://h/mcp', headers: { a: 'b' } },
      }),
    ).toEqual({
      lfName: 'my-svc',
      lfBody: { url: 'http://h/mcp', headers: { a: 'b' } },
    })
  })

  test('cubeMcpServerToLfRegistration: name + bizData (flow export shape after config→bizData)', () => {
    expect(
      cubeMcpServerToLfRegistration({
        name: 'my-svc',
        bizData: { url: 'http://h/sse', timeout: 5000 },
      }),
    ).toEqual({
      lfName: 'my-svc',
      lfBody: { url: 'http://h/sse', timeout: 5000 },
    })
  })

  test('cubeMcpServerToLfRegistration: cube bucket shape', () => {
    expect(
      cubeMcpServerToLfRegistration({
        bizData: {
          url: 'http://192.168.0.1/sse/',
          headers: {},
          timeout: 5000,
        },
      }),
    ).toEqual({
      lfName: 'bizData',
      lfBody: {
        url: 'http://192.168.0.1/sse/',
        timeout: 5000,
      },
    })
  })

  test('cubeMcpServerToLfRegistration: service-first bucket (mcpPayloadFromService)', () => {
    expect(
      cubeMcpServerToLfRegistration({
        AlarmSvc: {
          url: 'http://x/sse',
          headers: { Authorization: 'Bearer t' },
        },
      }),
    ).toEqual({
      lfName: 'AlarmSvc',
      lfBody: {
        url: 'http://x/sse',
        headers: { Authorization: 'Bearer t' },
      },
    })
  })

  test('cubeMcpServerToLfRegistration: empty', () => {
    expect(cubeMcpServerToLfRegistration(null)).toBeNull()
    expect(cubeMcpServerToLfRegistration({})).toBeNull()
  })

  test('cubeMcpServerToLfRegistration: endpoint maps to url in lfBody', () => {
    expect(
      cubeMcpServerToLfRegistration({
        Svc: { endpoint: 'http://host/sse' },
      }),
    ).toEqual({
      lfName: 'Svc',
      lfBody: { url: 'http://host/sse' },
    })
  })

  test('cubeMcpServerToLangflowMcpInputValue: bizData bucket → name + config', () => {
    expect(
      cubeMcpServerToLangflowMcpInputValue(
        {
          bizData: {
            url: 'http://192.168.0.194:8002/sse/',
            headers: {},
            timeout: 50,
            sse_read_timeout: 50,
          },
        },
        true,
      ),
    ).toEqual({
      name: 'bizData',
      config: {
        url: 'http://192.168.0.194:8002/sse/',
        timeout: 50,
        sse_read_timeout: 50,
        verify_ssl: true,
      },
    })
  })

  test('isLangflowMcpInputServerValue', () => {
    expect(isLangflowMcpInputServerValue({ name: 'bizData', config: { url: 'http://x' } })).toBe(true)
    expect(isLangflowMcpInputServerValue({ name: 'bizData' })).toBe(true)
    expect(isLangflowMcpInputServerValue({ bizData: { url: 'http://x' } })).toBe(false)
  })

  test('normalizeGraphMcpServersForLangflowPush keeps name+config on clone for LF PATCH', async () => {
    const lf = {
      addMcpV2Server: async () => {},
    } as unknown as LangflowClient
    const graph: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'cell-1',
          lfNodeId: 'MCPTools-1',
          cubeType: 'cube.lf.MCPTools',
          x: 0,
          y: 0,
          width: 320,
          height: 400,
          config: {
            mcp_server: { bizData: { url: 'http://192.168.0.1/sse/', timeout: 50 } },
            verify_ssl: true,
          },
        },
      ],
      edges: [],
    }
    const out = await normalizeGraphMcpServersForLangflowPush(lf, graph)
    const ms = out.nodes[0]!.config['mcp_server'] as Record<string, unknown>
    expect(ms['name']).toBe('bizData')
    expect(ms['config']).toEqual({
      url: 'http://192.168.0.1/sse/',
      timeout: 50,
      verify_ssl: true,
    })
  })
})
