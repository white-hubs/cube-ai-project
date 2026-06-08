/**
 * web-search MCP 空结果判定（供 McpHandler 重试 general 前使用）。
 */
import { describe, test, expect } from 'bun:test';
import { webSearchMcpResultHasZeroResults } from './web-search-mcp-retry';

describe('webSearchMcpResultHasZeroResults', () => {
  test('Langflow 形状：content.text 为 count:0 results:[] → true', () => {
    const text = JSON.stringify({ query: 'q', count: 0, results: [] });
    expect(
      webSearchMcpResultHasZeroResults({
        content: [{ type: 'text', text }],
        isError: false,
      }),
    ).toBe(true);
  });

  test('有 results 条目 → false', () => {
    const text = JSON.stringify({
      query: 'q',
      count: 8,
      results: [{ title: 't', url: 'https://a', snippet: 's' }],
    });
    expect(
      webSearchMcpResultHasZeroResults({
        content: [{ type: 'text', text }],
        isError: false,
      }),
    ).toBe(false);
  });

  test('非 JSON / 无 web 搜索形状 → false', () => {
    expect(webSearchMcpResultHasZeroResults({ content: [{ type: 'text', text: 'hello' }] })).toBe(
      false,
    );
    expect(webSearchMcpResultHasZeroResults(null)).toBe(false);
  });
});
