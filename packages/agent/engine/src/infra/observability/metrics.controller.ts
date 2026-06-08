import { Controller, GET } from '@dangao/bun-server';
import { MetricsRegistry } from './metrics-registry';

/**
 * Prometheus scrape 端点 — `GET /metrics`。
 * P3-01：prom-client Registry 文本输出。
 */
@Controller('')
export class MetricsController {
  constructor(private readonly metricsRegistry: MetricsRegistry) {}

  @GET('/metrics')
  async prometheus(): Promise<Response> {
    const body = await this.metricsRegistry.metrics();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      },
    });
  }
}
