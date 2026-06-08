/**
 * MetricsRegistry：Prometheus exposition（prom-client）+ `agentic_engine_*` 前缀约束。
 *
 * 设计参考：docs/technical-design/prompts/phase-3/P3-01-infra.md §3.5 / P1-10 §3.2
 * `/metrics` 输出：`registry.metrics()`
 */

import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { Injectable } from '@dangao/bun-server';

export const METRIC_PREFIX = 'agentic_engine_';

/** DI token：Symbol.for 命名遵循 shared-context §9.3 */
export const DI_METRICS_REGISTRY = Symbol.for('agentic.observability.metricsRegistry');

@Injectable()
export class MetricsRegistry {
  readonly promRegistry = new Registry();

  private readonly counterRegistry = new Map<string, Counter<string>>();
  private readonly histogramRegistry = new Map<string, Histogram<string>>();
  private readonly gaugeRegistry = new Map<string, Gauge<string>>();

  private assertPrefix(name: string): void {
    if (!name.startsWith(METRIC_PREFIX)) {
      throw new Error(
        `Metric name must start with '${METRIC_PREFIX}': got '${name}'`,
      );
    }
  }

  registerCounter(
    name: string,
    description = '',
    labelNames: string[] = [],
  ): Counter<string> {
    this.assertPrefix(name);
    const existing = this.counterRegistry.get(name);
    if (existing) return existing;

    const counter = new Counter({
      name,
      help: description || name,
      labelNames,
      registers: [this.promRegistry],
    });
    this.counterRegistry.set(name, counter);
    return counter;
  }

  registerHistogram(
    name: string,
    description = '',
    labelNames: string[] = [],
    buckets?: number[],
  ): Histogram<string> {
    this.assertPrefix(name);
    const existing = this.histogramRegistry.get(name);
    if (existing) return existing;

    const histogram = new Histogram({
      name,
      help: description || name,
      labelNames,
      buckets:
        buckets ??
        [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
      registers: [this.promRegistry],
    });
    this.histogramRegistry.set(name, histogram);
    return histogram;
  }

  registerGauge(
    name: string,
    description = '',
    labelNames: string[] = [],
  ): Gauge<string> {
    this.assertPrefix(name);
    const existing = this.gaugeRegistry.get(name);
    if (existing) return existing;

    const gauge = new Gauge({
      name,
      help: description || name,
      labelNames,
      registers: [this.promRegistry],
    });
    this.gaugeRegistry.set(name, gauge);
    return gauge;
  }

  /** Prometheus text exposition（含进程默认指标） */
  async metrics(): Promise<string> {
    return this.promRegistry.metrics();
  }

  /** 测试自检 */
  getRegisteredNames(): { counters: string[]; histograms: string[]; gauges: string[] } {
    return {
      counters: [...this.counterRegistry.keys()],
      histograms: [...this.histogramRegistry.keys()],
      gauges: [...this.gaugeRegistry.keys()],
    };
  }
}
