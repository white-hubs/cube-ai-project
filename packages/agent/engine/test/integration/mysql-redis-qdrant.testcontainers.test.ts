/**
 * MySQL + Redis + Qdrant：Testcontainers 一体化集成测试（单栈共享）。
 *
 * 前置：Docker 守护进程可用（首次运行会拉镜像，可能较慢）。
 *
 *   bun run test:integration（根目录：注入 USE_TESTCONTAINERS=1，推荐）
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/mysql-redis-qdrant.testcontainers.test.ts
 *   bun run test:containers（全部 `*.testcontainers`；含 Nacos 等）
 *
 * 覆盖：存储适配器 + Session REST + Tools BC + 健康/指标 + SSE（Last-Event-ID / 心跳 ping-v1）。
 *
 * 默认裸 `bun test`：整文件 skip（不设 USE_TESTCONTAINERS=1 时不启 Docker）。
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import type { CreateSessionInput } from '@cube-ai/contracts';
import { RedisMemoryStore } from '@cube-ai/agent-engine/adapters/memory';
import { CubeQdrantMemoryIndex } from '@cube-ai/agent-engine/adapters/vector';
import {
  applyMinimalMysqlSchema,
  getFreePort,
  INTEGRATION_TOOL_DESCRIPTOR_SAMPLE_DIR,
  registerProcessShutdown,
  resolveMonorepoRootFromImporter,
  startEngineIntegrationProcess,
  startMysqlRedisQdrant,
  stopTrackedTestcontainersIfAny,
  resolveShouldRunTestcontainers,
  type EngineIntegrationProcess,
  type MysqlRedisQdrantStack,
} from '@cube-ai/test-infra';
import { DEFAULT_ADAPTER_CALL_CONTEXT } from '@tachu/core';
import Redis from 'ioredis';
import type { SafetyModule } from '@tachu/core';
import { createPool, type RowDataPacket } from 'mysql2/promise';
import { DescriptorLoader } from '../../src/bc/descriptor/descriptor-loader';
import { DescriptorRegistryService } from '../../src/bc/descriptor/descriptor-registry.service';
import type { ToolEffectiveVersionSource } from '../../src/bc/descriptor/tool-effective-version.provider';
import { SessionRepositoryImpl } from '../../src/bc/session/repository/session.repository';
import { HttpHandler } from '../../src/bc/tools/handlers/http-handler';
import { ShellHandler } from '../../src/bc/tools/handlers/shell-handler';
import type { ToolHandlerCtx } from '../../src/bc/tools/tool-context';

const run = await resolveShouldRunTestcontainers();

const stackHolder: { current: MysqlRedisQdrantStack | null } = { current: null };
const engineHolder: { current: EngineIntegrationProcess | null } = { current: null };

if (run) {
  // 冷启动需拉取 MySQL/Qdrant/Redis 等镜像，避免与 Bun 默认/隐式 5min 或 10min 上限冲突
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
    // Bun 可能在异步 teardown 完成前就退出；完成后 exit 才能 reliably 删掉容器
    { exitProcessAfterSignal: true },
  );
}

/** 冷镜像 / Ryuk：hook 上限 30min（ms） */
const STACK_HOOK_MS = 1_800_000;

function genSfid(): string {
  const base = String(Date.now());
  return (base + '0'.repeat(19)).slice(0, 19);
}

const SFID_RE = /^\d{19}$/;
/**
 * 与 CreateSessionRequestSchema.agentId（19 位数字串）一致，且必须 ≤ MySQL BIGINT 有符号上限。
 * （9876543210987654321 超出范围会导致 INSERT 失败 → HTTP 500）
 */
const AGENT_ID = '1234567890123456789';

function createMysqlPoolForTest(mysqlUrl: string) {
  return createPool({
    uri: mysqlUrl,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

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

(run ? describe : describe.skip)(
  'MySQL + Redis + Qdrant [testcontainers]',
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
    }, { timeout: STACK_HOOK_MS });

    afterAll(async () => {
      if (engineHolder.current) {
        await engineHolder.current.stop();
        engineHolder.current = null;
      }
      if (stackHolder.current) {
        await stackHolder.current.stop();
        stackHolder.current = null;
      }
    }, { timeout: 120_000 });

    describe('adapter：storage（Qdrant + Redis）', () => {
      it('ST-TC1：Qdrant upsert + searchVector（tenant 过滤）', async () => {
        const url = stackHolder.current!.qdrantUrl;
        const dim = 1536;
        const index = new CubeQdrantMemoryIndex({
          url,
          vectorSize: dim,
          searchTenant: 9013,
        });

        const id = `${Date.now()}0000000001`.slice(0, 19);
        const invSqrt = 1 / Math.sqrt(dim);
        const vec = Array.from({ length: dim }, () => invSqrt);
        const memCtx = { ...DEFAULT_ADAPTER_CALL_CONTEXT, tenant: 9013 };
        await index.upsert(
          [{ id, vector: vec, payload: { text: 'tc-hit', sessionId: 'sess-tc' } }],
          memCtx,
        );

        const hits = await index.searchVector(vec, 5, { must: { tenant: 9013 } }, memCtx);
        expect(hits.length).toBeGreaterThanOrEqual(1);
        expect(hits.some((h) => h.id === id)).toBe(true);
      });

      it('ST-TC2：Redis Memory append / read 顺序', async () => {
        const store = new RedisMemoryStore({
          redisUrl: stackHolder.current!.redisUrl,
          tenantId: 9013,
          ttlSeconds: 3600,
        });
        const sid = `tc-${Date.now()}`;
        const mctx = { ...DEFAULT_ADAPTER_CALL_CONTEXT, tenant: 9013 };
        await store.append(
          sid,
          {
            role: 'user',
            content: 'first',
            timestamp: Date.now(),
            anchored: false,
          },
          mctx,
        );
        await store.append(
          sid,
          {
            role: 'assistant',
            content: 'second',
            timestamp: Date.now(),
            anchored: false,
          },
          mctx,
        );
        const win = await store.load(sid, mctx);
        expect(win.entries.map((e) => e.content)).toEqual(['first', 'second']);
        await store.clear(sid);
        await store.dispose();
      });
    });

    describe('engine：连接 smoke + SessionRepository', () => {
      it('MySQL：连接并 SELECT 1', async () => {
        const pool = createMysqlPoolForTest(stackHolder.current!.mysqlUrl);
        try {
          const [rows] = await pool.query('SELECT 1 AS ok');
          expect(Number((rows as { ok: unknown }[])[0]?.ok)).toBe(1);
        } finally {
          await pool.end();
        }
      });

      it('Redis：PING', async () => {
        const r = new Redis(stackHolder.current!.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: null,
        });
        try {
          await r.connect();
          expect(await r.ping()).toBe('PONG');
        } finally {
          r.disconnect();
        }
      });

      it('Qdrant：HTTP 就绪', async () => {
        const res = await fetch(stackHolder.current!.qdrantUrl);
        expect(res.ok).toBe(true);
      });

      it('SessionRepository：insertWithConnection（rollback 后不可见）', async () => {
        const pool = createMysqlPoolForTest(stackHolder.current!.mysqlUrl);
        const repo = new SessionRepositoryImpl(pool);
        const tenant = 42_000;
        const sessionId = genSfid();
        const agentId = genSfid();
        const now = Date.now();
        const input: CreateSessionInput = {
          tenant,
          userId: 'tc-user',
          agentId,
          agentVersionNo: 1,
          agentSnapshotJson: {
            schema: 'agent-snapshot-v1',
            agent: { id: agentId },
          },
          userPrincipalSnapshotJson: {
            schema: 'user-principal-v1',
            tenant,
            userId: 'tc-user',
          },
          title: 'tc',
          status: 'ACTIVE',
          lastTurnId: null,
          lastActiveTime: now,
          contextJson: null,
        };

        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const row = await repo.insertWithConnection(conn, tenant, sessionId, input);
          expect(row.id).toBe(sessionId);
          await conn.rollback();
        } finally {
          conn.release();
        }

        const found = await repo.findById(tenant, sessionId);
        expect(found).toBeNull();
        await pool.end();
      });
    });

    describe('Tools BC（进程内 + Engine health）', () => {
      const noopPin: ToolEffectiveVersionSource = {
        refreshFromNacos: async () => {},
        getPinnedVersion: async () => undefined,
      };

      const SAMPLE_DIR = INTEGRATION_TOOL_DESCRIPTOR_SAMPLE_DIR;

      const safetyOk = {
        checkBaseline: async () => ({ passed: true, violations: [] }),
      } as unknown as SafetyModule;

      const MOCK_CTX: ToolHandlerCtx = {
        traceId: 'integration-trace',
        signal: new AbortController().signal,
        auth: { tenant: 1, user: { userId: '1', scopes: [] } },
        session: { id: '1234567890123456789', turnId: '1234567890123456788' },
      };

      it('scan sample-descriptors → registry 内有 echo', async () => {
        const registry = new DescriptorRegistryService(noopPin);
        const loader = new DescriptorLoader(registry, noopPin);

        const { loaded } = await loader.loadFromDir(SAMPLE_DIR);
        expect(loaded).toBeGreaterThanOrEqual(1);

        const echo = registry.resolve('platform.echo');
        expect(echo).toBeDefined();
        expect(echo?.name).toBe('platform.echo');
        expect(echo?.meta.execution).toBe('LOCAL');
        expect(echo?.isPreset).toBe(true);
      });

      it('GET /health/live（子进程 Engine）', async () => {
        const base = engineHolder.current!.baseUrl;
        const resp = await fetch(`${base}/health/live`);
        expect(resp.status).toBe(200);
        const j = (await resp.json()) as { status?: string };
        expect(j.status).toBe('UP');
      });

      it('GET /health/ready — 200，status=UP', async () => {
        const base = engineHolder.current!.baseUrl;
        const resp = await fetch(`${base}/health/ready`);
        expect(resp.status).toBe(200);
        const j = (await resp.json()) as {
          status?: string;
          details?: Record<string, unknown>;
        };
        expect(j.status).toBe('UP');
        expect(j.details).toBeDefined();
      });

      it('GET /metrics — Prometheus 文本，含 agentic_engine 前缀指标', async () => {
        const base = engineHolder.current!.baseUrl;
        const res = await fetch(`${base}/metrics`);
        expect(res.status).toBe(200);
        const ct = res.headers.get('content-type') ?? '';
        expect(ct).toContain('text/plain');
        const text = await res.text();
        expect(text.length).toBeGreaterThan(20);
        expect(text).toContain('# HELP');
        expect(text).toContain('agentic_engine_');
        expect(text).toContain('agentic_engine_http_requests_total');
      });

      it('HTTP handler → 本地 echo HTTP 返回 JSON', async () => {
        let srv!: ReturnType<typeof Bun.serve>;
        srv = Bun.serve({
          port: 0,
          fetch: () => Response.json({ ping: 'pong' }),
        });
        try {
          const handler = new HttpHandler();
          const out = await handler.invoke(
            { url: `http://127.0.0.1:${srv.port}/`, method: 'GET' },
            MOCK_CTX,
          );
          expect(out.statusCode).toBe(200);
          expect(out.body).toEqual({ ping: 'pong' });
        } finally {
          srv.stop();
        }
      });

      it('shell handler → 黑名单命令拦截', async () => {
        const handler = new ShellHandler(safetyOk);
        await expect(
          handler.invoke({ command: 'rm', args: ['x'] }, MOCK_CTX),
        ).rejects.toMatchObject({
          code: 'PERMISSION_DENIED_SHELL_BLACKLISTED_COMMAND',
        });
      });

      it('MCP bridge：未配置 server 时 callTool 报 UPSTREAM_MCP_TOOL_FAILED', async () => {
        const { McpBridgeService } = await import('../../src/bc/tools/mcp-bridge.service');
        const bridge = new McpBridgeService();
        await bridge.init();
        await expect(bridge.callTool('no-such-server', 't', {})).rejects.toMatchObject({
          code: 'UPSTREAM_MCP_TOOL_FAILED',
        });
      });
    });

    describe('HTTP + SSE（子进程 Engine）', () => {
      it('POST /v1/sessions — 201，id 为 19 位 SFID；响应 JSON 不含 tenant', async () => {
        const tenant = 91_101;
        const base = engineHolder.current!.baseUrl;
        const body = { agentId: AGENT_ID, title: 'tc-http-create' };
        expect(Object.hasOwn(body, 'tenant')).toBe(false);

        const resp = await fetch(`${base}/v1/sessions`, {
          method: 'POST',
          headers: mockHeaders(tenant, 'tc-http-user'),
          body: JSON.stringify(body),
        });

        expect(resp.status).toBe(201);
        const json = (await resp.json()) as Record<string, unknown>;
        expect(typeof json['id']).toBe('string');
        expect(SFID_RE.test(String(json['id']))).toBe(true);
        expect(json).not.toHaveProperty('tenant');
      });

      it('GET /v1/sessions/:id — 非所属 tenant 返回 404', async () => {
        const tenantA = 91_102;
        const tenantB = 91_103;
        const base = engineHolder.current!.baseUrl;
        const userA = 'tc-iso-user';

        const created = await fetch(`${base}/v1/sessions`, {
          method: 'POST',
          headers: mockHeaders(tenantA, userA),
          body: JSON.stringify({ agentId: AGENT_ID }),
        });
        expect(created.status).toBe(201);
        const { id } = (await created.json()) as { id: string };

        const wrongTenant = await fetch(`${base}/v1/sessions/${id}`, {
          method: 'GET',
          cache: 'no-store',
          headers: mockHeaders(tenantB, userA),
        });
        expect(wrongTenant.status).toBe(404);
      });

      it('DELETE /v1/sessions/:id — 204；outbox_events 含 session.deleted', async () => {
        const tenant = 91_104;
        const base = engineHolder.current!.baseUrl;
        const mysqlUrl = stackHolder.current!.mysqlUrl;

        const created = await fetch(`${base}/v1/sessions`, {
          method: 'POST',
          headers: mockHeaders(tenant, 'tc-del-user'),
          body: JSON.stringify({ agentId: AGENT_ID }),
        });
        expect(created.status).toBe(201);
        const { id } = (await created.json()) as { id: string };

        const del = await fetch(`${base}/v1/sessions/${id}`, {
          method: 'DELETE',
          headers: mockHeaders(tenant, 'tc-del-user'),
        });
        expect(del.status).toBe(204);

        const pool = createMysqlPoolForTest(mysqlUrl);
        try {
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT event_type, payload_json FROM outbox_events
             WHERE tenant = ? AND event_type = 'session.deleted' AND deleted = 0
             ORDER BY create_time DESC LIMIT 20`,
            [tenant],
          );

          const hit = rows.some((r) => {
            const p = parsePayload(r);
            const sid = p['sessionId'];
            return String(sid ?? '') === String(id);
          });
          expect(hit).toBe(true);
        } finally {
          await pool.end();
        }
      });

      it('SSE：GET /v1/sessions/:id/events 返回 text/event-stream', async () => {
        const tenant = 91_105;
        const base = engineHolder.current!.baseUrl;

        const post = await fetch(`${base}/v1/sessions`, {
          method: 'POST',
          headers: mockHeaders(tenant, 'tc-sse-user'),
          body: JSON.stringify({ agentId: AGENT_ID, title: 'tc-sse' }),
        });
        expect(post.status).toBe(201);
        const { id: sid } = (await post.json()) as { id: string };

        const res = await fetch(`${base}/v1/sessions/${sid}/events`, {
          headers: mockHeaders(tenant, 'tc-sse-user'),
        });

        expect(res.ok).toBe(true);
        const ct = res.headers.get('Content-Type') ?? '';
        expect(ct.toLowerCase()).toContain('text/event-stream');
        expect(res.body).not.toBeNull();

        const reader = res.body!.getReader();
        const t = setTimeout(() => {
          void reader.cancel();
        }, 5_000);
        try {
          await reader.read();
        } catch {
          /* cancel */
        } finally {
          clearTimeout(t);
        }
      }, { timeout: 60_000 });

      it('GET /v1/sessions/:id — 所属 tenant 返回 200', async () => {
        const tenant = 91_106;
        const base = engineHolder.current!.baseUrl;
        const user = 'tc-get-user';
        const created = await fetch(`${base}/v1/sessions`, {
          method: 'POST',
          headers: mockHeaders(tenant, user),
          body: JSON.stringify({ agentId: AGENT_ID, title: 'tc-get' }),
        });
        expect(created.status).toBe(201);
        const { id } = (await created.json()) as { id: string };

        const got = await fetch(`${base}/v1/sessions/${id}`, {
          headers: mockHeaders(tenant, user),
        });
        expect(got.status).toBe(200);
        const body = (await got.json()) as Record<string, unknown>;
        expect(body['id']).toBe(id);
      });

      it('SSE：Last-Event-ID 重连后仍为 event-stream', async () => {
        const tenant = 91_107;
        const base = engineHolder.current!.baseUrl;
        const post = await fetch(`${base}/v1/sessions`, {
          method: 'POST',
          headers: mockHeaders(tenant, 'tc-lae-user'),
          body: JSON.stringify({ agentId: AGENT_ID }),
        });
        expect(post.status).toBe(201);
        const { id: sid } = (await post.json()) as { id: string };

        const ac = new AbortController();
        /** 首条带 id 的 SSE 常为心跳 ping（emitter 约 25s 间隔） */
        const abortTimer = setTimeout(() => ac.abort(), 32_000);
        let buf = '';
        try {
          const res = await fetch(`${base}/v1/sessions/${sid}/events`, {
            headers: {
              ...mockHeaders(tenant, 'tc-lae-user'),
              Accept: 'text/event-stream',
            },
            signal: ac.signal,
          });
          expect(res.ok).toBe(true);
          const reader = res.body!.getReader();
          const dec = new TextDecoder();
          const deadline = Date.now() + 31_000;
          while (Date.now() < deadline) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value);
            if (/id:\s*\d{1,20}:\d{6}/.test(buf)) break;
          }
          await reader.cancel().catch(() => {});
        } finally {
          clearTimeout(abortTimer);
        }

        const eventId = buf.match(/id:\s*(\d{1,20}:\d{6})/)?.[1];
        expect(eventId).toBeTruthy();

        const res2 = await fetch(`${base}/v1/sessions/${sid}/events`, {
          headers: {
            ...mockHeaders(tenant, 'tc-lae-user'),
            Accept: 'text/event-stream',
            'Last-Event-ID': eventId!,
          },
        });
        expect(res2.ok).toBe(true);
        expect((res2.headers.get('Content-Type') ?? '').toLowerCase()).toContain(
          'text/event-stream',
        );
      }, { timeout: 70_000 });

      it('SSE：心跳含 ping-v1（≤36s）', async () => {
        const tenant = 91_108;
        const base = engineHolder.current!.baseUrl;
        const post = await fetch(`${base}/v1/sessions`, {
          method: 'POST',
          headers: mockHeaders(tenant, 'tc-ping-user'),
          body: JSON.stringify({ agentId: AGENT_ID }),
        });
        expect(post.status).toBe(201);
        const { id: sid } = (await post.json()) as { id: string };

        const ac = new AbortController();
        const res = await fetch(`${base}/v1/sessions/${sid}/events`, {
          headers: mockHeaders(tenant, 'tc-ping-user'),
          signal: ac.signal,
        });
        expect(res.ok).toBe(true);
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';
        const deadline = Date.now() + 37_000;
        while (Date.now() < deadline) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value);
          if (buf.includes('ping-v1')) break;
        }
        ac.abort();
        expect(buf).toContain('ping-v1');
      }, { timeout: 50_000 });
    });
  },
);
