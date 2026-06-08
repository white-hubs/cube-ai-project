/**
 * MetricsCatalog 单测
 *
 * 关键断言（design doc §7）：
 * - 10 个指标名全部以 agentic_engine_ 开头
 * - 无重复名
 *
 * M1 权威：docs/detailed-design/11-observability/metrics.md §1.1
 */

import { describe, test, expect } from 'bun:test';
import { MetricsCatalog, ALL_CATALOG_METRIC_NAMES } from './metrics-catalog';
import { METRIC_PREFIX } from './metrics-registry';

describe('MetricsCatalog', () => {
  test('catalog 包含 10 个指标', () => {
    expect(Object.keys(MetricsCatalog)).toHaveLength(10);
  });

  test('全部指标名以 agentic_engine_ 开头', () => {
    for (const name of ALL_CATALOG_METRIC_NAMES) {
      expect(name.startsWith(METRIC_PREFIX)).toBe(true);
    }
  });

  test('无重复指标名', () => {
    const names = ALL_CATALOG_METRIC_NAMES;
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test('HTTP_REQUEST_DURATION 指标名正确', () => {
    expect(MetricsCatalog.HTTP_REQUEST_DURATION).toBe(
      'agentic_engine_http_request_duration_ms',
    );
  });

  test('ERROR_TOTAL 指标名正确', () => {
    expect(MetricsCatalog.ERROR_TOTAL).toBe('agentic_engine_error_total');
  });

  test('所有 metric 名包含有效后缀（_total/_ms/_count/_bytes/_ratio/_seconds）', () => {
    const validSuffixes = ['_total', '_ms', '_count', '_bytes', '_ratio', '_seconds'];
    for (const name of ALL_CATALOG_METRIC_NAMES) {
      const hasValidSuffix = validSuffixes.some((s) => name.endsWith(s));
      expect(hasValidSuffix).toBe(true);
    }
  });
});
