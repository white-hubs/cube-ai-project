import { describe, expect, test } from 'bun:test';
import { InMemoryStore } from '@cube-ai/agent-engine/adapters/memory';
import { LlmProviderPortBridge } from '@cube-ai/agent-engine/adapters/provider';
import type { LlmProviderPort } from '@cube-ai/contracts';
import type {
  AdapterCallContext,
  ObservabilityEmitter,
  ProviderAdapter,
  TaskExecutor,
} from '@tachu/core';
import { assembleTachuRuntime } from './assemble-tachu-runtime';
import { createTurnContextHolder } from './turn-context-holder';

function createCaptureObservability(): ObservabilityEmitter & {
  events: Array<{ payload?: { status?: string } }>;
} {
  const events: Array<{ payload?: { status?: string } }> = [];
  return {
    events,
    emit(event) {
      events.push(event as { payload?: { status?: string } });
    },
    on: () => () => {},
    off: () => {},
    setMasker: () => {},
  };
}

function createEmbedLlmProvider(): LlmProviderPort {
  return {
    async chat() {
      return { content: 'ok', finishReason: 'stop' };
    },
    async *chatStream() {
      yield { type: 'finish' as const, finishReason: 'stop' as const };
    },
    async embed(req) {
      return req.input.map(() => ({ dense: [0.1, 0.2, 0.3] }));
    },
  };
}

function createEmbedProvider(): ProviderAdapter {
  return new LlmProviderPortBridge(createEmbedLlmProvider());
}

const noopTaskExecutor: TaskExecutor = async () => ({
  ok: true,
  output: {},
});

describe('assembleTachuRuntime', () => {
  test('embed provider → no projection.disabled warning', () => {
    const observability = createCaptureObservability();
    const turnContext = createTurnContextHolder();
    const memory = new InMemoryStore();
    const result = assembleTachuRuntime({
      provider: createEmbedProvider(),
      observability,
      memorySystem: memory,
      turnContext,
      taskExecutor: noopTaskExecutor,
    });

    expect(result.initWarnings).not.toContain('projection.disabled');
    expect(result.embeddingRuntime).toBeDefined();
    expect(result.vectorIndex).toBeDefined();
    expect(result.memorySystem).toBe(memory);
  });

  test('engine registry has no vectorStore dependency', () => {
    const result = assembleTachuRuntime({
      provider: createEmbedProvider(),
      observability: createCaptureObservability(),
      memorySystem: new InMemoryStore(),
      turnContext: createTurnContextHolder(),
      taskExecutor: noopTaskExecutor,
    });
    expect(result.registry.list('tool')).toEqual([]);
    expect(result.vectorIndex).toBeDefined();
  });

  test('provider without embed emits projection.disabled', () => {
    const observability = createCaptureObservability();
    const provider: ProviderAdapter = {
      id: 'no-embed',
      name: 'NoEmbed',
      async listAvailableModels() {
        return [];
      },
      async chat() {
        return { content: 'ok', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      },
      async *chatStream() {
        yield { type: 'text-delta', delta: 'x' } as const;
        yield { type: 'finish', finishReason: 'stop' } as const;
      },
    };
    const result = assembleTachuRuntime({
      provider,
      observability,
      memorySystem: new InMemoryStore(),
      turnContext: createTurnContextHolder(),
      taskExecutor: noopTaskExecutor,
    });
    expect(result.initWarnings).toContain('projection.disabled');
    expect(result.embeddingRuntime).toBeUndefined();
  });
});
