/**
 * AgenticTracer：OTel tracer wrapper，强约束 span 命名 `agentic.<bc>.<op>`。
 *
 * 设计参考：docs/technical-design/phase-1/P1-10-observability.md §3.6
 * M1 权威：docs/detailed-design/11-observability/tracing.md §2.1
 *
 * Span 命名规则（tracing.md §2.1）：
 *   `{域}.{动作} {对象}`，短、可枚举、不含业务 ID。
 *   本 wrapper 对 adapter/domain 内部调用提供 `agentic.<bc>.<op>` 快捷形式。
 */

import {
  trace,
  context,
  SpanKind,
  type Tracer,
  type Span,
  type SpanOptions,
} from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { Injectable } from '@dangao/bun-server';

const TRACER_NAME = 'cube-agentic-engine';

/** DI token */
export const DI_AGENTIC_TRACER = Symbol.for('agentic.observability.tracer');

let globalAgenticProvider: BasicTracerProvider | undefined;

/**
 * 注册 `BasicTracerProvider` 为全局 TracerProvider（进程内幂等）。
 * 不配置 OTLP exporter，由引擎 / 运维在进程外或后续步骤接入。
 * PinoObservabilityAdapter / AgenticTracer 依赖此 provider 以产生真实 span。
 */
export function ensureAgenticTracerProvider(): BasicTracerProvider {
  if (globalAgenticProvider) return globalAgenticProvider;
  const p = new BasicTracerProvider();
  trace.setGlobalTracerProvider(p);
  globalAgenticProvider = p;
  return p;
}

@Injectable()
export class AgenticTracer {
  constructor() {
    ensureAgenticTracerProvider();
  }

  private get tracer(): Tracer {
    return trace.getTracer(TRACER_NAME);
  }

  /**
   * 创建 INTERNAL span，名称格式：`agentic.<bc>.<op>`。
   *
   * @param bc   bounded context，如 'session' / 'tool' / 'authz'
   * @param op   操作，如 'create' / 'execute' / 'decide'
   * @param options  额外 SpanOptions
   *
   * span name 示例：'agentic.session.create'
   */
  startSpan(bc: string, op: string, options?: SpanOptions): Span {
    const name = `agentic.${bc}.${op}`;
    return this.tracer.startSpan(name, {
      kind: SpanKind.INTERNAL,
      ...options,
    });
  }

  /**
   * 执行 fn，自动管理 span 生命周期（end + context 绑定）。
   * 异常时 recordException + setStatus(ERROR) + rethrow。
   */
  async withSpan<T>(
    bc: string,
    op: string,
    fn: (span: Span) => Promise<T>,
    options?: SpanOptions,
  ): Promise<T> {
    const span = this.startSpan(bc, op, options);
    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const result = await fn(span);
        span.end();
        return result;
      } catch (err) {
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        span.setStatus({ code: 2 /* ERROR */, message: 'INTERNAL_ERROR' });
        span.end();
        throw err;
      }
    });
  }
}
