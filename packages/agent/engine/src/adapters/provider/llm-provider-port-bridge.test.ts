/**
 * Provider 元数据 / tachu 桥接层单测 — 承接原 agentic-adapters provider.test.ts 中
 * listAvailableModels / countTokens / R18 等意图（fetch 版 llm-core 无 SDK client）。
 */
import { describe, expect, it } from 'bun:test';
import { DEFAULT_ADAPTER_CALL_CONTEXT } from '@tachu/core';
import type { LlmProviderPort } from '@cube-ai/contracts';
import { OpenAiCompatProvider, AnthropicProvider } from '@cube-ai/llm-core';
import { LlmProviderPortBridge } from './llm-provider-port-bridge';

describe('LlmProviderPortBridge（R18 + 元数据）', () => {
  it('R18: 构造后不触发 inner.chat', async () => {
    let chatCalls = 0;
    const inner: LlmProviderPort = {
      async chat() {
        chatCalls += 1;
        return { content: 'ok', finishReason: 'stop' };
      },
    };
    new LlmProviderPortBridge(inner);
    expect(chatCalls).toBe(0);
  });

  it('listAvailableModels 映射 inner.listAvailableModels → ModelInfo[]', async () => {
    const inner: LlmProviderPort = {
      async chat() {
        return { content: 'x', finishReason: 'stop' };
      },
      async listAvailableModels() {
        return ['gpt-4o', 'gpt-4o-mini'];
      },
    };
    const bridge = new LlmProviderPortBridge(inner);
    const models = await bridge.listAvailableModels();
    expect(models.map((m) => m.modelName).sort()).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(models[0]!.capabilities.supportsStreaming).toBe(true);
  });

  it('inner 无 listAvailableModels 时返回 noop 占位', async () => {
    const inner: LlmProviderPort = {
      async chat() {
        return { content: 'x', finishReason: 'stop' };
      },
    };
    const models = await new LlmProviderPortBridge(inner).listAvailableModels();
    expect(models).toEqual([
      expect.objectContaining({ modelName: 'noop', capabilities: expect.any(Object) }),
    ]);
  });

  it('countTokens 按 ~4 字符/token 估算', async () => {
    const bridge = new LlmProviderPortBridge({
      async chat() {
        return { content: 'x', finishReason: 'stop' };
      },
    });
    const tokens = await bridge.countTokens([{ role: 'user', content: 'ABCD' }], 'gpt-4o');
    expect(tokens).toBe(1);
  });

  it('OpenAI fetch provider：构造后不发起 HTTP，chat 后才调用 fetch', async () => {
    let fetchCalls = 0;
    const prev = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return Response.json({
        choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }) as typeof fetch;
    try {
      const inner = new OpenAiCompatProvider({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      });
      expect(fetchCalls).toBe(0);
      const bridge = new LlmProviderPortBridge(inner);
      const res = await bridge.chat(
        { model: 'gpt-4o', messages: [{ role: 'user', content: 'ping' }] },
        DEFAULT_ADAPTER_CALL_CONTEXT,
      );
      expect(res.content).toBe('pong');
      expect(fetchCalls).toBe(1);
    } finally {
      globalThis.fetch = prev;
    }
  });

  it('Anthropic fetch provider：chat 成功后完成一次 HTTP 往返', async () => {
    let fetchCalls = 0;
    const prev = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return Response.json({
        id: 'm',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'pong' }],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    }) as typeof fetch;
    try {
      const inner = new AnthropicProvider({
        apiKey: 'sk-ant-test',
        model: 'claude-3-5-sonnet-20241022',
        baseURL: 'https://api.anthropic.com',
      });
      const bridge = new LlmProviderPortBridge(inner);
      const res = await bridge.chat(
        {
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'ping' }],
        },
        DEFAULT_ADAPTER_CALL_CONTEXT,
      );
      expect(res.content).toBe('pong');
      expect(fetchCalls).toBe(1);
    } finally {
      globalThis.fetch = prev;
    }
  });
});
