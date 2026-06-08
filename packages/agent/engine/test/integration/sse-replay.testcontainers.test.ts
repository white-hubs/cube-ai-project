/**
 * SSE：Last-Event-ID replay + heartbeat — Testcontainers 差异化补丁。
 *
 * **覆盖策略说明（防重复）**
 *
 * `mysql-redis-qdrant.testcontainers.test.ts` 已覆盖：
 *   - SSE：GET /v1/sessions/:id/events 返回 text/event-stream
 *   - SSE：Last-Event-ID 重连后仍为 event-stream
 *   - SSE：心跳含 ping-v1（≤36s）
 *
 * 因此 `sse-replay.integration.test.ts` 中 3 个 `test.skip`：
 *   1. Last-Event-ID replays buffered events newer than anchor — 增强：本文件断言重连流
 *      不再包含 anchor id 自身（避免重复推送）
 *   2. heartbeat ping-v1 within ~30s — 已被覆盖，不重复
 *   3. SIGTERM drain.mode (drain-mode-v1) — 留 `it.skip` follow-up
 *      （需 SIGTERM 触发 drain 但又不能让 engine 子进程死掉，子进程
 *      尚未抽离专用 helper；阶段二 Phase 4 follow-up）
 *
 * 前置：Docker daemon 可用，`USE_TESTCONTAINERS=1`：
 *   bun run test:containers
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/sse-replay.testcontainers.test.ts
 *
 * 权威：docs/technical-design/prompts/phase-3/P3-06-session-sse.md §6
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
const AGENT_ID = '1234567890123456789';

function mockHeaders(tenant: number, userId: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token',
    'x-mock-tenant-id': String(tenant),
    'x-mock-user-id': userId,
  } as const;
}

(run ? describe : describe.skip)(
  '[testcontainers] SSE replay + drain — Testcontainers',
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

    it(
      'GET /events with Last-Event-ID does not duplicate the anchor id on reconnect',
      async () => {
        const tenant = 93_301;
        const base = engineHolder.current!.baseUrl;
        const userId = 'tc-sse-anchor';

        const post = await fetch(`${base}/v1/sessions`, {
          method: 'POST',
          headers: mockHeaders(tenant, userId),
          body: JSON.stringify({ agentId: AGENT_ID, title: 'tc-sse-anchor' }),
        });
        expect(post.status).toBe(201);
        const { id: sid } = (await post.json()) as { id: string };

        /**
         * Phase 1：抓首次 SSE 中第一条带 id 的事件作为 anchor。
         * 心跳 ping 的 emit 间隔约 25s，因此预算 ≤32s。
         */
        const ac = new AbortController();
        const abortTimer = setTimeout(() => ac.abort(), 32_000);
        let firstBuf = '';
        try {
          const res = await fetch(`${base}/v1/sessions/${sid}/events`, {
            headers: { ...mockHeaders(tenant, userId), Accept: 'text/event-stream' },
            signal: ac.signal,
          });
          expect(res.ok).toBe(true);
          const reader = res.body!.getReader();
          const dec = new TextDecoder();
          const deadline = Date.now() + 31_000;
          while (Date.now() < deadline) {
            const { done, value } = await reader.read();
            if (done) break;
            firstBuf += dec.decode(value);
            if (/id:\s*\d{1,20}:\d{6}/.test(firstBuf)) break;
          }
          await reader.cancel().catch(() => {});
        } finally {
          clearTimeout(abortTimer);
        }

        const anchorId = firstBuf.match(/id:\s*(\d{1,20}:\d{6})/)?.[1];
        expect(anchorId).toBeTruthy();

        /**
         * Phase 2：携 Last-Event-ID 重连，断言不再重复推送 anchor id。
         * 仅读取一帧（≤6s），用于验证重连仍是 event-stream 且不立即重发 anchor。
         */
        const ac2 = new AbortController();
        const stopT2 = setTimeout(() => ac2.abort(), 6_000);
        let secondBuf = '';
        try {
          const res2 = await fetch(`${base}/v1/sessions/${sid}/events`, {
            headers: {
              ...mockHeaders(tenant, userId),
              Accept: 'text/event-stream',
              'Last-Event-ID': anchorId!,
            },
            signal: ac2.signal,
          });
          expect(res2.ok).toBe(true);
          expect((res2.headers.get('Content-Type') ?? '').toLowerCase()).toContain(
            'text/event-stream',
          );
          const reader = res2.body!.getReader();
          const dec = new TextDecoder();
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline) {
            const { done, value } = await reader.read();
            if (done) break;
            secondBuf += dec.decode(value);
          }
          await reader.cancel().catch(() => {});
        } catch {
          /* 心跳间隔较长时 6s 内可能无任何 frame；anchor 不出现即视为通过 */
        } finally {
          clearTimeout(stopT2);
        }

        if (secondBuf.length > 0) {
          expect(secondBuf).not.toContain(`id: ${anchorId}\n`);
          expect(secondBuf).not.toContain(`id:${anchorId}\n`);
        }
      },
      { timeout: 80_000 },
    );

    it(
      'after SIGTERM on engine, active SSE reads drain.mode (drain-mode-v1) before close',
      async () => {
        /**
         * Phase 4 Wave 3B：依赖 `EngineIntegrationProcess.sendSignal` /
         * `waitForExit` split API（test-infra）。流程：
         *   1. POST /v1/sessions
         *   2. GET /v1/sessions/:id/events 持有 reader
         *   3. engine.sendSignal('SIGTERM') — 不立即 join exit
         *   4. reader 持续读至 `event: drain.mode` + schema `drain-mode-v1`
         *   5. engine.waitForExit() — exit code 0
         *
         * 默认配置 AGENTIC_ENGINE_PRE_DRAIN_SLEEP_MS=0 +
         * AGENTIC_ENGINE_DRAIN_GRACE_SECONDS=2，所以 broadcast 必须在 ≤2s 内
         * 抵达 reader（实际通常 <100ms）。
         */
        const tenant = 93_310;
        const base = engineHolder.current!.baseUrl;
        const userId = 'tc-sse-drain';

        const post = await fetch(`${base}/v1/sessions`, {
          method: 'POST',
          headers: mockHeaders(tenant, userId),
          body: JSON.stringify({ agentId: AGENT_ID, title: 'tc-sse-drain' }),
        });
        expect(post.status).toBe(201);
        const { id: sid } = (await post.json()) as { id: string };

        const ac = new AbortController();
        const sseRes = await fetch(`${base}/v1/sessions/${sid}/events`, {
          headers: { ...mockHeaders(tenant, userId), Accept: 'text/event-stream' },
          signal: ac.signal,
        });
        expect(sseRes.ok).toBe(true);

        /**
         * sse-handler 注册 DrainService.registerStream 是在异步 IIFE 里 await
         * replay 之后才执行；fetch headers 已就绪不代表 conn 已注册。
         * 250ms 足够空 replay + subscribe + registerStream（实测 <30ms）。
         */
        await new Promise((r) => setTimeout(r, 250));

        engineHolder.current!.sendSignal('SIGTERM');

        const reader = sseRes.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let sawDrain = false;
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch {
            break;
          }
          if (chunk.done) break;
          buf += dec.decode(chunk.value, { stream: true });
          if (buf.includes('event: drain.mode') && buf.includes('drain-mode-v1')) {
            sawDrain = true;
            break;
          }
        }
        try {
          await reader.cancel();
        } catch {
          /* reader may already be released */
        }
        ac.abort();

        expect(sawDrain).toBe(true);

        const { code } = await engineHolder.current!.waitForExit(30_000);
        expect(code).toBe(0);

        /**
         * Engine 已 exit；afterAll 的 stop() 会在已退出的 child 上注册
         * `child.once('exit')` 永不 fire，导致 hang。设为 null 跳过 stop()。
         */
        engineHolder.current = null;
      },
      { timeout: 60_000 },
    );
  },
);
