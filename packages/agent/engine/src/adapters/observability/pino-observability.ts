/**
 * PinoObservabilityAdapter — bridges @tachu/core ObservabilityEmitter to pino + OTel spans.
 *
 * Compliance:
 *   - R22: all logging routes through pino; no console.log/console.error.
 *   - design doc: docs/technical-design/phase-1/P1-10-observability.md §3.7
 *   - M1 权威: docs/detailed-design/11-observability/logging.md §3
 *   - Adapter contract: docs/detailed-design/03-core-adapters/observability.md §3
 */
import {
  DefaultObservabilityEmitter,
  type ObservabilityEmitter,
  type EngineEvent,
} from '@tachu/core';
import { Injectable } from '@dangao/bun-server';
import type pino from 'pino';
import { AgenticTracer } from './otel-tracer';

/** Minimal LoggerFactory contract (kept here to avoid circular deps adapter ↔ engine). */
export interface ILoggerFactory {
  getLogger(namespace: string): pino.Logger;
}

/**
 * DI token — engine `ObservabilityModule` 用 factory alias 绑到 `DI_LOGGER_FACTORY`。
 *
 * 禁止与 `DI_LOGGER_FACTORY`（`Symbol.for('agentic.observability.loggerFactory')`）
 * 共用同一 Symbol：后者在 `ObservabilityModule` 里先 register、再 alias 时后者的
 * `provide` 会覆盖前者，导致 alias 指向自身 → `resolve` 无限递归。
 */
export const LOGGER_FACTORY_FOR_ADAPTER_TOKEN = Symbol.for(
  'agentic.adapter.observability.loggerFactory',
);

const ADAPTER_NS = 'agentic.engine.adapter.observability';

/**
 * tachu 事件 → pino 级别。
 *
 * - 阶段边界 / LLM 发起 / 进度等多发事件用 **debug**：需在容器中设
 *   `AGENTIC_ENGINE_LOG_LEVEL=debug`（或 `trace`）才能在默认 JSON 里看到；
 *   `info` 档仍保留 `llm_call_end`、`tool_call_*`、fallback 等「结果向」事件。
 */
function mapEventTypeToLevel(
  t: EngineEvent['type'],
): 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' {
  switch (t) {
    case 'error':
      return 'error';
    case 'budget_exhausted':
      return 'error';
    case 'warning':
      return 'warn';
    case 'budget_warning':
      return 'warn';
    case 'phase_enter':
    case 'phase_exit':
    case 'progress':
    case 'llm_call_start':
      return 'debug';
    default:
      return 'info';
  }
}

@Injectable()
export class PinoObservabilityAdapter
  extends DefaultObservabilityEmitter
  implements ObservabilityEmitter
{
  private readonly logger: pino.Logger;

  constructor(
    loggerFactory: ILoggerFactory,
    private readonly tracer: AgenticTracer,
  ) {
    super();
    this.logger = loggerFactory.getLogger(ADAPTER_NS);
  }

  override emit(event: EngineEvent): void {
    super.emit(event);

    const span = this.tracer.startSpan('adapter', 'observe', {
      attributes: {
        'engine.event.type': event.type,
        'engine.trace.id': event.correlation.traceId,
        'engine.session.id': event.correlation.sessionId,
        'engine.phase': event.phase,
      },
    });

    try {
      for (const [k, v] of Object.entries(event.payload ?? {})) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          span.setAttribute(`engine.event.payload.${k}`, v);
        }
      }
      const msgStr = `engine.event.${event.type}`;
      const level = mapEventTypeToLevel(event.type);
      // child logger 已带 `ns`，此处不再写入，避免与 mixin 组合后出现重复键
      this.logger[level](
        {
          eventType: event.type,
          traceId: event.correlation.traceId,
          sessionId: event.correlation.sessionId,
          phase: event.phase,
          at: event.timestamp,
          payload: event.payload,
        },
        msgStr,
      );
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: 2, message: 'INTERNAL_ERROR' });
      throw err;
    } finally {
      span.end();
    }
  }
}
