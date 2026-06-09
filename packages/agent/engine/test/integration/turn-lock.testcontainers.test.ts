/**
 * Turn-Lock 并发互斥 — Testcontainers HTTP 集成测试。
 *
 * **关系**：本文件迁移自 `turn-lock.integration.test.ts.skip`（保留作为 Phase-1 placeholder，
 * 文件名带 `.skip` 整体被 bun test 忽略）。该 placeholder 仅落需求/验收，不再单独维护。
 *
 * **覆盖**：基于 `Engine` 子进程 + 真实 MySQL/Redis/Qdrant，
 *   1. 同 session 上**并发** 2 个 M1（POST /sessions/:id/messages）→ 仅 1 个拿到 turn-lock；
 *      另 1 个返回 409 + `RESOURCE_CONFLICT_SESSION_BUSY`（`agentic-error.ts` → categoryOf("RESOURCE_CONFLICT") = 409）。
 *   2. 第 1 个完成（lock 已释放）后，第 2 个 M1 不再返 409（lock 已释放）。
 *
 * **状态码**：
 *   - POST /sessions/:id/messages 在控制器内未调 `setStatus`，默认 200；
 *   - 409 来自 `AgenticEngineError(RESOURCE_CONFLICT_SESSION_BUSY)` 经 `agenticEngineExceptionFilter` 映射。
 *
 * **schema 局部增量**：`infra/test-infra/fixtures/minimal-mysql.sql` 仅含 `sessions` + `outbox_events`；
 *   `TurnRepository.insertRunningTurn` 依赖 `turns` 表才能让 M1 流程走完同步段并保留 lock。
 *   为了**让首条 message 的成功路径足够长（lock 持有覆盖第二条到达）**，本文件 beforeAll 内 inline 建 `turns` 表，
 *   不污染共享 fixture（避免和其它 testcontainers 用例并行修改冲突）。DDL 来自 `docs/detailed-design/02-data/mysql-tables.md` §7.1。
 *
 * 前置：Docker daemon 可用，通过 `USE_TESTCONTAINERS=1` 触发：
 *   bun run test:containers
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/turn-lock.testcontainers.test.ts
 *
 * 权威：docs/detailed-design/05-session/concurrency-and-replay.md §2 / `P1-06-session.md` §4.1
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
import Redis from 'ioredis';
import { createConnection } from 'mysql2/promise';
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

/**
 * 仅本文件需要 — 不写入共享 fixture（J1/J2 也可能并行修改 minimal-mysql.sql）。
 * 字段集与 `docs/detailed-design/02-data/mysql-tables.md` §7.1 一致。
 */
const TURNS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS turns (
  id                   BIGINT(20)   NOT NULL,
  tenant               INT(10)      NOT NULL,
  session_id           BIGINT(20)   NOT NULL,
  turn_no              INT          NOT NULL,
  status               VARCHAR(32)  NOT NULL DEFAULT 'RUNNING',
  input_envelope_json  JSON         NOT NULL,
  pipeline_trace_json  JSON         NULL,
  token_usage_json     JSON         NULL,
  error_json           JSON         NULL,
  idempotency_key      VARCHAR(128) NULL,
  start_time           DATETIME(3)  NOT NULL,
  close_time           DATETIME(3)  NULL,
  deleted              BIGINT(20)   NOT NULL DEFAULT 0,
  create_by            VARCHAR(64)  NOT NULL,
  creator_id           VARCHAR(64)  NULL,
  creator_type         VARCHAR(16)  NULL,
  create_time          DATETIME(3)  NOT NULL,
  update_by            VARCHAR(64)  NOT NULL,
  updater_id           VARCHAR(64)  NULL,
  updater_type         VARCHAR(16)  NULL,
  update_time          DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_session_turn_no (session_id, turn_no),
  UNIQUE KEY uk_tenant_idempotency (tenant, idempotency_key),
  KEY idx_tenant_deleted (tenant, deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='turns (test fixture, turn-lock testcontainers)'`;

async function applyTurnsDdl(mysqlUrl: string): Promise<void> {
  const conn = await createConnection({ uri: mysqlUrl, multipleStatements: true });
  try {
    await conn.query(TURNS_TABLE_DDL);
  } finally {
    await conn.end();
  }
}

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
const SFID_RE = /^\d{19}$/;
/** 与 CreateSessionRequestSchema.agentId 一致：19 位 BIGINT 安全数 */
const AGENT_ID = '1234567890123456789';
/** 与 `TurnLockService.lockKey` 一致：`agentic:engine:session:turn:lock:<sessionId>` */
function turnLockKey(sessionId: string): string {
  return `agentic:engine:session:turn:lock:${sessionId}`;
}

function mockHeaders(tenant: number, userId: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token',
    'x-mock-tenant-id': String(tenant),
    'x-mock-user-id': userId,
  } as const;
}

interface MessageError {
  code?: string;
  status?: number;
  message?: string;
}

(run ? describe : describe.skip)(
  '[testcontainers] turn-lock concurrency — Redis SETNX',
  () => {
    beforeAll(async () => {
      const s = await startMysqlRedisQdrant();
      try {
        await applyMinimalMysqlSchema(s.mysqlUrl);
        await applyTurnsDdl(s.mysqlUrl);
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

    async function createSession(tenant: number, userId: string): Promise<string> {
      const base = engineHolder.current!.baseUrl;
      const r = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: mockHeaders(tenant, userId),
        body: JSON.stringify({ agentId: AGENT_ID, title: 'tc-turn-lock' }),
      });
      expect(r.status).toBe(201);
      const j = (await r.json()) as { id: string };
      expect(SFID_RE.test(j.id)).toBe(true);
      return j.id;
    }

    /**
     * 等待 turn-lock 被释放（或 TTL 过期）。max = 5s，避免前一 turn 的失败
     * 路径上 release 还在异步排队就提前进入下一轮断言。
     */
    async function waitForLockReleased(
      redisUrl: string,
      sessionId: string,
      maxMs = 5_000,
    ): Promise<void> {
      const r = new Redis(redisUrl, { maxRetriesPerRequest: null });
      try {
        const deadline = Date.now() + maxMs;
        while (Date.now() < deadline) {
          const v = await r.get(turnLockKey(sessionId));
          if (v == null) return;
          await new Promise((res) => setTimeout(res, 50));
        }
      } finally {
        r.disconnect();
      }
    }

    it('concurrent 2 messages → 一个拿锁(200)，一个返 409 RESOURCE_CONFLICT_SESSION_BUSY', async () => {
      const tenant = 91_201;
      const userId = 'tc-lock-user';
      const sid = await createSession(tenant, userId);
      const base = engineHolder.current!.baseUrl;
      const url = `${base}/sessions/${sid}/messages`;
      const headers = mockHeaders(tenant, userId);
      const body = JSON.stringify({ prompt: 'hello' });

      const [a, b] = await Promise.all([
        fetch(url, { method: 'POST', headers, body }),
        fetch(url, { method: 'POST', headers, body }),
      ]);

      const statuses = [a.status, b.status].sort();
      /**
       * `session.controller.startTurn` 没显式 setStatus → bun-server 默认 200；
       * conflict 来自 `RESOURCE_CONFLICT_SESSION_BUSY` → `categoryOf(...)` = 409。
       */
      expect(statuses).toEqual([200, 409]);

      const conflict = a.status === 409 ? a : b;
      const winner = a.status === 409 ? b : a;

      const j = (await conflict.json()) as MessageError;
      expect(j.code).toBe('RESOURCE_CONFLICT_SESSION_BUSY');
      expect(j.status).toBe(409);

      const ok = (await winner.json()) as { turnId?: string };
      expect(typeof ok.turnId).toBe('string');
      expect(ok.turnId).toMatch(/^\d{19}$/);
    });

    it('lock 释放后第二条 message 仍能成功 (lock semantics 仅持有期间互斥)', async () => {
      const tenant = 91_202;
      const userId = 'tc-lock-release-user';
      const sid = await createSession(tenant, userId);
      const base = engineHolder.current!.baseUrl;
      const url = `${base}/sessions/${sid}/messages`;
      const headers = mockHeaders(tenant, userId);

      const r1 = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: 'one' }),
      });
      expect(r1.status).toBe(200);
      const t1 = (await r1.json()) as { turnId?: string };
      expect(typeof t1.turnId).toBe('string');

      /** 等 turn 完成（noop LLM）+ lock 在 `runLlmPhase` finally 释放；走 Redis 探测避免线性 sleep */
      await waitForLockReleased(stackHolder.current!.redisUrl, sid);

      const r2 = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: 'two' }),
      });
      expect(r2.status).toBe(200);
      const t2 = (await r2.json()) as { turnId?: string };
      expect(typeof t2.turnId).toBe('string');
      expect(t2.turnId).not.toBe(t1.turnId);
    });
  },
);
