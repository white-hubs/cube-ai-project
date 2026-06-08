/**
 * `/metrics` endpoint — Testcontainers Prometheus 抓取冒烟。
 *
 * 迁移自 `metrics-endpoint.integration.test.ts`（保留为占位 placeholder，全 skip）。
 *
 * 覆盖（与 mysql-redis-qdrant.testcontainers.test.ts 互补，不重复 SSE/REST 主链路）：
 *   1. GET /metrics → 200 + `text/plain; version=0.0.4` 内容类型
 *   2. 文本含 prom-client 头部（# HELP / # TYPE）
 *   3. 触发 /health/live + /health/ready 后，文本包含核心 catalog 指标：
 *        - `agentic_engine_http_requests_total`（counter，由 http-metrics middleware 注册）
 *        - `agentic_engine_http_request_duration_ms`（histogram，MetricsCatalog.HTTP_REQUEST_DURATION）
 *        - `agentic_engine_http_in_flight_count`（gauge）
 *
 * 前置：Docker daemon 可用，`USE_TESTCONTAINERS=1`：
 *   bun run test:containers
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/metrics-endpoint.testcontainers.test.ts
 *
 * 权威：
 *   - docs/technical-design/phase-1/P1-10-observability.md §3.3
 *   - docs/detailed-design/11-observability/metrics.md §3.1
 *   - packages/agent/engine/src/infra/observability/{metrics-registry.ts, metrics-catalog.ts, http-metrics.middleware.ts}
 */
import { join } from 'node:path';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import {
  applyMinimalMysqlSchema,
  getFreePort,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startEngineIntegrationProcess,
  startMysqlRedisQdrant,
  stopTrackedTestcontainersIfAny,
  type EngineIntegrationProcess,
  type MysqlRedisQdrantStack,
  resolveMonorepoRootFromImporter,
} from '@cube-ai/test-infra';

const run = await resolveShouldRunTestcontainers();

const stackHolder: { current: MysqlRedisQdrantStack | null } = { current: null };
const engineHolder: { current: EngineIntegrationProcess | null } = { current: null };

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      if (engineHolder.current) {
        await engineHolder.current.stop().catch(() => {});
        engineHolder.current = null;
      }
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

const HOOK_MS = 1_800_000;

(run ? describe : describe.skip)(
  '[testcontainers] /metrics endpoint — Prometheus scrape',
  () => {
    beforeAll(async () => {
      const s = await startMysqlRedisQdrant();
      try {
        await applyMinimalMysqlSchema(s.mysqlUrl);
        stackHolder.current = s;
      } catch (e) {
        await s.stop();
        throw e;
      }

      const port = await getFreePort();
      const repoRoot = resolveMonorepoRootFromImporter(import.meta.dir);
      try {
        const eng = await startEngineIntegrationProcess({
          stack: s,
          port,
          repoRoot,
        });
        engineHolder.current = eng;
      } catch (e) {
        await s.stop();
        stackHolder.current = null;
        throw e;
      }
    }, HOOK_MS);

    afterAll(async () => {
      if (engineHolder.current) {
        await engineHolder.current.stop().catch(() => {});
        engineHolder.current = null;
      }
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
      await stopTrackedTestcontainersIfAny();
    });

    it('GET /metrics returns 200 + Prometheus text exposition (content-type: text/plain)', async () => {
      const base = engineHolder.current!.baseUrl;
      const res = await fetch(`${base}/metrics`);
      expect(res.status).toBe(200);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct).toMatch(/text\/plain/);
      const body = await res.text();
      expect(body.length).toBeGreaterThan(20);
      expect(body).toContain('# HELP');
      expect(body).toContain('# TYPE');
    });

    it('exposes core http catalog metrics after firing health probes', async () => {
      const base = engineHolder.current!.baseUrl;

      // Drive at least one observation per metric so prom-client emits sample
      // rows (not just `# HELP / # TYPE` headers).
      for (let i = 0; i < 3; i += 1) {
        const live = await fetch(`${base}/health/live`);
        expect(live.ok).toBe(true);
        const ready = await fetch(`${base}/health/ready`);
        expect([200, 503]).toContain(ready.status);
      }

      const res = await fetch(`${base}/metrics`);
      expect(res.status).toBe(200);
      const body = await res.text();

      // Counter (registered in http-metrics.middleware.ts)
      expect(body).toContain('agentic_engine_http_requests_total');
      // Histogram (MetricsCatalog.HTTP_REQUEST_DURATION)
      expect(body).toContain('agentic_engine_http_request_duration_ms');
      // Gauge (in-flight)
      expect(body).toContain('agentic_engine_http_in_flight_count');

      // After fired requests, sample rows should exist (not just headers)
      expect(body).toMatch(/agentic_engine_http_requests_total\{[^}]+\}\s+\d+/);
    });

    it('HELP/TYPE exposition names use agentic_engine_ prefix (no stray default metrics)', async () => {
      const base = engineHolder.current!.baseUrl;
      await fetch(`${base}/health/live`);

      const res = await fetch(`${base}/metrics`);
      expect(res.status).toBe(200);
      const body = await res.text();

      const fromMeta = new Set<string>();
      for (const line of body.split('\n')) {
        const m = line.match(/^# (?:HELP|TYPE) ([^\s#]+)/);
        if (m?.[1]) fromMeta.add(m[1]);
      }
      expect(fromMeta.size).toBeGreaterThan(0);
      for (const name of fromMeta) {
        expect(name.startsWith('agentic_engine_')).toBe(true);
      }
    });
  },
);
