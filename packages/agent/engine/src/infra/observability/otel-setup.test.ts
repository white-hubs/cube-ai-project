/**
 * OTel Setup 单测
 *
 * 关键断言（design doc §7）：
 * - startOtelSdk() 二次调用 → 不 throw（pino bootLog 内部 warn）
 * - endpoint 为空 → NoOp（不 throw）
 *
 * M1 权威：docs/detailed-design/11-observability/README.md §3.3
 *
 * 历史：T08 改造后 bootstrap 日志改用 pino，不再走 console.warn，
 *       因此移除了原 consoleWarnSpy.toHaveBeenCalledWith 断言；
 *       并在文件加载前把 AGENTIC_ENGINE_LOG_LEVEL 临时置为 silent，
 *       避免 pino 静默期间的副作用 import 污染测试 stdout，
 *       afterAll 中复原，保证不影响其他测试文件。
 */

const __ORIGINAL_LOG_LEVEL = process.env.AGENTIC_ENGINE_LOG_LEVEL;
// 必须在 import otel-setup（直接或动态）之前设置，
// 让 createBootstrapLogger 在模块首次加载时就处于静音 level。
process.env.AGENTIC_ENGINE_LOG_LEVEL = 'silent';

import { describe, test, expect, afterAll } from 'bun:test';

afterAll(() => {
  if (__ORIGINAL_LOG_LEVEL === undefined) {
    delete process.env.AGENTIC_ENGINE_LOG_LEVEL;
  } else {
    process.env.AGENTIC_ENGINE_LOG_LEVEL = __ORIGINAL_LOG_LEVEL;
  }
});

// 注意：otel-setup 是副作用模块，直接 import 会立即执行一次 start
// 因此使用 _resetOtelSdkForTest 重置状态再测试

describe('OTel Setup', () => {
  test('startOtelSdk 在无 endpoint 时不 throw（NoOp 模式）', async () => {
    const { startOtelSdk, _resetOtelSdkForTest } = await import('./otel-setup');
    _resetOtelSdkForTest();
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    expect(() => startOtelSdk()).not.toThrow();

    if (originalEndpoint !== undefined) {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
    }
    _resetOtelSdkForTest();
  });

  test('startOtelSdk 二次调用不 throw（幂等）', async () => {
    const { startOtelSdk, _resetOtelSdkForTest } = await import('./otel-setup');
    _resetOtelSdkForTest();
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    expect(() => {
      startOtelSdk();
      startOtelSdk();
    }).not.toThrow();

    if (originalEndpoint !== undefined) {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
    }
    _resetOtelSdkForTest();
  });

  test('NoOp 模式下 startOtelSdk 顺利完成（不 throw）', async () => {
    const { startOtelSdk, _resetOtelSdkForTest } = await import('./otel-setup');
    _resetOtelSdkForTest();
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    expect(() => startOtelSdk()).not.toThrow();

    if (originalEndpoint !== undefined) {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
    }
    _resetOtelSdkForTest();
  });
});
