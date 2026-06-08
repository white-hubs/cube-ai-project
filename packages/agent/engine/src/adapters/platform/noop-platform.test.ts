import { describe, expect, it } from 'bun:test';
import {
  AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN,
  AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN,
  AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN,
} from '@cube-ai/contracts/platform';
import type { FlowCatalogPort, FlowInvokerPort, KnowledgeQueryPort } from '@cube-ai/contracts';
import { NoopFlowCatalogPort } from './noop-flow-catalog';
import { NoopFlowInvokerPort } from './noop-flow-invoker';
import { NoopKnowledgeQueryPort } from './noop-knowledge-query';

describe('noop platform ports', () => {
  it('flow invoker returns PLATFORM_FLOW_NOT_CONNECTED', async () => {
    const port: FlowInvokerPort = new NoopFlowInvokerPort();
    let code: string | undefined;
    try {
      await port.invoke(
        { tenant: 1, flowId: 'f1', traceId: 't1' },
        new AbortController().signal,
      );
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('PLATFORM_FLOW_NOT_CONNECTED');
  });

  it('flow catalog returns PLATFORM_FLOW_NOT_CONNECTED', async () => {
    const port: FlowCatalogPort = new NoopFlowCatalogPort();
    let code: string | undefined;
    try {
      await port.list({ tenant: 1, traceId: 't1' }, new AbortController().signal);
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('PLATFORM_FLOW_NOT_CONNECTED');
  });

  it('knowledge query returns PLATFORM_KNOWLEDGE_NOT_CONNECTED', async () => {
    const port: KnowledgeQueryPort = new NoopKnowledgeQueryPort();
    let code: string | undefined;
    try {
      await port.query(
        { tenant: 1, query: 'hello', traceId: 't1', topK: 5, scoreThreshold: 0.3 },
        new AbortController().signal,
      );
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('PLATFORM_KNOWLEDGE_NOT_CONNECTED');
  });

  it('exports DI tokens for assembler wiring', () => {
    expect(String(AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN)).toContain(
      'agentic.adapter.platform.flowInvoker',
    );
    expect(String(AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN)).toContain(
      'agentic.adapter.platform.flowCatalog',
    );
    expect(String(AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN)).toContain(
      'agentic.adapter.platform.knowledgeQuery',
    );
  });
});
