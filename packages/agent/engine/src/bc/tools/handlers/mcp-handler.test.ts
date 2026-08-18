/**
 * McpHandler — web_search 重试等行为。
 */
import { describe, test, expect } from 'bun:test';
import { McpHandler, type McpHandlerInput } from './mcp-handler';
import type { ToolHandlerCtx } from '../tool-context';

const minimalCtx: ToolHandlerCtx = {
  traceId: 't',
  signal:  new AbortController().signal,
  auth:    { tenant: 1 },
  session: { id: 's', turnId: 'u' },
};

class RecordingBridge {
  calls: Array<[string, string, Record<string, unknown>]> = [];

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push([serverId, toolName, args]);
    const cat = String(args['categories'] ?? '').toLowerCase();
    if (toolName === 'web_search' && cat === 'news') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ query: args['query'], count: 0, results: [] }),
          },
        ],
        isError: false,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query:   args['query'],
            count:   1,
            results: [{ title: 'hit', url: 'https://example.com', snippet: 'x' }],
          }),
        },
      ],
      isError: false,
    };
  }
}

describe('McpHandler', () => {
  test('web-search / web_search / news 且 MCP 空结果 → bridge.callTool 第二次 categories=general', async () => {
    const bridge = new RecordingBridge();
    const handler = new McpHandler(bridge as never);
    const input: McpHandlerInput = {
      serverId:  'web-search',
      toolName:  'web_search',
      arguments: {
        query:      '今日',
        count:      8,
        time_range: 'day',
        language:   'zh-CN',
        categories: 'news',
      },
    };
    const out = await handler.invoke(input, minimalCtx);
    expect(bridge.calls).toHaveLength(2);
    expect(bridge.calls[0]?.[2]['categories']).toBe('news');
    expect(bridge.calls[1]?.[2]['categories']).toBe('general');
    expect(bridge.calls[1]?.[2]['query']).toBe('今日');
    const text = (out as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
    expect(text).toContain('"count":1');
  });

  test('categories 已为 general → 单次 callTool', async () => {
    const bridge = new RecordingBridge();
    const handler = new McpHandler(bridge as never);
    await handler.invoke(
      {
        serverId:  'web-search',
        toolName:  'web_search',
        arguments: { query: 'x', categories: 'general' },
      },
      minimalCtx,
    );
    expect(bridge.calls).toHaveLength(1);
  });

  test('其它 MCP 工具 → 不做 web_search 重试逻辑', async () => {
    const bridge = new RecordingBridge();
    const handler = new McpHandler(bridge as never);
    await handler.invoke(
      {
        serverId:  'web-search',
        toolName:  'search',
        arguments: { query: 'q', categories: 'news' },
      },
      minimalCtx,
    );
    expect(bridge.calls).toHaveLength(1);
  });

  test('biz-ontology 旧 query_database 工具 fail-closed，不调用 bridge', async () => {
    const bridge = new RecordingBridge();
    const handler = new McpHandler(bridge as never);

    await expect(
      handler.invoke(
        {
          serverId: 'biz-ontology',
          toolName: 'query_database',
          arguments: { connection: '风险管控', sql: 'SELECT * FROM ai_x' },
        },
        minimalCtx,
      ),
    ).rejects.toThrow('mcp.biz-ontology.ask_business_data');
    expect(bridge.calls).toHaveLength(0);
  });
});
