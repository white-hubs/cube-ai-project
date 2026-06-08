/**
 * P1-10 Observability Integration Tests
 *
 * 前置条件（全部 skip）：
 * - OTel Collector 运行在 http://localhost:4318
 * - Jaeger UI 可访问 http://localhost:16686
 * - Prometheus 可访问 http://localhost:9090
 *
 * 启用方法（user wire-in 后）：
 *   1. docker compose -f docs/technical-design/phase-1/P1-10/config/docker-compose.example.yml up -d
 *   2. cp docs/technical-design/phase-1/P1-10/config/.env.example .env
 *   3. 设置 OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 *   4. 移除各 test.skip → test，运行 bun test test/integration/observability.integration.test.ts
 *
 * 参见 runbook.md 步骤 1-5。
 *
 * requires live OTel Collector + Jaeger + Prometheus; enable after Q-M2-8 config ready by user
 */

import { describe, test, expect } from 'bun:test';

const TEST_PORT = 3010; // P1-10 专用端口（domains-index §P1-10）
const COLLECTOR_URL = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';
const PROMETHEUS_URL = 'http://localhost:9090';
const JAEGER_URL = 'http://localhost:16686';

describe('P1-10 Observability Integration', () => {
  describe('OTel Collector', () => {
    test.skip('Collector health endpoint 200', async () => {
      // requires live OTel Collector; enable after Q-M2-8 config ready by user
      const response = await fetch(`${COLLECTOR_URL.replace(':4318', ':13133')}/`);
      expect(response.ok).toBe(true);
    });
  });

  describe('Traces (Jaeger)', () => {
    test.skip('Engine HTTP 请求后 Jaeger 能查到 trace', async () => {
      // requires live OTel Collector + Jaeger; enable after Q-M2-8 config ready by user
      // 1. 发一个 GET /health/live 请求
      const engineResponse = await fetch(`http://localhost:${TEST_PORT}/health/live`);
      expect(engineResponse.ok).toBe(true);

      // 2. 等待 trace 导出（~2s）
      await new Promise((r) => setTimeout(r, 2000));

      // 3. 查 Jaeger API
      const jaegerResponse = await fetch(
        `${JAEGER_URL}/api/services`,
      );
      const data = await jaegerResponse.json() as { data: string[] };
      expect(data.data).toContain('cube-agentic-engine');
    });
  });

  describe('Metrics (Prometheus)', () => {
    test.skip('agentic_engine_http_requests_total 出现在 Prometheus', async () => {
      // requires live OTel Collector + Prometheus; enable after Q-M2-8 config ready by user
      // 1. 发请求让 metric 产生
      await fetch(`http://localhost:${TEST_PORT}/health/live`);

      // 2. 等待 metric 导出（~15s）
      await new Promise((r) => setTimeout(r, 15000));

      // 3. 查 Prometheus
      const promResponse = await fetch(
        `${PROMETHEUS_URL}/api/v1/query?query=agentic_engine_http_requests_total`,
      );
      const data = await promResponse.json() as { data: { result: unknown[] } };
      expect(data.data.result.length).toBeGreaterThan(0);
    });

    test.skip('metric 名全部以 agentic_engine_ 开头', async () => {
      // requires live Prometheus; enable after Q-M2-8 config ready by user
      const promResponse = await fetch(
        `${PROMETHEUS_URL}/api/v1/label/__name__/values`,
      );
      const data = await promResponse.json() as { data: string[] };
      const engineMetrics = data.data.filter((n: string) => n.startsWith('agentic_engine_'));
      // 应有至少 10 个来自 MetricsCatalog 的 metric
      expect(engineMetrics.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Logger', () => {
    test.skip('engine 启动日志包含 serviceName=cube-agentic-engine', async () => {
      // requires live engine + log aggregation; enable after Q-M2-8 config ready by user
      // 此测试依赖日志聚合（Loki/ELK），Phase 3 实装
    });
  });
});
