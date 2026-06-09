/**
 * Session REST — Testcontainers 差异化补丁。
 *
 * **覆盖策略说明（防重复）**
 *
 * `mysql-redis-qdrant.testcontainers.test.ts` 已统一覆盖以下 REST 主链路：
 *   - POST /sessions — 201, id 为 19 位 SFID, 响应 JSON 不含 tenant
 *   - GET  /sessions/:id — 200 (own tenant) / 404 (other tenant)
 *   - DELETE /sessions/:id — 204 + outbox `session.deleted`
 *   - SSE event-stream / Last-Event-ID / 心跳 ping-v1
 *
 * 因此 `sessions.integration.test.ts` 中 3 个 `test.skip` 用例（POST/GET-404/DELETE）
 * 不再于本文件重复实装；本文件只补充未被覆盖的差异化场景：
 *
 *   1. POST 链路同事务写入 `session_lifecycle / session.created` outbox 行
 *      （DELETE 已在 mysql-redis-qdrant 覆盖；CREATE 是 P3-04 关键不变式补强）
 *   2. GET /sessions（list 分页端点）— 行级 tenant 隔离 + page meta
 *
 * 前置：Docker daemon 可用，`USE_TESTCONTAINERS=1`：
 *   bun run test:containers
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/sessions.testcontainers.test.ts
 *
 * 权威：docs/technical-design/prompts/phase-3/P3-04-session-rest.md §6
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
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
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
const SFID_RE = /^\d{19}$/;
/** 与 CreateSessionRequestSchema.agentId 一致：19 位 BIGINT 安全数 */
const AGENT_ID = '1234567890123456789';

function mockHeaders(tenant: number, userId: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token',
    'x-mock-tenant-id': String(tenant),
    'x-mock-user-id': userId,
  } as const;
}

function parsePayload(row: RowDataPacket & { payload_json?: unknown }): Record<string, unknown> {
  const raw = row['payload_json'];
  if (raw == null) return {};
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw as Record<string, unknown>;
  const s = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  return JSON.parse(s) as Record<string, unknown>;
}

function createMysqlPool(mysqlUrl: string): Pool {
  return createPool({
    uri: mysqlUrl,
    connectionLimit: 4,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

(run ? describe : describe.skip)(
  '[testcontainers] Session REST — supplementary scenarios',
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

    it('POST /sessions — same transaction writes session_lifecycle / session.created outbox', async () => {
      const tenant = 92_201;
      const base = engineHolder.current!.baseUrl;
      const created = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: mockHeaders(tenant, 'tc-create-outbox'),
        body: JSON.stringify({ agentId: AGENT_ID, title: 'tc-create-outbox' }),
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      expect(SFID_RE.test(id)).toBe(true);

      const pool = createMysqlPool(stackHolder.current!.mysqlUrl);
      try {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT event_type, channel, payload_json FROM outbox_events
             WHERE tenant = ? AND event_type = 'session.created' AND deleted = 0
             ORDER BY create_time DESC LIMIT 20`,
          [tenant],
        );

        const hit = rows.find((r) => parsePayload(r)['sessionId'] === id);
        expect(hit).toBeDefined();
        expect(hit!['channel']).toBe('session_lifecycle');
        const p = parsePayload(hit!);
        expect(p['tenant']).toBe(tenant);
        expect(p['userId']).toBe('tc-create-outbox');
        expect(typeof p['occurredTime']).toBe('number');
      } finally {
        await pool.end();
      }
    });

    it('GET /sessions — list returns owner sessions with page metadata', async () => {
      const tenant = 92_202;
      const userId = 'tc-list-user';
      const base = engineHolder.current!.baseUrl;

      /** 创建 2 个会话 → list 应返回 2 项 */
      const titles = ['tc-list-1', 'tc-list-2'];
      const ids: string[] = [];
      for (const title of titles) {
        const r = await fetch(`${base}/sessions`, {
          method: 'POST',
          headers: mockHeaders(tenant, userId),
          body: JSON.stringify({ agentId: AGENT_ID, title }),
        });
        expect(r.status).toBe(201);
        const j = (await r.json()) as { id: string };
        ids.push(j.id);
      }

      /** 另一个 tenant 创建一个会话 → list 不应包含 */
      const otherTenant = 92_203;
      const otherCreate = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: mockHeaders(otherTenant, 'tc-list-other'),
        body: JSON.stringify({ agentId: AGENT_ID, title: 'tc-list-other' }),
      });
      expect(otherCreate.status).toBe(201);

      const listResp = await fetch(`${base}/sessions?limit=10`, {
        headers: mockHeaders(tenant, userId),
      });
      expect(listResp.status).toBe(200);
      const body = (await listResp.json()) as {
        items: Array<{ id: string; userId: string; title: string | null }>;
        page: { nextCursor?: string; hasMore: boolean };
      };
      expect(body.page).toBeDefined();
      expect(typeof body.page.hasMore).toBe('boolean');
      expect(Array.isArray(body.items)).toBe(true);

      const myIdSet = new Set(body.items.map((i) => i.id));
      for (const id of ids) {
        expect(myIdSet.has(id)).toBe(true);
      }
      for (const item of body.items) {
        expect(item.userId).toBe(userId);
      }
    });
  },
);
