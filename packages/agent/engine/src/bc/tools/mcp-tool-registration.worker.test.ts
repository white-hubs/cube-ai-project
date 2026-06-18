import { describe, expect, test } from 'bun:test';
import type { ToolDescriptor } from '@cube-ai/contracts';
import { DescriptorRegistryService } from '../descriptor/descriptor-registry.service';
import { McpBridgeService, type McpServerConfig } from './mcp-bridge.service';
import { McpToolRegistrationWorker, retryDelayMs } from './mcp-tool-registration.worker';

function registry(): DescriptorRegistryService {
  return new DescriptorRegistryService({
    getPinnedVersion: async () => undefined,
  } as never);
}

function descriptor(name = 'mcp.web-search.web_search'): ToolDescriptor {
  return {
    schemaVersion: 1,
    kind: 'TOOL',
    name,
    displayName: 'web_search',
    description: 'Search the web',
    isPreset: false,
    version: '1.0.0',
    meta: {
      execution: 'REMOTE',
      consent: 'NEVER',
      requiresPrincipal: 'USER',
      timeoutMs: 120_000,
      idempotent: false,
      sideEffects: [],
    },
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    outputSchema: { type: 'object', properties: {} },
    requires: { principal: 'USER', oauthScope: [], obo: null },
    execute: 'mcp:web-search:web_search',
    handler: { kind: 'mcp', config: {} },
    tags: ['mcp', 'web-search'],
    category: 'MCP',
  };
}

function bridge(opts: {
  config: McpServerConfig;
  tools?: ToolDescriptor[];
  error?: Error;
}): McpBridgeService {
  return {
    configuredServers: async () => [['web-search', opts.config]],
    listToolsForServer: async () => {
      if (opts.error) throw opts.error;
      return opts.tools ?? [];
    },
  } as unknown as McpBridgeService;
}

describe('McpToolRegistrationWorker', () => {
  test('optional MCP failure is degraded but readiness stays UP', async () => {
    const reg = registry();
    const worker = new McpToolRegistrationWorker(
      bridge({
        config: { type: 'http', url: 'http://mcp.test/mcp', enabled: true },
        error: new Error('MCP RPC timeout: initialize'),
      }),
      reg,
    );

    await worker.runOnce();

    const status = worker.status();
    expect(status.status).toBe('UP');
    expect(status.servers['web-search']).toMatchObject({
      required: false,
      state: 'degraded',
      registeredToolCount: 0,
      failureCount: 1,
      lastError: 'MCP RPC timeout: initialize',
    });
    expect(reg.resolve('mcp.web-search.web_search')).toBeUndefined();
  });

  test('required MCP failure affects readiness without throwing from runOnce', async () => {
    const worker = new McpToolRegistrationWorker(
      bridge({
        config: { type: 'http', url: 'http://mcp.test/mcp', enabled: true, required: true },
        error: new Error('MCP RPC timeout: initialize'),
      }),
      registry(),
    );

    await worker.runOnce();

    expect(worker.status().status).toBe('DOWN');
    expect(worker.status().servers['web-search']?.required).toBe(true);
  });

  test('failure backoff is 10s, 30s, 60s, 300s, then capped at 300s', async () => {
    const worker = new McpToolRegistrationWorker(
      bridge({
        config: { type: 'http', url: 'http://mcp.test/mcp', enabled: true },
        error: new Error('down'),
      }),
      registry(),
    );

    for (const expected of [10_000, 30_000, 60_000, 300_000, 300_000]) {
      const before = Date.now();
      await worker.runOnce();
      const nextRetryAt = worker.status().servers['web-search']?.nextRetryAt;
      expect(nextRetryAt).toBeDefined();
      expect(nextRetryAt! - before).toBeGreaterThanOrEqual(expected);
      expect(nextRetryAt! - before).toBeLessThan(expected + 1_000);
    }
  });

  test('successful discovery registers descriptors and resets degraded state', async () => {
    const reg = registry();
    const worker = new McpToolRegistrationWorker(
      bridge({
        config: { type: 'http', url: 'http://mcp.test/mcp', enabled: true },
        tools: [descriptor()],
      }),
      reg,
    );

    await worker.runOnce();

    expect(worker.status().status).toBe('UP');
    expect(worker.status().servers['web-search']).toMatchObject({
      state: 'registered',
      registeredToolCount: 1,
      failureCount: 0,
    });
    expect(reg.resolve('mcp.web-search.web_search')?.execute).toBe('mcp:web-search:web_search');
  });

  test('retryDelayMs caps at 300s', () => {
    expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([
      10_000,
      30_000,
      60_000,
      300_000,
      300_000,
    ]);
  });
});
