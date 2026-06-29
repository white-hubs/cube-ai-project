import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import {
  type EngineIntegrationProcess,
  type MysqlRedisQdrantStack,
  applyMinimalMysqlSchema,
  getFreePort,
  registerProcessShutdown,
  resolveMonorepoRootFromImporter,
  resolveShouldRunTestcontainers,
  startEngineIntegrationProcess,
  startMysqlRedisQdrant,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

/**
 * OTel **NoOp** bootstrap — 与 `observability.testcontainers.test.ts`（collector 导出）
 * 互补：本文件仅验证 **未** 设置 `OTEL_EXPORTER_OTLP_ENDPOINT` 时进程正常启动，
 * 且 pino/结构化日志含 `serviceName=cube-agentic-engine`（不依赖单独日志聚合栈）。
 *
 * 前置：`USE_TESTCONTAINERS=1`，Docker 可用。
 */

const run = await resolveShouldRunTestcontainers();

const stackHolder: { current: MysqlRedisQdrantStack | null } = { current: null };
const engineHolder: { current: EngineIntegrationProcess | null } = { current: null };

const HOOK_MS = 1_800_000;

/** 避免父进程 / CI 继承的 OTLP 变量泄漏到子进程 */
const UNSET_OTEL: readonly string[] = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_METRIC_EXPORT_INTERVAL_MS",
];

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

(run ? describe : describe.skip)("[testcontainers] OTel NoOp bootstrap — no OTLP endpoint", () => {
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
        captureProcessOutput: true,
        port,
        repoRoot,
        stack: s,
        unsetEnv: UNSET_OTEL,
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

  it("engine boots when OTEL_EXPORTER_OTLP_ENDPOINT is unset (NoOp) — /health/live UP", async () => {
    const res = await fetch(`${engineHolder.current!.baseUrl}/health/live`);
    expect(res.ok).toBe(true);
    const j = (await res.json()) as { status: string };
    expect(j.status).toBe("UP");
  });

  it("process output on graceful shutdown includes serviceName=cube-agentic-engine", async () => {
    const eng = engineHolder.current!;
    eng.sendSignal("SIGTERM");
    const { code } = await eng.waitForExit(30_000);
    expect(code).toBe(0);
    expect(eng.getCapturedOutput()).toContain("cube-agentic-engine");
    /** `stop()` 对已退出子进程注册 exit 会挂——与 sse-replay drain 用例相同处理 */
    engineHolder.current = null;
  });
});
