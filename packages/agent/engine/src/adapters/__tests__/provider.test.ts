/**
 * Provider workspace 覆盖入口 — llm-core HTTP 契约 + bridge 元数据 + NotImplementedError。
 * 原 agentic-adapters provider.test.ts 的 SDK/_clientForTest 断言已由
 * llm-provider-port-bridge.test.ts 按 fetch 架构重写。
 */
import { describe, it, expect } from 'bun:test';
import { NotImplementedError } from '../../infra/errors/agentic-error';

await import('../../../../../llm/core/src/provider/openai-compat-provider.test.ts');
await import('../../../../../llm/core/src/provider/anthropic-provider.test.ts');
await import('../provider/llm-provider-port-bridge.test.ts');

describe('NotImplementedError symbol', () => {
  it('仍为 Error 子类', () => {
    expect(new NotImplementedError('x')).toBeInstanceOf(Error);
    expect(new NotImplementedError('x').name).toBe('NotImplementedError');
  });
});
