import { describe, expect, it } from 'bun:test';
import * as platform from './index';

describe('contracts/platform skeleton', () => {
  it('exports the four Port symbol token names exactly', () => {
    expect(typeof platform.AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN).toBe('symbol');
    expect(typeof platform.AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN).toBe('symbol');
    expect(typeof platform.AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN).toBe('symbol');
    expect(typeof platform.AGENTIC_PLATFORM_LLM_CATALOG_TOKEN).toBe('symbol');
  });

  it('uses Symbol.for so engine and adapters share the same registry slot', () => {
    expect(platform.AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN.description).toBe(
      'agentic.adapter.platform.flowInvoker',
    );
    expect(platform.AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN.description).toBe(
      'agentic.adapter.platform.flowCatalog',
    );
    expect(platform.AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN.description).toBe(
      'agentic.adapter.platform.knowledgeQuery',
    );
    expect(platform.AGENTIC_PLATFORM_LLM_CATALOG_TOKEN.description).toBe(
      'agentic.adapter.platform.llmCatalog',
    );
  });
});
