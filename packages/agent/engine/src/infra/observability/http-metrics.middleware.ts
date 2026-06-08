/**
 * HTTP Metrics Middleware：Prometheus counter + histogram + in-flight gauge。
 *
 * bootstrap：traceId → http-metrics → oauth → errorResponse（ADR-0019）
 *
 * 设计参考：P1-10 §3.8 / M1 metrics.md §3.1
 */

import type { Middleware, NextFunction } from '@dangao/bun-server';
import type { Context } from '@dangao/bun-server';
import { MetricsCatalog } from './metrics-catalog';
import { MetricsRegistry } from './metrics-registry';

/**
 * 工厂：与单一 `MetricsRegistry` 实例绑定（bootstrap 从 DI resolve）。
 */
export function createHttpMetricsMiddleware(registry: MetricsRegistry): Middleware {
  const requestCounter = registry.registerCounter(
    'agentic_engine_http_requests_total',
    'Total HTTP requests',
    ['method', 'route', 'status_class'],
  );

  const requestDuration = registry.registerHistogram(
    MetricsCatalog.HTTP_REQUEST_DURATION,
    'HTTP request duration in ms',
    ['method', 'route', 'status_class'],
  );

  const inflight = registry.registerGauge(
    'agentic_engine_http_in_flight_count',
    'Concurrent HTTP requests in flight',
    ['method', 'route'],
  );

  return async function httpMetricsMiddleware(
    ctx: Context,
    next: NextFunction,
  ): Promise<Response> {
    const startMs = Date.now();
    const method = ctx.request?.method ?? 'UNKNOWN';
    const route =
      (ctx as unknown as { matchedRoute?: string }).matchedRoute ??
      'UNKNOWN_ROUTE';
    inflight.inc({ method, route });
    try {
      const response = await next();
      const durationMs = Date.now() - startMs;
      const statusCode = response?.status ?? 0;
      const statusClass = `${Math.floor(statusCode / 100)}XX`;
      const labels = { method, route, status_class: statusClass };
      requestCounter.inc(labels);
      requestDuration.observe(labels, durationMs);
      return response;
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const labels = { method, route, status_class: '5XX' };
      requestCounter.inc(labels);
      requestDuration.observe(labels, durationMs);
      throw err;
    } finally {
      inflight.dec({ method, route });
    }
  };
}
