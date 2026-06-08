import { describe, test, expect } from 'bun:test';
import { NoopLLMProviderAdapter } from '@cube-ai/agent-engine/adapters/provider';
import { LlmHandler } from './llm-handler';
import type { ToolHandlerCtx } from '../tool-context';

const ctx: ToolHandlerCtx = {
  traceId: 'x',
  signal:  new AbortController().signal,
  auth:    { tenant: 1, user: { userId: 'u', scopes: [] } },
  session: { id: '1234567890123456789', turnId: '1234567890123456788' },
};

describe('LlmHandler', () => {
  test('调用 Noop Provider → 返回 content', async () => {
    const h = new LlmHandler(new NoopLLMProviderAdapter());
    const out = await h.invoke(
      {
        messages: [{ role: 'user', content: 'ping' }],
      },
      ctx,
    );
    expect(typeof out.content).toBe('string');
    expect(out.usage?.totalTokens).toBeGreaterThanOrEqual(0);
  });

  test('messages 为空 → INVALID_ARGUMENT_SCHEMA_VIOLATION', async () => {
    const h = new LlmHandler(new NoopLLMProviderAdapter());
    await expect(h.invoke({ messages: [] }, ctx)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT_SCHEMA_VIOLATION',
    });
  });
});
