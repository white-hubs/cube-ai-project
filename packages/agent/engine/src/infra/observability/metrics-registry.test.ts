/**
 * MetricsRegistry 单测
 *
 * 关键断言（design doc §7）：
 * - 非前缀 metric 名 → throw
 * - 合规前缀 → OK
 * - 重复注册同名 → 返回同 instance
 *
 * M1 权威：docs/detailed-design/11-observability/metrics.md §1.1 + §6
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MetricsRegistry, METRIC_PREFIX } from './metrics-registry';

describe('MetricsRegistry', () => {
  let registry: MetricsRegistry;

  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  describe('registerCounter', () => {
    test('非 agentic_engine_ 前缀 → throw', () => {
      expect(() => registry.registerCounter('my_metric')).toThrow(
        `Metric name must start with '${METRIC_PREFIX}': got 'my_metric'`,
      );
    });

    test('裸 engine_ 前缀（无 agentic_ 前缀）→ throw', () => {
      expect(() => registry.registerCounter('engine_http_requests_total')).toThrow(
        `Metric name must start with '${METRIC_PREFIX}'`,
      );
    });

    test('合规前缀 → 返回 Counter 实例', () => {
      const counter = registry.registerCounter('agentic_engine_test_total');
      expect(counter).toBeDefined();
      expect(typeof counter.inc).toBe('function');
    });

    test('重复注册同名 Counter → 返回同 instance（idempotent）', () => {
      const c1 = registry.registerCounter('agentic_engine_dup_total');
      const c2 = registry.registerCounter('agentic_engine_dup_total');
      expect(c1).toBe(c2);
    });
  });

  describe('registerHistogram', () => {
    test('非前缀 → throw', () => {
      expect(() => registry.registerHistogram('bad_histogram_ms')).toThrow(
        `Metric name must start with '${METRIC_PREFIX}'`,
      );
    });

    test('合规前缀 → 返回 Histogram', () => {
      const h = registry.registerHistogram('agentic_engine_test_duration_ms');
      expect(h).toBeDefined();
      expect(typeof h.observe).toBe('function');
    });

    test('重复注册同名 Histogram → 返回同 instance', () => {
      const h1 = registry.registerHistogram('agentic_engine_test2_ms');
      const h2 = registry.registerHistogram('agentic_engine_test2_ms');
      expect(h1).toBe(h2);
    });
  });

  describe('registerGauge', () => {
    test('合规前缀 → 返回 prom-client Gauge', () => {
      const g = registry.registerGauge('agentic_engine_test_count');
      expect(g).toBeDefined();
    });

    test('非前缀 → throw', () => {
      expect(() => registry.registerGauge('sessions_active')).toThrow(
        `Metric name must start with '${METRIC_PREFIX}'`,
      );
    });
  });

  describe('getRegisteredNames', () => {
    test('注册后可查询名称列表', () => {
      registry.registerCounter('agentic_engine_foo_total');
      registry.registerHistogram('agentic_engine_bar_ms');
      const { counters, histograms } = registry.getRegisteredNames();
      expect(counters).toContain('agentic_engine_foo_total');
      expect(histograms).toContain('agentic_engine_bar_ms');
    });
  });

  describe('metrics()', () => {
    test('exports prom text for registered counter', async () => {
      const c = registry.registerCounter('agentic_engine_test_scrape_total');
      c.inc();
      const text = await registry.metrics();
      expect(text).toContain('agentic_engine_test_scrape_total');
    });
  });
});
