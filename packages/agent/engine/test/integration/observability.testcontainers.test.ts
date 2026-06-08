/**
 * Observability — OTel Collector Testcontainer 接收侧验证（迁自
 * `observability.integration.test.ts` 的 6 个 `test.skip`）。
 *
 * **覆盖策略说明**
 *
 * 原 `observability.integration.test.ts` 的 6 个 skip 用例分两类：
 *   A. **Engine → Collector 出口验证**（本文件覆盖）：通过启 `otel/opentelemetry-collector-contrib`
 *      容器接 OTLP HTTP，再启 engine 子进程把 `OTEL_EXPORTER_OTLP_ENDPOINT` 指过去，
 *      触发请求后读 collector logs（debug exporter）断言出现 `Span / Resource`。
 *   B. **Jaeger / Prometheus 端 UI 验证**（`it.skip` 留 follow-up）：依赖完整后端服务栈，
 *      不在单容器集成范围内；属 Phase 4+ 部署级 e2e。
 *
 * **已迁出本文件（独立 testcontainers，避免与 collector 用例抢同一 beforeAll）：**
 *   - OTel NoOp（未设 `OTEL_EXPORTER_OTLP_ENDPOINT`）→ `otel-noop-bootstrap.testcontainers.test.ts`
 *   - `/metrics` 指标名 `agentic_engine_` 前缀 → `metrics-endpoint.testcontainers.test.ts`
 *   - bootstrap 日志 `serviceName` → 同上 NoOp 文件（子进程输出捕获）
 *
 * 实装策略：
 *   1. 不启 Jaeger / Prometheus（重镜像、慢、且 collector debug exporter 已能间接证明 export 路径通）
 *   2. 通过 test-infra 的 `startOtelCollector` 启容器（`withCopyContentToContainer` 注入 config）
 *   3. 启 engine 子进程时通过 J2 添加的 `extraEnv` 把 `OTEL_EXPORTER_OTLP_ENDPOINT` 指向 collector
 *   4. 触发 GET /health/live + 等导出周期 → 读 collector stdout
 *   5. `it.skip` 仅保留 Jaeger / Prometheus UI 类 follow-up
 *
 * 前置：Docker daemon 可用，`USE_TESTCONTAINERS=1`：
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/observability.testcontainers.test.ts
 *   bun run test:containers
 *
 * 镜像：`otel/opentelemetry-collector-contrib:0.94.0`（固定版本，避免 latest 漂移）
 * 权威：docs/detailed-design/11-observability/README.md §3.3 / §3.4
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
  startOtelCollector,
  stopTrackedTestcontainersIfAny,
  stopTrackedOtelCollectorIfAny,
  type EngineIntegrationProcess,
  type MysqlRedisQdrantStack,
  type OtelCollectorStack,
  resolveMonorepoRootFromImporter,
} from '@cube-ai/test-infra';

const run = await resolveShouldRunTestcontainers();

const stackHolder: { current: MysqlRedisQdrantStack | null } = { current: null };
const engineHolder: { current: EngineIntegrationProcess | null } = { current: null };
const collectorHolder: { current: OtelCollectorStack | null } = { current: null };

const HOOK_MS = 1_800_000;

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      await stopTrackedOtelCollectorIfAny();
      if (engineHolder.current) {
        await engineHolder.current.stop().catch(() => {});
        engineHolder.current = null;
      }
      if (collectorHolder.current) {
        await collectorHolder.current.stop().catch(() => {});
        collectorHolder.current = null;
      }
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

(run ? describe : describe.skip)(
  '[testcontainers] observability — OTel collector reception',
  () => {
    beforeAll(async () => {
      const stack = await startMysqlRedisQdrant();
      try {
        await applyMinimalMysqlSchema(stack.mysqlUrl);
        stackHolder.current = stack;
      } catch (e) {
        await stack.stop();
        throw e;
      }

      let collector: OtelCollectorStack;
      try {
        collector = await startOtelCollector();
        collectorHolder.current = collector;
      } catch (e) {
        await stack.stop();
        stackHolder.current = null;
        throw e;
      }

      try {
        const port = await getFreePort();
        const repoRoot = resolveMonorepoRootFromImporter(import.meta.dir);
        const engine = await startEngineIntegrationProcess({
          stack,
          port,
          repoRoot,
          extraEnv: {
            OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint,
            /** 加快 metric 导出，缩短测试等待 */
            OTEL_METRIC_EXPORT_INTERVAL_MS: '500',
          },
        });
        engineHolder.current = engine;
      } catch (e) {
        await collector.stop().catch(() => {});
        collectorHolder.current = null;
        await stack.stop();
        stackHolder.current = null;
        throw e;
      }
    }, HOOK_MS);

    afterAll(async () => {
      if (engineHolder.current) {
        await engineHolder.current.stop().catch(() => {});
        engineHolder.current = null;
      }
      if (collectorHolder.current) {
        await collectorHolder.current.stop().catch(() => {});
        collectorHolder.current = null;
      }
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
      await stopTrackedOtelCollectorIfAny();
      await stopTrackedTestcontainersIfAny();
    });

    it(
      'engine boots successfully when OTEL_EXPORTER_OTLP_ENDPOINT is set',
      async () => {
        // engine 子进程在 beforeAll 已等待 /health/live OK；这里再多请求一次确认稳定
        const res = await fetch(`${engineHolder.current!.baseUrl}/health/live`);
        expect(res.ok).toBe(true);
        const j = (await res.json()) as { status: string };
        expect(j.status).toBe('UP');
      },
      120_000,
    );

    it(
      'OTel collector receives telemetry from engine (debug exporter shows Span / Resource)',
      async () => {
        const base = engineHolder.current!.baseUrl;

        // 多次触发请求让 trace + metric 都能产生
        for (let i = 0; i < 5; i++) {
          await fetch(`${base}/health/live`);
        }
        // 等导出周期：metric 至少 1×500ms，trace BatchSpanProcessor 默认 5s
        await new Promise((r) => setTimeout(r, 6_500));

        // 再读取容器 stdout 快照（等 1.5s 让流稳定）
        const logsText = await collectorHolder.current!.snapshotLogs(1_500);

        /**
         * debug exporter `verbosity: detailed` 输出至少包含以下关键字（任一出现即视为通过）：
         *   - "Span"（trace 记录）
         *   - "ResourceSpans" / "ResourceMetrics" / "ResourceLogs"
         *   - "ScopeSpans" / "ScopeMetrics"
         *
         * 软断言：未必每次 trace 都先于 metric/log 落盘；只要任一类 telemetry 抵达即可。
         * 若无任一关键字命中，输出前 1KB 帮助定位。
         */
        const matched =
          /\bSpan(s)?\b|Resource(Spans|Metrics|Logs)?|ScopeSpans|ScopeMetrics/i.test(
            logsText,
          );
        if (!matched) {
          // 失败时附诊断（截断 1KB 防过长）
          const head = logsText.slice(0, 1024).replace(/\n/g, '\\n');
          throw new Error(
            `Collector did not log any Span/Resource within window. logs[head]="${head}"`,
          );
        }
        expect(matched).toBe(true);
      },
      180_000,
    );

    /**
     * Jaeger UI / Prometheus 后端验证 — 依赖独立服务栈（Jaeger all-in-one + Prometheus），
     * 不在单容器集成范围；建议在部署级 e2e（Phase 4+）覆盖。
     */
    it.skip(
      'Engine HTTP request → trace visible in Jaeger UI [Phase 4 follow-up: Jaeger stack]',
      async () => {
        expect(true).toBe(true);
      },
    );

    it.skip(
      'Engine metric agentic_engine_http_requests_total appears in Prometheus [Phase 4 follow-up: Prometheus stack]',
      async () => {
        expect(true).toBe(true);
      },
    );
  },
);
