import { describe, expect, mock, test } from 'bun:test';
import type { AvailableToolView, ToolDescriptor } from '@cube-ai/contracts';
import { PluginCatalogService, type UserAvailableToolRepository } from './plugin-catalog.service';

function tool(over: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return {
    schemaVersion: 1,
    kind: 'TOOL',
    name: 'currentDate',
    displayName: 'Current Date',
    description: 'Returns current date',
    version: '1.0.0',
    isPreset: true,
    category: 'PLATFORM',
    tags: ['builtin'],
    meta: {},
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    requires: { auth: 'NONE', permissions: [] },
    execute: 'builtin:currentDate',
    ...over,
  } as ToolDescriptor;
}

function repo(over: Partial<UserAvailableToolRepository> = {}): UserAvailableToolRepository {
  return {
    listByUser: mock(async () => [{ toolName: 'currentDate', enabled: true }]),
    findByName: mock(async () => null),
    insert: mock(async () => ({ toolName: 'image.qwen', enabled: true })),
    patch: mock(async () => ({ toolName: 'currentDate', enabled: false })),
    softDelete: mock(async () => undefined),
    ...over,
  };
}

describe('PluginCatalogService', () => {
  test('catalog projects tool descriptors as opaque capabilities with installed flag', async () => {
    const svc = new PluginCatalogService(repo(), {
      listAll: () => [
        tool(),
        tool({
          name: 'secretTool',
          displayName: 'Secret Tool',
          description: 'Has hidden execute details',
          execute: 'https://secret.example/tool',
        }),
      ],
    });

    const items = await svc.catalog(7, 'bob');

    expect(items).toEqual([
      {
        toolName: 'currentDate',
        displayName: 'Current Date',
        description: 'Returns current date',
        tags: ['builtin'],
        installed: true,
      },
      {
        toolName: 'secretTool',
        displayName: 'Secret Tool',
        description: 'Has hidden execute details',
        tags: ['builtin'],
        installed: false,
      },
    ]);
    expect(JSON.stringify(items)).not.toContain('https://secret.example/tool');
  });

  test('my tools install/patch/remove delegate to user repository', async () => {
    const r = repo();
    const svc = new PluginCatalogService(r, { listAll: () => [] });

    expect(await svc.myTools(7, 'bob')).toEqual([{ toolName: 'currentDate', enabled: true }]);
    await svc.install(7, 'bob', { toolName: 'image.qwen' });
    expect(r.insert).toHaveBeenCalledWith(7, 'bob', 'image.qwen');
    await svc.patch(7, 'bob', 'currentDate', { enabled: false });
    expect(r.patch).toHaveBeenCalledWith(7, 'bob', 'currentDate', false);
    await svc.remove(7, 'bob', 'currentDate');
    expect(r.softDelete).toHaveBeenCalledWith(7, 'bob', 'currentDate');
  });
});
