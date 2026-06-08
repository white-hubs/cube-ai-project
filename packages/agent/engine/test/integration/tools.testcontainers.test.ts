/**
 * Tools BC — Testcontainers 差异化补丁。
 *
 * **覆盖策略说明（防重复）**
 *
 * `mysql-redis-qdrant.testcontainers.test.ts` 已覆盖：
 *   - DescriptorRegistry scan sample-descriptors → echo
 *   - GET /health/live、/health/ready、/metrics
 *   - HttpHandler 本地 echo HTTP 返回 JSON
 *   - ShellHandler 黑名单命令拦截
 *   - McpBridgeService 无配置时 callTool 报 UPSTREAM_MCP_TOOL_FAILED
 *
 * 因此 `tools.integration.test.ts` 中 5 个 `test.skip`（scan/health/http/shell/mcp）
 * 不再于本文件重复实装；本文件聚焦 ToolService / Descriptor 高级路径：
 *
 *   1. DescriptorRegistry：同 name+version → RESOURCE_CONFLICT_DESCRIPTOR_DUPLICATE
 *   2. DescriptorRegistry：版本非单调 → RESOURCE_CONFLICT_DESCRIPTOR_VERSION_NOT_MONOTONIC
 *   3. DescriptorRegistry.replaceAllFromSnapshot：清空后按版本升序注册
 *   4. DescriptorRegistry.getEffectiveVersion：pinSource 覆盖 registry 最新
 *   5. HttpHandler：upstream 5xx 触发 UPSTREAM_TOOL_HTTP_FAILED（重试到上限后失败）
 *   6. HttpHandler：query 参数拼接到 URL（GET）
 *
 * 这些用例不实际依赖 MySQL/Redis 数据，但仍按"集成测试统一走 Testcontainers"
 * 的工程约束启 minimal MySQL 栈，作为 `USE_TESTCONTAINERS=1` gate 的一致触发面。
 *
 * 前置：Docker daemon 可用，`USE_TESTCONTAINERS=1`：
 *   bun run test:containers
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/tools.testcontainers.test.ts
 *
 * 权威：docs/detailed-design/07-tools/registration-lifecycle.md §2.2 / §4.2
 */
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
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlOnly,
  stopTrackedTestcontainersIfAny,
  type MysqlOnlyStack,
} from '@cube-ai/test-infra';
import {
  ToolDescriptor,
  type ToolDescriptor as ToolDescriptorT,
} from '@cube-ai/contracts';
import { DescriptorRegistryService } from '../../src/bc/descriptor/descriptor-registry.service';
import type { ToolEffectiveVersionSource } from '../../src/bc/descriptor/tool-effective-version.provider';
import { HttpHandler } from '../../src/bc/tools/handlers/http-handler';
import type { ToolHandlerCtx } from '../../src/bc/tools/tool-context';

const run = await resolveShouldRunTestcontainers();
const stackHolder: { current: MysqlOnlyStack | null } = { current: null };
const HOOK_MS = 1_800_000;

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

const noopPin: ToolEffectiveVersionSource = {
  refreshFromNacos: async () => {},
  getPinnedVersion: async () => undefined,
};

const MOCK_CTX: ToolHandlerCtx = {
  traceId: 'integration-trace',
  signal: new AbortController().signal,
  auth: { tenant: 1, user: { userId: '1', scopes: [] } },
  session: { id: '1234567890123456789', turnId: '1234567890123456788' },
};

/**
 * Build a minimal valid ToolDescriptor with overridable name / version.
 * Uses LOCAL execution + http handler to satisfy descriptor-schema cross-checks.
 */
function makeDescriptor(name: string, version: string): ToolDescriptorT {
  return ToolDescriptor.parse({
    schemaVersion: 1,
    kind: 'TOOL',
    name,
    displayName: name,
    description: `${name}@${version}`,
    isPreset: false,
    version,
    meta: {
      execution: 'LOCAL',
      consent: 'NEVER',
      requiresPrincipal: 'USER',
      timeoutMs: 1_000,
      idempotent: true,
      sideEffects: [],
    },
    inputSchema: {
      type: 'object',
      required: ['x'],
      properties: { x: { type: 'string' } },
    },
    outputSchema: {
      type: 'object',
      required: ['y'],
      properties: { y: { type: 'string' } },
    },
    requires: { principal: 'USER', oauthScope: [], obo: null },
    execute: `builtin:${name}`,
    handler: { kind: 'http', config: {} },
    tags: ['tc'],
    category: 'PLATFORM',
    costEstimate: { category: 'IO_LIGHT' },
  });
}

(run ? describe : describe.skip)(
  '[testcontainers] Tools BC — supplementary scenarios',
  () => {
    beforeAll(async () => {
      const s = await startMysqlOnly();
      try {
        await applyMinimalMysqlSchema(s.mysqlUrl);
        stackHolder.current = s;
      } catch (e) {
        await s.stop();
        throw e;
      }
    }, HOOK_MS);

    afterAll(async () => {
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
      await stopTrackedTestcontainersIfAny();
    });

    describe('DescriptorRegistry — guard rails', () => {
      it('rejects duplicate (name@version) with RESOURCE_CONFLICT_DESCRIPTOR_DUPLICATE', () => {
        const reg = new DescriptorRegistryService(noopPin);
        reg.register(makeDescriptor('platform.tc.dup', '1.0.0'));
        expect(() => reg.register(makeDescriptor('platform.tc.dup', '1.0.0'))).toThrow(
          /Duplicate descriptor/i,
        );
      });

      it('rejects non-monotonic version with RESOURCE_CONFLICT_DESCRIPTOR_VERSION_NOT_MONOTONIC', () => {
        const reg = new DescriptorRegistryService(noopPin);
        reg.register(makeDescriptor('platform.tc.mono', '1.2.0'));
        expect(() => reg.register(makeDescriptor('platform.tc.mono', '1.1.9'))).toThrow(
          /not monotonically greater/i,
        );
      });

      it('replaceAllFromSnapshot clears and re-registers in version order', () => {
        const reg = new DescriptorRegistryService(noopPin);
        reg.register(makeDescriptor('platform.tc.replace', '1.0.0'));
        expect(reg.size()).toBe(1);

        reg.replaceAllFromSnapshot([
          makeDescriptor('platform.tc.replace', '2.0.0'),
          makeDescriptor('platform.tc.replace', '1.5.0'),
          makeDescriptor('platform.tc.other', '1.0.0'),
        ]);

        expect(reg.size()).toBe(3);
        const resolved = reg.resolve('platform.tc.replace');
        expect(resolved?.version).toBe('2.0.0');
        const v15 = reg.resolve('platform.tc.replace', '1.5.0');
        expect(v15?.version).toBe('1.5.0');
      });

      it('getEffectiveVersion: pinSource overrides registry latest', async () => {
        const pinSource: ToolEffectiveVersionSource = {
          refreshFromNacos: async () => {},
          getPinnedVersion: async (toolName) =>
            toolName === 'platform.tc.pin' ? '1.0.0' : undefined,
        };
        const reg = new DescriptorRegistryService(pinSource);
        reg.register(makeDescriptor('platform.tc.pin', '1.0.0'));
        reg.register(makeDescriptor('platform.tc.pin', '2.0.0'));
        const eff = await reg.getEffectiveVersion('platform.tc.pin');
        expect(eff).toBe('1.0.0');

        const unpinned = await reg.getEffectiveVersion('platform.tc.replace');
        expect(unpinned).toBeUndefined();
      });
    });

    describe('HttpHandler — failure & query semantics', () => {
      it('upstream 5xx → UPSTREAM_TOOL_HTTP_FAILED after retries are exhausted', async () => {
        let calls = 0;
        const srv = Bun.serve({
          port: 0,
          fetch: () => {
            calls += 1;
            return new Response('boom', { status: 503 });
          },
        });
        const prevMax = process.env['AGENTIC_ENGINE_HTTP_RETRY_MAX'];
        const prevBackoff = process.env['AGENTIC_ENGINE_HTTP_RETRY_BACKOFF_MS'];
        process.env['AGENTIC_ENGINE_HTTP_RETRY_MAX'] = '2';
        process.env['AGENTIC_ENGINE_HTTP_RETRY_BACKOFF_MS'] = '1';
        try {
          const handler = new HttpHandler();
          await expect(
            handler.invoke(
              { url: `http://127.0.0.1:${srv.port}/`, method: 'GET' },
              MOCK_CTX,
            ),
          ).rejects.toMatchObject({ code: 'UPSTREAM_TOOL_HTTP_FAILED' });
          expect(calls).toBeGreaterThanOrEqual(2);
        } finally {
          srv.stop();
          if (prevMax === undefined) delete process.env['AGENTIC_ENGINE_HTTP_RETRY_MAX'];
          else process.env['AGENTIC_ENGINE_HTTP_RETRY_MAX'] = prevMax;
          if (prevBackoff === undefined) delete process.env['AGENTIC_ENGINE_HTTP_RETRY_BACKOFF_MS'];
          else process.env['AGENTIC_ENGINE_HTTP_RETRY_BACKOFF_MS'] = prevBackoff;
        }
      });

      it('GET with query string is appended to URL', async () => {
        const seenUrls: string[] = [];
        const srv = Bun.serve({
          port: 0,
          fetch: (req) => {
            seenUrls.push(req.url);
            return Response.json({ ok: true });
          },
        });
        try {
          const handler = new HttpHandler();
          const out = await handler.invoke(
            {
              url: `http://127.0.0.1:${srv.port}/api`,
              method: 'GET',
              query: { foo: 'bar', n: '42' },
            },
            MOCK_CTX,
          );
          expect(out.statusCode).toBe(200);
          expect(seenUrls.length).toBe(1);
          const u = new URL(seenUrls[0]!);
          expect(u.searchParams.get('foo')).toBe('bar');
          expect(u.searchParams.get('n')).toBe('42');
        } finally {
          srv.stop();
        }
      });
    });
  },
);
