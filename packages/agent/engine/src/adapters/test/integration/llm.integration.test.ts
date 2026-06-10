/**
 * LLM Provider 真机集成（默认跳过；requires live keys + network）
 *
 * requires live AGENTIC_ENGINE_* keys; enable after Q-M2-8/Q-M3-2 wire-in
 *
 * Run:
 *   SKIP_INTEGRATION=false AGENTIC_ENGINE_OPENAI_API_KEY=... bun test packages/agentic-adapters/test/integration/llm.integration.test.ts
 */
import { describe, it, expect } from 'bun:test';
import { DEFAULT_ADAPTER_CALL_CONTEXT } from '@tachu/core';
import { OpenAiCompatProvider as OpenAICompatProvider, AnthropicProvider } from '@cube-ai/llm-core';

const SKIP = process.env['SKIP_INTEGRATION'] !== 'false';

describe('LLM adapters [integration]', () => {
  it.skipIf(SKIP)(
    'OpenAI-compat：非流式 echo',
    async () => {
      const baseURL =
        process.env['AGENTIC_ENGINE_OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1';
      const apiKey = process.env['AGENTIC_ENGINE_OPENAI_API_KEY']!;
      const model =
        process.env['AGENTIC_ENGINE_OPENAI_MODEL'] ?? 'gpt-4o-mini';

      const p = new OpenAICompatProvider({
        baseURL,
        apiKey,
        model,
      });
      const res = await p.chat(
        {
          model,
          messages: [{ role: 'user', content: 'Reply with exactly: INTEGRATION_OK' }],
        },
        DEFAULT_ADAPTER_CALL_CONTEXT,
      );
      expect(res.content.length).toBeGreaterThan(0);
      expect(res.usage.totalTokens).toBeGreaterThan(0);
      expect(res.finishReason).toBe('stop');
    },
    120_000,
  );

  it.skipIf(SKIP)(
    'Anthropic：非流式 echo',
    async () => {
      const apiKey = process.env['AGENTIC_ENGINE_ANTHROPIC_API_KEY']!;
      const model =
        process.env['AGENTIC_ENGINE_ANTHROPIC_MODEL'] ??
        'claude-3-5-sonnet-20241022';

      const p = new AnthropicProvider({
        apiKey,
        model,
        baseURL: process.env['AGENTIC_ENGINE_ANTHROPIC_BASE_URL'],
        maxRetries: 1,
      });
      const res = await p.chat(
        {
          model,
          messages: [{ role: 'user', content: 'Reply with exactly: INTEGRATION_OK' }],
        },
        DEFAULT_ADAPTER_CALL_CONTEXT,
      );
      expect(res.content.length).toBeGreaterThan(0);
      expect(res.usage.totalTokens).toBeGreaterThan(0);
    },
    120_000,
  );
});
