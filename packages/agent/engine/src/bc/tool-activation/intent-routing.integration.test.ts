import { describe, expect, test } from 'bun:test';
import { ToolDescriptor } from '@cube-ai/contracts';
import type {
  AdapterCallContext,
  ChatRequest,
  ChatResponse,
  ObservabilityEmitter,
  ProviderAdapter,
  StreamChunk,
} from '@tachu/core';
import type { DescriptorRegistryService } from '../descriptor/descriptor-registry.service';
import { SkillRegistryService } from '../descriptor/skill-registry.service';
import { InMemoryStore } from '@cube-ai/agent-engine/adapters/memory';
import { EngineFactory } from '../tachu/engine-factory';
import { createTurnContextHolder } from '../tachu/turn-context-holder';

function testEngineFactory(
  provider: ProviderAdapter,
  observability?: ObservabilityEmitter,
  descriptorRegistry?: DescriptorRegistryService,
  skillRegistry?: SkillRegistryService,
): EngineFactory {
  return new EngineFactory(
    provider,
    observability,
    new InMemoryStore(),
    createTurnContextHolder(),
    descriptorRegistry,
    undefined,
    skillRegistry,
  );
}

function createCaptureProvider(): ProviderAdapter & {
  capturedEmbedModels: readonly string[];
} {
  const capturedEmbedModels: string[] = [];
  const provider: ProviderAdapter = {
    id: 'agentic-platform-llm-catalog',
    name: 'CaptureProvider',
    async listAvailableModels() {
      return [];
    },
    async chat(request: ChatRequest, _ctx: AdapterCallContext): Promise<ChatResponse> {
      return {
        content: 'ok',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    },
    async *chatStream(request: ChatRequest, _ctx: AdapterCallContext) {
      yield { type: 'text-delta', delta: 'ok' } as const;
      yield {
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      } as const;
    },
    async embed(request, _ctx) {
      capturedEmbedModels.push(request.model);
      return {
        embeddings: request.inputs.map((_input, index) =>
          index === 0 ? [1, 0, 0] : [0.99, 0.01, 0],
        ),
      };
    },
  };
  return Object.assign(provider, {
    get capturedEmbedModels(): readonly string[] {
      return capturedEmbedModels;
    },
  });
}

/** Intent phase returns complex so planning runs ToolActivator. */
function createComplexIntentProvider(): ProviderAdapter {
  let llmCalls = 0;
  const provider: ProviderAdapter = {
    id: 'agentic-platform-llm-catalog',
    name: 'ComplexIntentProvider',
    async listAvailableModels() {
      return [];
    },
    async chat(_request: ChatRequest, _ctx: AdapterCallContext): Promise<ChatResponse> {
      llmCalls += 1;
      if (llmCalls === 1) {
        return {
          content: JSON.stringify({
            complexity: 'complex',
            intent: '需要调用工具',
            contextRelevance: 'related',
          }),
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      return {
        content: 'done',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    },
    async *chatStream(request: ChatRequest, ctx: AdapterCallContext) {
      const r = await provider.chat!(request, ctx);
      if (typeof r.content === 'string') {
        yield { type: 'text-delta', delta: r.content } as const;
      }
      yield {
        type: 'finish',
        finishReason: 'stop',
        usage: r.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      } as const;
    },
    async embed(request, _ctx) {
      return {
        embeddings: request.inputs.map((_input, index) =>
          index === 0 ? [1, 0, 0] : [0.99, 0.01, 0],
        ),
      };
    },
  };
  return provider;
}

function makeFlowInvokeTool(): ReturnType<typeof ToolDescriptor.parse> {
  return ToolDescriptor.parse({
    schemaVersion: 1,
    kind: 'TOOL',
    name: 'platform.flow.invoke',
    displayName: '流程调用',
    description: '数据可视化与图表生成流程调用',
    isPreset: true,
    version: '1.0.0',
    meta: {
      execution: 'LOCAL',
      consent: 'NEVER',
      requiresPrincipal: 'USER',
      timeoutMs: 60_000,
      idempotent: false,
      sideEffects: ['network:flow'],
    },
    inputSchema: {
      type: 'object',
      required: ['flowId'],
      properties: { flowId: { type: 'string' } },
    },
    outputSchema: {
      type: 'object',
      required: ['result'],
      properties: { result: { type: 'object' } },
    },
    requires: { principal: 'USER', oauthScope: [], obo: null },
    execute: 'builtin:platform.flow.invoke',
  });
}

function makeKnowledgeQueryTool(): ReturnType<typeof ToolDescriptor.parse> {
  return ToolDescriptor.parse({
    schemaVersion: 1,
    kind: 'TOOL',
    name: 'platform.knowledge.query',
    displayName: '知识库查询',
    description: '查询知识库片段',
    isPreset: true,
    version: '1.0.0',
    meta: {
      execution: 'LOCAL',
      consent: 'NEVER',
      requiresPrincipal: 'USER',
      timeoutMs: 30_000,
      idempotent: true,
      sideEffects: [],
    },
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' } },
    },
    outputSchema: {
      type: 'object',
      required: ['hits'],
      properties: { hits: { type: 'array' } },
    },
    requires: { principal: 'USER', oauthScope: [], obo: null },
    execute: 'builtin:platform.knowledge.query',
  });
}

function mockToolRegistry(
  tools: ReturnType<typeof ToolDescriptor.parse>[],
): DescriptorRegistryService {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    listAll: () => [...byName.values()],
    resolve: (name: string) => byName.get(name),
  } as unknown as DescriptorRegistryService;
}

async function drain(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of stream) {
    out.push(chunk);
    if (chunk.type === 'error') throw chunk.error;
  }
  return out;
}

function collectToolActivation(observability: ObservabilityEmitter) {
  const events: Array<{ visibleTools?: string[] }> = [];
  const wrapped: ObservabilityEmitter = {
    on() {
      return () => {};
    },
    off() {},
    emit(ev) {
      if (ev.type === 'tool_activation') {
        events.push(ev.payload as { visibleTools?: string[] });
      }
    },
    setMasker() {},
  };
  return { events, observability: wrapped };
}

describe('intent routing integration (EngineFactory + ToolActivator)', () => {
  test('intentRouting.enabled=false exposes all mirrored tools despite non-matching flow keywords', async () => {
    const invoke = makeFlowInvokeTool();
    const knowledge = makeKnowledgeQueryTool();
    const registry = mockToolRegistry([invoke, knowledge]);
    const { events, observability } = collectToolActivation({
      on() {
        return () => {};
      },
      off() {},
      emit() {},
      setMasker() {},
    });

    const factory = testEngineFactory(createComplexIntentProvider(), observability, registry);
    await drain(
      factory.runStream({
        sessionId: 'SESSION-IR-DISABLED',
        turnId: '2054102360564695101',
        tenant: 1,
        prompt: '随便聊聊',
        agentSnapshot: {
          agent: {
            content: {
              prompt: 'sys',
              toolRefs: ['platform.flow.invoke', 'platform.knowledge.query'],
              intentRouting: {
                enabled: false,
                flows: [
                  {
                    toolName: 'platform.flow.invoke',
                    priority: 1,
                    keywords: ['never-match-keyword'],
                  },
                ],
              },
            },
          },
        },
      }),
    );

    // toolRoutingDisabled bypasses strategies and does not emit tool_activation; assert mirrored registry.
    const mirrored = (
      factory as unknown as { tachuRegistry: { list: (k: 'tool') => Array<{ name: string }> } }
    ).tachuRegistry
      .list('tool')
      .map((t) => t.name);
    expect(mirrored).toContain('platform.flow.invoke');
    expect(mirrored).toContain('platform.knowledge.query');
  });

  test('intentRouting.enabled=true with no keyword hit can re-surface flow tools via semantic routing', async () => {
    const invoke = makeFlowInvokeTool();
    const knowledge = makeKnowledgeQueryTool();
    const registry = mockToolRegistry([invoke, knowledge]);
    const { events, observability } = collectToolActivation({
      on() {
        return () => {};
      },
      off() {},
      emit() {},
      setMasker() {},
    });

    const factory = testEngineFactory(createComplexIntentProvider(), observability, registry);
    await drain(
      factory.runStream({
        sessionId: 'SESSION-IR-EMPTY',
        turnId: '2054102360564695102',
        tenant: 1,
        prompt: '随便聊聊',
        agentSnapshot: {
          agent: {
            content: {
              prompt: 'sys',
              toolRefs: ['platform.flow.invoke', 'platform.knowledge.query'],
              intentRouting: {
                enabled: true,
                flows: [
                  {
                    toolName: 'platform.flow.invoke',
                    priority: 1,
                    keywords: ['never-match-keyword'],
                  },
                ],
              },
            },
          },
        },
      }),
    );

    const visible = events[0]?.visibleTools ?? [];
    expect(visible).toContain('platform.flow.invoke');
    expect(visible).toContain('platform.knowledge.query');
  });

  test('Chinese chart query promotes chart-output skill end-to-end (keyword path)', async () => {
    const skillRegistry = new SkillRegistryService();
    const ECHARTS_MARKER = 'ECHARTS-CN-INTEGRATION-MARKER';
    skillRegistry.register({
      kind: 'skill',
      name: 'chart-output',
      version: '1.0.2',
      description: '图表生成与数据可视化',
      instructions: `使用 echarts 围栏输出图表：\n${ECHARTS_MARKER}`,
      tags: ['chart'],
      trigger: { type: 'semantic' },
    });

    const skillEvents: unknown[] = [];
    const observability: ObservabilityEmitter = {
      on() {
        return () => {};
      },
      off() {},
      emit(ev) {
        if (ev.type === 'skill_activation') skillEvents.push(ev);
      },
      setMasker() {},
    };

    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider, observability, undefined, skillRegistry);

    await drain(
      factory.runStream({
        sessionId: 'SESSION-CHART-CN',
        turnId: '2054102360564695103',
        tenant: 1,
        prompt: '使用图表生成技能画一个销售趋势柱状图',
        agentSnapshot: {
          agent: { content: { prompt: 'BASE' } },
        },
      }),
    );

    const payload = (
      skillEvents[0] as {
        payload?: {
          pinned?: Array<{ name: string }>;
          candidates?: Array<{ name: string; promote?: boolean }>;
        };
      }
    )?.payload;
    const pinned = (payload?.pinned ?? []).map((p) => p.name);
    const candidates = (payload?.candidates ?? []).map((c) => c.name);
    expect(pinned.includes('chart-output') || candidates.includes('chart-output')).toBe(true);
  });

  test('Chinese 图表 query can surface flow tool via SemanticToolStrategy when keyword misses', async () => {
    const prevEmbedModel = process.env['AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL'];
    process.env['AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL'] = 'test-embedding-model';

    const invoke = makeFlowInvokeTool();
    const knowledge = makeKnowledgeQueryTool();
    const registry = mockToolRegistry([invoke, knowledge]);
    const { events, observability } = collectToolActivation({
      on() {
        return () => {};
      },
      off() {},
      emit() {},
      setMasker() {},
    });

    const provider = createComplexIntentProvider();
    const factory = testEngineFactory(provider, observability, registry);
    try {
    await drain(
      factory.runStream({
        sessionId: 'SESSION-IR-SEMANTIC',
        turnId: '2054102360564695104',
        tenant: 1,
        prompt: '生成数据可视化图表',
        agentSnapshot: {
          agent: {
            content: {
              prompt: 'sys',
              toolRefs: ['platform.flow.invoke', 'platform.knowledge.query'],
              intentRouting: {
                enabled: true,
                flows: [
                  {
                    toolName: 'platform.flow.invoke',
                    priority: 1,
                    keywords: ['退款'],
                  },
                ],
              },
            },
          },
        },
      }),
    );

    const visible = events[0]?.visibleTools ?? [];
    const hits =
      (
        events[0] as {
          hits?: Array<{
            toolName: string;
            sources: Array<{ strategy: string; reason: string }>;
          }>;
        }
      )?.hits ?? [];
    const flowHit = hits.find((h) => h.toolName === 'platform.flow.invoke');
    expect(visible.includes('platform.flow.invoke')).toBe(true);
    expect(
      flowHit?.sources.some((s) => s.strategy === 'embedding-intent-flow'),
    ).toBe(true);
    } finally {
      if (prevEmbedModel === undefined) {
        delete process.env['AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL'];
      } else {
        process.env['AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL'] = prevEmbedModel;
      }
    }
  });
});
