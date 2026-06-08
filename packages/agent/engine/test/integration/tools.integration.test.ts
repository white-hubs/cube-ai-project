/**
 * Tools BC：进程内用例 + Engine health 已并入
 * `mysql-redis-qdrant.testcontainers.test.ts`（`USE_TESTCONTAINERS=1`）。
 * 本文件保留为可选本地 / 无 Docker 时手动跑（解 `test.skip`）。
 */
import { describe, test, expect } from 'bun:test';
import { DescriptorRegistryService } from '../../src/bc/descriptor/descriptor-registry.service';
import { DescriptorLoader } from '../../src/bc/descriptor/descriptor-loader';
import type { ToolEffectiveVersionSource } from '../../src/bc/descriptor/tool-effective-version.provider';
import { HttpHandler } from '../../src/bc/tools/handlers/http-handler';
import { ShellHandler } from '../../src/bc/tools/handlers/shell-handler';
import type { SafetyModule } from '@tachu/core';
import type { ToolHandlerCtx } from '../../src/bc/tools/tool-context';
import { INTEGRATION_TOOL_DESCRIPTOR_SAMPLE_DIR } from '@cube-ai/test-infra';

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
  signal:  new AbortController().signal,
  auth:    { tenant: 1, user: { userId: '1', scopes: [] } },
  session: { id: '1234567890123456789', turnId: '1234567890123456788' },
};

describe('Tools BC Integration', () => {
  test.skip('scan sample-descriptors → registry 内有 echo', async () => {
    const registry = new DescriptorRegistryService(noopPin);
    const loader   = new DescriptorLoader(registry, noopPin);

    const { loaded } = await loader.loadFromDir(SAMPLE_DIR);
    expect(loaded).toBeGreaterThanOrEqual(1);

    const echo = registry.resolve('platform.echo');
    expect(echo).toBeDefined();
    expect(echo?.name).toBe('platform.echo');
    expect(echo?.meta.execution).toBe('LOCAL');
    expect(echo?.isPreset).toBe(true);
  });

  test.skip('engine HTTP /health/live 返回 200（engine 已启动）', async () => {
    const port = Number(process.env['TEST_PORT'] ?? process.env['AGENTIC_ENGINE_PORT'] ?? 4010);
    const resp = await fetch(`http://127.0.0.1:${port}/health/live`);
    expect(resp.status).toBe(200);
  });

  test.skip('HTTP handler → 本地 echo HTTP 返回 JSON', async () => {
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

  test.skip('shell handler → 黑名单命令拦截', async () => {
    const handler = new ShellHandler(safetyOk);
    await expect(
      handler.invoke({ command: 'rm', args: ['x'] }, MOCK_CTX),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED_SHELL_BLACKLISTED_COMMAND',
    });
  });

  test.skip('MCP bridge：无配置时 callTool 报 RESOURCE_NOT_FOUND_DESCRIPTOR', async () => {
    const { McpBridgeService } = await import('../../src/bc/tools/mcp-bridge.service');
    const bridge = new McpBridgeService();
    await bridge.init();
    await expect(bridge.callTool('no-such-server', 't', {})).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND_DESCRIPTOR',
    });
  });
});
