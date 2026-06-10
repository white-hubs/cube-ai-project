/**
 * McpBridgeService 单测。
 */
import { describe, test, expect } from 'bun:test';
import { McpBridgeService } from './mcp-bridge.service';
import { AgenticEngineError } from '../../infra/errors/agentic-error';

interface CapturedJsonRpc {
  id?: number | string;
  method: string;
  params?: unknown;
}

function installFakeMcpSseFetch(): {
  url: string;
  requests: CapturedJsonRpc[];
  stop: () => void;
} {
  const enc = new TextEncoder();
  const requests: CapturedJsonRpc[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const originalFetch = globalThis.fetch;

  const send = (event: string, data: unknown) => {
    const raw = typeof data === 'string' ? data : JSON.stringify(data);
    controller?.enqueue(enc.encode(`event: ${event}\ndata: ${raw}\n\n`));
  };

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    if (url.origin === 'http://fake-mcp.test' && url.pathname === '/sse') {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
            queueMicrotask(() => send('endpoint', '/messages?sessionId=test-session'));
          },
          cancel() {
            controller = null;
          },
        }),
        {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
          },
        },
      );
    }

    if (
      url.origin === 'http://fake-mcp.test' &&
      url.pathname === '/messages' &&
      req.method === 'POST'
    ) {
      const msg = (await req.json()) as CapturedJsonRpc;
      requests.push(msg);
      if (msg.method === 'initialize') {
        send('message', {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'fake-search', version: '1.0.0' },
          },
        });
      } else if (msg.method === 'tools/list') {
        send('message', {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [
              {
                name: 'search',
                description: 'Search the web',
                inputSchema: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                  required: ['query'],
                },
              },
            ],
          },
        });
      } else if (msg.method === 'tools/call') {
        const params = msg.params as { arguments?: { query?: string } } | undefined;
        send('message', {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            results: [{ title: `result:${params?.arguments?.query ?? ''}` }],
          },
        });
      }
      return new Response('', { status: 202 });
    }

    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  return {
    url: 'http://fake-mcp.test/sse',
    requests,
    stop: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function installFakeMcpHttpFetch(): {
  url: string;
  requests: CapturedJsonRpc[];
  stop: () => void;
} {
  const requests: CapturedJsonRpc[] = [];
  const originalFetch = globalThis.fetch;

  const sseResponse = (data: unknown) => {
    const raw = typeof data === 'string' ? data : JSON.stringify(data);
    return new Response(`event: message\ndata: ${raw}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    if (
      url.origin === 'http://fake-mcp-http.test' &&
      (url.pathname === '/mcp' || url.pathname === '/mcp/') &&
      req.method === 'POST'
    ) {
      const msg = (await req.json()) as CapturedJsonRpc;
      requests.push(msg);
      if (msg.method === 'initialize') {
        return sseResponse({
          jsonrpc: '2.0',
          id:      msg.id,
          result:  {
            protocolVersion: '2024-11-05',
            capabilities:    {},
            serverInfo:      { name: 'fake-ontology', version: '1.0.0' },
          },
        });
      }
      if (msg.method === 'notifications/initialized') {
        return new Response('', { status: 202 });
      }
      if (msg.method === 'tools/list') {
        return sseResponse({
          jsonrpc: '2.0',
          id:      msg.id,
          result:  {
            tools: [
              {
                name:        'search_ontology',
                description: 'Search ontology by keyword',
                inputSchema: {
                  type:       'object',
                  properties: { keyword: { type: 'string' } },
                  required:   ['keyword'],
                },
              },
            ],
          },
        });
      }
      if (msg.method === 'tools/call') {
        const params = msg.params as { arguments?: { keyword?: string } } | undefined;
        return sseResponse({
          jsonrpc: '2.0',
          id:      msg.id,
          result:  {
            entities: [{ name: `entity:${params?.arguments?.keyword ?? ''}` }],
          },
        });
      }
    }

    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  return {
    url: 'http://fake-mcp-http.test/mcp',
    requests,
    stop: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

/** 模拟有状态 Streamable HTTP MCP（官方 python SDK）：initialize 下发 mcp-session-id，后续请求缺失则 400。 */
function installFakeMcpHttpStatefulFetch(): {
  url: string;
  requests: CapturedJsonRpc[];
  sessionHeaders: (string | null)[];
  stop: () => void;
} {
  const SESSION_ID = 'sess-stateful-123';
  const requests: CapturedJsonRpc[] = [];
  const sessionHeaders: (string | null)[] = [];
  const originalFetch = globalThis.fetch;

  const sseResponse = (data: unknown, extraHeaders: Record<string, string> = {}) =>
    new Response(`event: message\ndata: ${JSON.stringify(data)}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', ...extraHeaders },
    });

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    if (
      url.origin === 'http://fake-mcp-stateful.test' &&
      url.pathname === '/mcp' &&
      req.method === 'POST'
    ) {
      const sidHeader = req.headers.get('mcp-session-id');
      sessionHeaders.push(sidHeader);
      const msg = (await req.json()) as CapturedJsonRpc;
      requests.push(msg);
      if (msg.method === 'initialize') {
        return sseResponse(
          {
            jsonrpc: '2.0',
            id:      msg.id,
            result:  {
              protocolVersion: '2024-11-05',
              capabilities:    {},
              serverInfo:      { name: 'fake-stateful', version: '1.0.0' },
            },
          },
          { 'mcp-session-id': SESSION_ID },
        );
      }
      if (sidHeader !== SESSION_ID) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id:      'server-error',
            error:   { code: -32600, message: 'Bad Request: Missing session ID' },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      if (msg.method === 'notifications/initialized') {
        return new Response('', { status: 202 });
      }
      if (msg.method === 'tools/list') {
        return sseResponse({
          jsonrpc: '2.0',
          id:      msg.id,
          result:  {
            tools: [
              {
                name:        'web_search',
                description: '联网搜索',
                inputSchema: {
                  type:       'object',
                  properties: { query: { type: 'string' } },
                  required:   ['query'],
                },
              },
            ],
          },
        });
      }
      if (msg.method === 'tools/call') {
        const params = msg.params as { arguments?: { query?: string } } | undefined;
        return sseResponse({
          jsonrpc: '2.0',
          id:      msg.id,
          result:  { results: [{ title: `hit:${params?.arguments?.query ?? ''}` }] },
        });
      }
    }

    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  return {
    url: 'http://fake-mcp-stateful.test/mcp',
    requests,
    sessionHeaders,
    stop: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe('McpBridgeService', () => {
  test('未配置 MCP → listTools 返回 []', async () => {
    const bridge = new McpBridgeService();
    await bridge.init();
    const tools = await bridge.listTools();
    expect(tools).toEqual([]);
  });

  test('未配置 server → callTool 抛出 RESOURCE_NOT_FOUND_DESCRIPTOR', async () => {
    const bridge = new McpBridgeService();
    await bridge.init();
    await expect(
      bridge.callTool('missing-server', 'tool', {}),
    ).rejects.toThrow(AgenticEngineError);
  });

  test('callTool 重试后仍失败 → UPSTREAM_MCP_TOOL_FAILED', async () => {
    const bridge = new McpBridgeService();
    await bridge.init({
      mcpServers: {
        bad: {
          type:    'stdio',
          command: '/bin/this-binary-does-not-exist-xyz',
          enabled: true,
        },
      },
    });
    await expect(bridge.callTool('bad', 'x', {})).rejects.toMatchObject({
      code: 'UPSTREAM_MCP_TOOL_FAILED',
    });
  });

  test('SSE MCP server → listTools 生成 descriptor，callTool 通过 SSE endpoint 返回结果', async () => {
    const fake = installFakeMcpSseFetch();
    const bridge = new McpBridgeService();
    try {
      await bridge.init({
        mcpServers: {
          'web-search': {
            type: 'sse',
            url: fake.url,
            enabled: true,
          },
        },
      });

      const tools = await bridge.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        name: 'mcp.web-search.search',
        execute: 'mcp:web-search:search',
        handler: { kind: 'mcp' },
        category: 'MCP',
        meta: { consent: 'NEVER' },
      });

      const out = await bridge.callTool('web-search', 'search', { query: 'cube ai' });
      expect(out).toEqual({ results: [{ title: 'result:cube ai' }] });
      expect(fake.requests.map((r) => r.method)).toEqual([
        'initialize',
        'notifications/initialized',
        'tools/list',
        'tools/call',
      ]);
    } finally {
      await bridge.dispose();
      fake.stop();
    }
  });

  test('Streamable HTTP MCP server → listTools 生成 descriptor', async () => {
    const fake = installFakeMcpHttpFetch();
    const bridge = new McpBridgeService();
    try {
      await bridge.init({
        mcpServers: {
          'biz-ontology': {
            type:    'http',
            url:     fake.url,
            enabled: true,
          },
        },
      });

      const tools = await bridge.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        name:     'mcp.biz-ontology.search_ontology',
        execute:  'mcp:biz-ontology:search_ontology',
        handler:  { kind: 'mcp' },
        category: 'MCP',
        meta:     { consent: 'ON_FIRST_USE' },
      });
    } finally {
      await bridge.dispose();
      fake.stop();
    }
  });

  test('config 显式 consent=NEVER → descriptor.meta.consent 为 NEVER（免授权）', async () => {
    const fake = installFakeMcpHttpFetch();
    const bridge = new McpBridgeService();
    try {
      await bridge.init({
        mcpServers: {
          'biz-ontology': {
            type:    'http',
            url:     fake.url,
            consent: 'NEVER',
            enabled: true,
          },
        },
      });

      const tools = await bridge.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        name: 'mcp.biz-ontology.search_ontology',
        meta: { consent: 'NEVER' },
      });
    } finally {
      await bridge.dispose();
      fake.stop();
    }
  });

  test('Streamable HTTP MCP server → callTool 通过单端点 POST 返回结果', async () => {
    const fake = installFakeMcpHttpFetch();
    const bridge = new McpBridgeService();
    try {
      await bridge.init({
        mcpServers: {
          'biz-ontology': {
            type:    'http',
            url:     fake.url,
            enabled: true,
          },
        },
      });

      const out = await bridge.callTool('biz-ontology', 'search_ontology', {
        keyword: 'AlarmRecord',
      });
      expect(out).toEqual({ entities: [{ name: 'entity:AlarmRecord' }] });
      expect(fake.requests.map((r) => r.method)).toEqual([
        'initialize',
        'notifications/initialized',
        'tools/call',
      ]);
    } finally {
      await bridge.dispose();
      fake.stop();
    }
  });

  test('有状态 HTTP MCP（mcp-session-id）→ 透传 session 后 listTools/callTool 成功', async () => {
    const fake = installFakeMcpHttpStatefulFetch();
    const bridge = new McpBridgeService();
    try {
      await bridge.init({
        mcpServers: {
          'web-search': {
            type:    'http',
            url:     fake.url,
            enabled: true,
          },
        },
      });

      const tools = await bridge.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        name: 'mcp.web-search.web_search',
        meta: { consent: 'NEVER' },
      });

      const out = await bridge.callTool('web-search', 'web_search', { query: 'news' });
      expect(out).toEqual({ results: [{ title: 'hit:news' }] });

      // initialize 不带 session；下发后续每个请求都回传同一 session id。
      expect(fake.sessionHeaders[0]).toBeNull();
      expect(fake.sessionHeaders.slice(1).every((h) => h === 'sess-stateful-123')).toBe(true);
    } finally {
      await bridge.dispose();
      fake.stop();
    }
  });
});
