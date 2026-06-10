import { describe, it, expect, mock } from 'bun:test';
import type { EngineEvent } from '@tachu/core';
import { PinoObservabilityAdapter, type ILoggerFactory } from './pino-observability';
import { AgenticTracer } from './otel-tracer';

describe('PinoObservabilityAdapter', () => {
  it('emit 写 pino 且走 OTel span（不抛错）', () => {
    const info = mock(() => {});
    const logger = {
      info,
      warn: mock(() => {}),
      error: mock(() => {}),
      debug: mock(() => {}),
      fatal: mock(() => {}),
      trace: mock(() => {}),
    };
    const factory: ILoggerFactory = {
      getLogger: () => logger as unknown as import('pino').Logger,
    };
    const adapter = new PinoObservabilityAdapter(factory, new AgenticTracer());
    const event: EngineEvent = {
      timestamp: Date.now(),
      correlation: {
        traceId: 'trace-integration',
        requestId: 'trace-integration',
        sessionId: 'sess',
        turnId: 'turn',
      },
      type: 'tool_call_end',
      phase: 'execution',
      payload: { toolName: 'shell.exec', durationMs: 12 },
    };
    expect(() => adapter.emit(event)).not.toThrow();
    expect(info).toHaveBeenCalled();
  });

  it('phase_enter 使用 debug 级别（需 AGENTIC_ENGINE_LOG_LEVEL≤debug 才落盘）', () => {
    const debug = mock(() => {});
    const logger = {
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      debug,
      fatal: mock(() => {}),
      trace: mock(() => {}),
    };
    const factory: ILoggerFactory = {
      getLogger: () => logger as unknown as import('pino').Logger,
    };
    const adapter = new PinoObservabilityAdapter(factory, new AgenticTracer());
    const event: EngineEvent = {
      timestamp: Date.now(),
      correlation: {
        traceId: 't',
        requestId: 't',
        sessionId: 's',
        turnId: 'turn',
      },
      type: 'phase_enter',
      phase: 'intent',
      payload: {},
    };
    adapter.emit(event);
    expect(debug).toHaveBeenCalled();
  });

  it('error 类事件使用 warn 级别映射（budget_warning）', () => {
    const warn = mock(() => {});
    const logger = {
      info: mock(() => {}),
      warn,
      error: mock(() => {}),
      debug: mock(() => {}),
      fatal: mock(() => {}),
      trace: mock(() => {}),
    };
    const factory: ILoggerFactory = {
      getLogger: () => logger as unknown as import('pino').Logger,
    };
    const adapter = new PinoObservabilityAdapter(factory, new AgenticTracer());
    const event: EngineEvent = {
      timestamp: 1,
      correlation: {
        traceId: 't',
        requestId: 't',
        sessionId: 's',
        turnId: 'turn',
      },
      type: 'budget_warning',
      phase: 'execution',
      payload: {},
    };
    adapter.emit(event);
    expect(warn).toHaveBeenCalled();
  });

  it('knowledge_prefetch_end uses info level', () => {
    const info = mock(() => {});
    const logger = {
      info,
      warn: mock(() => {}),
      error: mock(() => {}),
      debug: mock(() => {}),
      fatal: mock(() => {}),
      trace: mock(() => {}),
    };
    const factory: ILoggerFactory = {
      getLogger: () => logger as unknown as import('pino').Logger,
    };
    const adapter = new PinoObservabilityAdapter(factory, new AgenticTracer());
    adapter.emit({
      timestamp: 1,
      correlation: {
        traceId: 't',
        requestId: 't',
        sessionId: 's',
        turnId: 'turn',
      },
      type: 'knowledge_prefetch_end' as EngineEvent['type'],
      phase: 'prefetch',
      payload: {
        hitCount: 2,
        truncated: false,
        kbIds: ['kb-1'],
        queryChars: 12,
        durationMs: 10,
        injectedContextChars: 500,
        topHits: [{ docId: 'doc-1', score: 0.9 }],
      },
    });
    expect(info).toHaveBeenCalled();
  });
});
