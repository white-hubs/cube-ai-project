/**
 * Auth BC — Testcontainers 端到端（OAuth2 introspection 模式）。
 *
 * 迁移自 `auth.integration.test.ts`（保留 `describe.skip` 占位）。
 *
 * 覆盖：在 `AGENTIC_ENGINE_AUTH_MODE=oauth2` 下用一个进程内 mock IdP（`Bun.serve`
 *      监听 127.0.0.1 + getFreePort），同时暴露：
 *        - `GET  /oauth2/jwks`        — 返回单条 RS256 公钥（kid 与签发 JWT 一致）
 *        - `POST /oauth2/introspect`  — 返回 active=true 与 tenant_id / sub / scope
 *      Engine 子进程通过 `extraEnv` 注入 OAuth2 + IdP URL；engine 内部走完整双链：
 *      JWKS 远程拉取 + JWT 签名校验 → 调用 introspect → 写 Redis 缓存 → 业务路由。
 *
 * 前置：Docker daemon 可用，`USE_TESTCONTAINERS=1`：
 *   bun run test:containers
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/auth.testcontainers.test.ts
 *
 * 权威：
 *   - docs/detailed-design/04-auth-and-authz/oauth2-flow.md §2.2 / §4
 *   - docs/technical-design/prompts/phase-3/P3-02-auth-oauth2.md §3.1
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
import { exportJWK, SignJWT, type JWK, type KeyLike } from 'jose';
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
const idpHolder: { current: ReturnType<typeof Bun.serve> | null } = { current: null };

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      if (engineHolder.current) {
        await engineHolder.current.stop().catch(() => {});
        engineHolder.current = null;
      }
      if (idpHolder.current) {
        try {
          idpHolder.current.stop();
        } catch {
          /* ignore */
        }
        idpHolder.current = null;
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
const KID = 'mock-idp-test-kid-v1';
const TEST_TENANT_ID = '91001';
const TEST_USER_ID = 'test-user-01';
/** 与 CreateSessionRequestSchema.agentId 一致：19 位 BIGINT 安全数 */
const AGENT_ID = '1234567890123456789';

interface MockIdpKeys {
  privateKey: KeyLike;
  publicJwk: JWK;
}

async function generateMockIdpKeys(): Promise<MockIdpKeys> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = await exportJWK(pair.publicKey);
  const publicJwk: JWK = { ...jwk, kid: KID, use: 'sig', alg: 'RS256' };
  return { privateKey: pair.privateKey as unknown as KeyLike, publicJwk };
}

function startMockIdp(port: number, keys: MockIdpKeys, expectedClientId: string) {
  return Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (url.pathname === '/oauth2/jwks' && req.method === 'GET') {
        return Response.json({ keys: [keys.publicJwk] });
      }

      if (url.pathname === '/oauth2/introspect' && req.method === 'POST') {
        const auth = req.headers.get('authorization') ?? '';
        if (!auth.startsWith('Basic ')) {
          return new Response('client_auth_required', { status: 401 });
        }
        try {
          const decoded = Buffer.from(auth.slice('Basic '.length), 'base64').toString('utf8');
          const [cid] = decoded.split(':');
          if (cid !== expectedClientId) {
            return new Response('invalid_client', { status: 401 });
          }
        } catch {
          return new Response('invalid_basic_auth', { status: 401 });
        }
        const body = await req.text();
        const params = new URLSearchParams(body);
        const token = params.get('token') ?? '';
        if (!token) {
          return Response.json({ active: false });
        }
        return Response.json({
          active: true,
          sub: TEST_USER_ID,
          user_name: TEST_USER_ID,
          tenant_id: TEST_TENANT_ID,
          scope: 'engine.use openid',
          client_id: expectedClientId,
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
      }

      return new Response('not found', { status: 404 });
    },
  });
}

async function signTestJwt(keys: MockIdpKeys, issuer: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: KID })
    .setIssuer(issuer)
    .setSubject(TEST_USER_ID)
    .setAudience('agentic-engine')
    .setIssuedAt(nowSec)
    .setNotBefore(nowSec)
    .setExpirationTime(nowSec + 3600)
    .sign(keys.privateKey);
}

(run ? describe : describe.skip)(
  '[testcontainers] Auth BC — oauth2 introspection mode',
  () => {
    let keys: MockIdpKeys;
    let idpBaseUrl: string;
    const clientId = 'mock-test-client';

    beforeAll(async () => {
      const s = await startMysqlRedisQdrant();
      try {
        await applyMinimalMysqlSchema(s.mysqlUrl);
        stackHolder.current = s;
      } catch (e) {
        await s.stop();
        throw e;
      }

      keys = await generateMockIdpKeys();
      const idpPort = await getFreePort();
      idpBaseUrl = `http://127.0.0.1:${idpPort}`;
      idpHolder.current = startMockIdp(idpPort, keys, clientId);

      const enginePort = await getFreePort();
      const repoRoot = resolveMonorepoRootFromImporter(import.meta.dir);
      try {
        const eng = await startEngineIntegrationProcess({
          stack: s,
          port: enginePort,
          repoRoot,
          extraEnv: {
            AGENTIC_ENGINE_AUTH_MODE: 'oauth2',
            AGENTIC_ENGINE_OAUTH2_INTROSPECTION_URL: `${idpBaseUrl}/oauth2/introspect`,
            AGENTIC_ENGINE_OAUTH2_JWKS_URI: `${idpBaseUrl}/oauth2/jwks`,
            AGENTIC_ENGINE_OAUTH2_EXPECTED_ISSUER: idpBaseUrl,
            AGENTIC_ENGINE_OAUTH2_CLIENT_ID: clientId,
            AGENTIC_ENGINE_OAUTH2_CLIENT_SECRET: 'mock-test-secret',
          },
        });
        engineHolder.current = eng;
      } catch (e) {
        if (idpHolder.current) {
          try {
            idpHolder.current.stop();
          } catch {
            /* ignore */
          }
          idpHolder.current = null;
        }
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
      if (idpHolder.current) {
        try {
          idpHolder.current.stop();
        } catch {
          /* ignore */
        }
        idpHolder.current = null;
      }
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
      await stopTrackedTestcontainersIfAny();
    });

    it('rejects POST /sessions without Bearer token (401 UNAUTHENTICATED)', async () => {
      const base = engineHolder.current!.baseUrl;
      const res = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: AGENT_ID }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      expect(String(body.code ?? '')).toMatch(/UNAUTHENTICATED/);
    });

    it('rejects POST /sessions with malformed Bearer (401)', async () => {
      const base = engineHolder.current!.baseUrl;
      const res = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer not.a.valid.jwt.at.all',
        },
        body: JSON.stringify({ agentId: AGENT_ID }),
      });
      expect(res.status).toBe(401);
    });

    it('accepts POST /sessions with valid JWT + introspect=active (201)', async () => {
      const base = engineHolder.current!.baseUrl;
      const token = await signTestJwt(keys, idpBaseUrl);
      const res = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ agentId: AGENT_ID, title: 'oauth2-tc' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(typeof body['id']).toBe('string');
      expect(String(body['id'])).toMatch(/^\d{19}$/);
      expect(Object.hasOwn(body, 'tenant')).toBe(false);
    });

    it('GET /metrics is bypassed by AuthN even in oauth2 mode (200)', async () => {
      const base = engineHolder.current!.baseUrl;
      const res = await fetch(`${base}/metrics`);
      expect(res.status).toBe(200);
    });
  },
);
