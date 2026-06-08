import { describe, expect, it } from 'bun:test';
import type {
  ObservabilityEmitter,
  SemanticRetrievalFacade,
  ToolActivationContext,
  ToolDescriptor,
} from '@tachu/core';
import { SemanticToolStrategy } from './semantic-tool.strategy';

const noopObservability = {
  emit() {},
  on() {
    return () => {};
  },
  off() {},
  setMasker() {},
} as ObservabilityEmitter;

function makeTool(name: string): ToolDescriptor {
  return {
    kind: 'tool',
    name,
    description: `Tool ${name} for charts and visualization`,
    sideEffect: 'readonly',
    idempotent: true,
    requiresApproval: false,
    timeout: 30_000,
    inputSchema: {},
    execute: 'noop',
  };
}

function baseCtx(
  overrides: Partial<ToolActivationContext> & Pick<ToolActivationContext, 'query' | 'agentVisibleTools'>,
): ToolActivationContext {
  return {
    registry: { list: () => [] },
    observability: noopObservability,
    signal: AbortSignal.timeout(1000),
    correlation: { traceId: 't', requestId: 't', sessionId: 's', turnId: 't' },
    ...overrides,
  } as ToolActivationContext;
}

describe('SemanticToolStrategy', () => {
  it('returns empty when semanticRetrieval is not wired', async () => {
    const strategy = new SemanticToolStrategy(() => ({
      enabled: true,
      flows: [{ toolName: 'flow.a', priority: 1, keywords: ['x'] }],
    }));
    const hits = await strategy.score(
      baseCtx({
        query: '图表',
        agentVisibleTools: [makeTool('flow.a')],
      }),
    );
    expect(hits).toEqual([]);
  });

  it('skips flow tools already visible from keyword routing (γ)', async () => {
    const facade: SemanticRetrievalFacade = {
      async retrieve() {
        throw new Error('should not embed when keyword already routed');
      },
    };
    const strategy = new SemanticToolStrategy(() => ({
      enabled: true,
      flows: [{ toolName: 'flow.a', priority: 1, keywords: ['退款'] }],
    }));
    const hits = await strategy.score(
      baseCtx({
        query: '我要退款',
        agentVisibleTools: [makeTool('flow.a'), makeTool('other.tool')],
        semanticRetrieval: facade,
      }),
    );
    expect(hits).toEqual([]);
  });

  it('returns embedding scores for flow tools missed by keyword routing', async () => {
    const facade: SemanticRetrievalFacade = {
      async retrieve(request) {
        expect(request.caller).toBe('tool');
        expect(request.namespace).toBe('intent-flow');
        expect(request.corpus).toEqual([
          {
            id: 'flow.chart',
            text: expect.stringContaining('chart'),
          },
        ]);
        return {
          caller: 'tool',
          namespace: 'intent-flow',
          strategy: 'embedding_runtime',
          hits: [{ id: 'flow.chart', score: 0.91 }],
          degraded: false,
        };
      },
    };
    const strategy = new SemanticToolStrategy(() => ({
      enabled: true,
      flows: [{ toolName: 'flow.chart', priority: 1, keywords: ['发票'] }],
    }));
    const hits = await strategy.score(
      baseCtx({
        query: '帮我画几个图表',
        agentVisibleTools: [makeTool('flow.chart')],
        semanticRetrieval: facade,
      }),
    );
    expect(hits).toEqual([
      {
        toolName: 'flow.chart',
        score: 0.91,
        reason: 'embedding:0.910',
      },
    ]);
  });
});
