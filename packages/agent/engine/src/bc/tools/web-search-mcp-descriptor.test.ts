/**
 * web-search MCP descriptor 引擎侧补充说明。
 */
import { describe, test, expect } from 'bun:test';
import { ToolDescriptor as ToolDescriptorZod } from '@cube-ai/contracts';
import { augmentWebSearchMcpToolDescriptor } from './web-search-mcp-descriptor';

const baseSchema = {
  type:       'object' as const,
  properties: {
    query: {
      type:        'string',
      description: '检索词',
    },
    categories: {
      type:        'string',
      enum:        ['news', 'general'],
      description: 'MCP 原始说明',
    },
  },
  required: ['query'],
};

describe('augmentWebSearchMcpToolDescriptor', () => {
  test('非 web-search server → 描述与 schema 不变', () => {
    const schema = { ...baseSchema };
    const out = augmentWebSearchMcpToolDescriptor({
      serverName:  'other',
      mcpToolName: 'web_search',
      description: 'x',
      inputSchema: schema,
    });
    expect(out.description).toBe('x');
    expect(out.inputSchema).toBe(schema);
  });

  test('web-search 但未列入增强名单的工具 → 不变', () => {
    const schema = { type: 'object' as const, properties: {} };
    const out = augmentWebSearchMcpToolDescriptor({
      serverName:  'web-search',
      mcpToolName: 'other_tool',
      description: 'y',
      inputSchema: schema,
    });
    expect(out.description).toBe('y');
    expect(out.inputSchema).toBe(schema);
  });

  test('web-search / web_search → 追加工具说明并合并 categories.description', () => {
    const out = augmentWebSearchMcpToolDescriptor({
      serverName:  'web-search',
      mcpToolName: 'web_search',
      description: '联网搜索。',
      inputSchema: { ...baseSchema },
    });
    expect(out.description).toContain('【引擎补充｜web_search】');
    expect(out.description).toContain('联网搜索。');
    expect(out.description.length).toBeLessThanOrEqual(2048);
    const cat = (out.inputSchema.properties as Record<string, unknown>)['categories'] as {
      description?: string;
    };
    expect(cat.description).toContain('MCP 原始说明');
    expect(cat.description).toContain('news：新闻垂类');

    const parsed = ToolDescriptorZod.safeParse({
      schemaVersion: 1,
      kind:          'TOOL',
      name:          'mcp.web-search.web_search',
      displayName:   'web_search',
      description:   out.description,
      isPreset:      false,
      version:       '1.0.0',
      meta: {
        execution:         'REMOTE',
        consent:           'NEVER',
        requiresPrincipal: 'USER',
        timeoutMs:         120_000,
        idempotent:        false,
        sideEffects:       [],
      },
      inputSchema:    out.inputSchema,
      outputSchema:     { type: 'object', properties: {} },
      requires:       { principal: 'USER', oauthScope: [], obo: null },
      execute:          'mcp:web-search:web_search',
      handler:          { kind: 'mcp', config: {} },
      tags:             ['mcp', 'web-search'],
      category:         'MCP',
    });
    expect(parsed.success).toBe(true);
  });

  test('超长 MCP 描述时仍满足 2048 封顶', () => {
    const long = 'a'.repeat(3000);
    const out = augmentWebSearchMcpToolDescriptor({
      serverName:  'web-search',
      mcpToolName: 'web_search',
      description: long,
      inputSchema: { ...baseSchema },
    });
    expect(out.description.length).toBeLessThanOrEqual(2048);
    expect(out.description).toContain('【引擎补充｜web_search】');
  });

  test('无 properties 键时仅增强顶层 description，不写 properties', () => {
    const schema = { type: 'object' as const };
    const out = augmentWebSearchMcpToolDescriptor({
      serverName:  'web-search',
      mcpToolName: 'web_search',
      description: '短',
      inputSchema: schema as Record<string, unknown>,
    });
    expect(out.description).toContain('【引擎补充｜web_search】');
    expect(out.inputSchema['properties']).toBeUndefined();
  });

  test('web-search / fetch_page → 追加说明并合并 url.description', () => {
    const schema = {
      type:       'object' as const,
      properties: {
        url: { type: 'string', format: 'uri', description: '页面 URL' },
      },
      required: ['url'],
    };
    const out = augmentWebSearchMcpToolDescriptor({
      serverName:  'web-search',
      mcpToolName: 'fetch_page',
      description: '抓取 HTML。',
      inputSchema: schema,
    });
    expect(out.description).toContain('【引擎补充｜fetch_page】');
    expect(out.description).toContain('抓取 HTML。');
    const url = (out.inputSchema.properties as Record<string, unknown>)['url'] as { description?: string };
    expect(url.description).toContain('页面 URL');
    expect(url.description).toContain('web_search 摘要');
  });
});
