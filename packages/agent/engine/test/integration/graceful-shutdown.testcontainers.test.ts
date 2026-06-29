import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

/**
 * Graceful shutdown SIGTERM lifecycle — Testcontainers 端到端验证。
 *
 * 替代 `graceful-shutdown.integration.test.ts` 的 `describe.skip` 占位（Phase 3
 * 留下的 manual flow 注释）。覆盖：
 *
 *   1. SIGTERM 触发完整生命周期：drain SSE → registered hooks → exit code 0
 *   2. 空闲 engine 收到 SIGTERM 在 30s 内退出（registry 内含 outbox-relay /
 *      mysql / redis-* hook，验证空 turn registry / drain 不会 hang）
 *
 * 实现依赖 `EngineIntegrationProcess.sendSignal` / `waitForExit` split API
 * （test-infra Phase 4 Wave 3B），以避开 `stop()` 的 SIGTERM+join 原子操作。
 *
 * 前置：Docker daemon 可用，`USE_TESTCONTAINERS=1`：
 *   bun run test:containers
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/graceful-shutdown.testcontainers.test.ts
 *
 * 权威：
 *   - docs/technical-design/phase-4/T05-graceful-shutdown.md
 *   - docs/detailed-design/10-deployment-and-ops/README.md §3.3
 */
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

const run = await resolveShouldRunTestcontainers();

const stackHolder: { current: MysqlRedisQdrantStack | null } = { current: null };
const engineHolder: { current: EngineIntegrationProcess | null } = { current: null };

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      if (engineHolder.current) {
        try {
          engineHolder.current.sendSignal("SIGKILL");
        } catch {
          /* already dead */
        }
        await engineHolder.current.waitForExit(10_000).catch(() => {});
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
const AGENT_ID = "1234567890123456789";

function mockHeaders(tenant: number, userId: string) {
  return {
    Authorization: "Bearer test-token",
    "Content-Type": "application/json",
    "x-mock-tenant-id": String(tenant),
    "x-mock-user-id": userId,
  } as const;
}

(run ? describe : describe.skip)("[testcontainers] Graceful shutdown — SIGTERM lifecycle", () => {
  beforeAll(async () => {
    const s = await startMysqlRedisQdrant();
    try {
      await applyMinimalMysqlSchema(s.mysqlUrl);
      stackHolder.current = s;
    } catch (e) {
      await s.stop();
      throw e;
    }
  }, HOOK_MS);

  afterAll(async () => {
    if (engineHolder.current) {
      try {
        engineHolder.current.sendSignal("SIGKILL");
      } catch {
        /* already dead */
      }
      await engineHolder.current.waitForExit(10_000).catch(() => {});
      engineHolder.current = null;
    }
    if (stackHolder.current) {
      await stackHolder.current.stop().catch(() => {});
      stackHolder.current = null;
    }
    await stopTrackedTestcontainersIfAny();
  });

  async function startFreshEngine(): Promise<EngineIntegrationProcess> {
    const port = await getFreePort();
    const repoRoot = resolveMonorepoRootFromImporter(import.meta.dir);
    return startEngineIntegrationProcess({
      port,
      repoRoot,
      stack: stackHolder.current!,
    });
  }

  /**
   * Best-effort cleanup: SIGKILL + short wait. Idempotent on already-exited
   * children (sendSignal returns false / waitForExit resolves synchronously).
   */
  async function killAndDrain(engine: EngineIntegrationProcess): Promise<void> {
    try {
      engine.sendSignal("SIGKILL");
    } catch {
      /* already dead */
    }
    await engine.waitForExit(10_000).catch(() => {});
  }

  it(
    "SIGTERM with active SSE stream → drain → exit code 0",
    async () => {
      const engine = await startFreshEngine();
      engineHolder.current = engine;
      let exited = false;
      const ac = new AbortController();
      try {
        const tenant = 95_101;
        const userId = "tc-shutdown-active";
        const base = engine.baseUrl;

        const post = await fetch(`${base}/sessions`, {
          body: JSON.stringify({ agentId: AGENT_ID, title: "tc-shutdown-active" }),
          headers: mockHeaders(tenant, userId),
          method: "POST",
        });
        expect(post.status).toBe(201);
        const { id: sid } = (await post.json()) as { id: string };

        const sse = await fetch(`${base}/sessions/${sid}/events`, {
          headers: {
            ...mockHeaders(tenant, userId),
            Accept: "text/event-stream",
          },
          signal: ac.signal,
        });
        expect(sse.ok).toBe(true);

        /** sse-handler registerStream 在异步 IIFE 中；250ms 足够空 replay。 */
        await new Promise((r) => setTimeout(r, 250));

        engine.sendSignal("SIGTERM");

        /**
         * Lifecycle: pre-drain(0) → broadcastDraining → waitForActiveTurns(0
         * since NoopTurnRegistry) → waitForDrain(2s) → registered hooks →
         * process.exit(0)。配置常情况 < 10s 完整退出。
         */
        const { code, signal } = await engine.waitForExit(60_000);
        expect(code).toBe(0);
        expect(signal).toBeNull();
        exited = true;
      } finally {
        ac.abort();
        if (!exited) {
          await killAndDrain(engine);
        }
        engineHolder.current = null;
      }
    },
    { timeout: 120_000 },
  );

  it(
    "SIGTERM on idle engine → exit code 0 within drain window (no hung hooks)",
    async () => {
      /**
       * Weaker assertion variant of "shutdown registry hooks fire in
       * priority order"：当前 startEngineIntegrationProcess 使用
       * `stdio: 'inherit'`，captureLogs 选项未引入；因此不解析子进程
       * stdout 验证 hook 顺序，只断言 exit 0 + 退出耗时上界，覆盖
       * outbox-relay / mysql-pool / redis-* hook 链能在没有 active session
       * 的情形下正常 close（`graceful-shutdown.service.test.ts` 已对
       * priority 顺序做单测覆盖）。
       */
      const engine = await startFreshEngine();
      engineHolder.current = engine;
      let exited = false;
      try {
        /** Sanity: 引擎已就绪（startEngineIntegrationProcess 已 await /health/live） */
        const live = await fetch(`${engine.baseUrl}/health/live`);
        expect(live.status).toBe(200);

        const t0 = Date.now();
        engine.sendSignal("SIGTERM");
        const { code, signal } = await engine.waitForExit(30_000);
        const elapsed = Date.now() - t0;

        expect(code).toBe(0);
        expect(signal).toBeNull();
        /** drain-grace=2s + hooks 链通常 < 10s；30s 上界保留宽松余量 */
        expect(elapsed).toBeLessThan(30_000);
        exited = true;
      } finally {
        if (!exited) {
          await killAndDrain(engine);
        }
        engineHolder.current = null;
      }
    },
    { timeout: 90_000 },
  );
});
