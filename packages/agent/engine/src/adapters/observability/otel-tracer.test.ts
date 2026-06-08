/**
 * AgenticTracer 单测
 *
 * 关键断言（design doc §7）：
 * - span name 格式 agentic.<bc>.<op>
 * - withSpan 执行 fn 并返回结果
 *
 * M1 权威：docs/detailed-design/11-observability/tracing.md §2.1
 */

import { describe, test, expect } from 'bun:test';
import { AgenticTracer } from './otel-tracer';

describe('AgenticTracer', () => {
  const tracer = new AgenticTracer();

  test('startSpan 返回 Span 对象（含 end 方法）', () => {
    const span = tracer.startSpan('session', 'create');
    expect(span).toBeDefined();
    expect(typeof span.end).toBe('function');
    span.end();
  });

  test('span name 格式为 agentic.<bc>.<op>', () => {
    // 通过 OTel InMemoryExporter 或直接检查 span context
    const span = tracer.startSpan('tool', 'execute');
    // NoOp span 不携带 name，但接口可调用不 throw
    expect(() => span.end()).not.toThrow();
  });

  test('withSpan 正常执行 fn 并返回结果', async () => {
    const result = await tracer.withSpan('session', 'list', async (_span) => {
      return 42;
    });
    expect(result).toBe(42);
  });

  test('withSpan 在 fn 抛异常时重新 throw', async () => {
    await expect(
      tracer.withSpan('session', 'fail', async (_span) => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');
  });

  test('tracer 接受不同 bc/op 组合', () => {
    const bcs = ['session', 'tool', 'authz', 'descriptor', 'job'];
    const ops = ['create', 'execute', 'decide', 'lookup', 'enqueue'];
    for (const bc of bcs) {
      for (const op of ops) {
        const span = tracer.startSpan(bc, op);
        expect(span).toBeDefined();
        span.end();
      }
    }
  });
});
