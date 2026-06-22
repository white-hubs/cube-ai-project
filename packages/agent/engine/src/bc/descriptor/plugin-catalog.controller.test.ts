import 'reflect-metadata';
import { describe, expect, mock, test } from 'bun:test';
import type { Context } from '@dangao/bun-server';
import { contextStore } from '@dangao/bun-server';
import { PluginCatalogController } from './plugin-catalog.controller';
import type { PluginCatalogService } from './plugin-catalog.service';

function ctx(extra: { body?: unknown; params?: Record<string, string> } = {}): Context & { setStatus: ReturnType<typeof mock> } {
  const setStatus = mock(() => {});
  const params = extra.params ?? {};
  return {
    setStatus,
    params,
    getBody: mock(async () => extra.body ?? {}),
    getParam: mock((k: string) => params[k]),
    state: {
      subject: {
        tenant: 42,
        user: { userId: 'bob', tenant: 42, displayName: 'Bob', scopes: [] },
        traceId: 't',
        terminal: 'web',
      },
    },
  } as unknown as Context & { setStatus: ReturnType<typeof mock> };
}

const run = <T>(c: Context, fn: () => Promise<T>) => contextStore.run(c, fn);

function svc(): PluginCatalogService {
  return {
    catalog: mock(async () => [{ toolName: 'currentDate', installed: true }]),
    myTools: mock(async () => [{ toolName: 'currentDate', enabled: true }]),
    install: mock(async () => ({ toolName: 'currentDate', enabled: true })),
    patch: mock(async () => ({ toolName: 'currentDate', enabled: false })),
    remove: mock(async () => undefined),
  } as unknown as PluginCatalogService;
}

describe('PluginCatalogController', () => {
  test('GET /plugins and /my/tools use current user', async () => {
    const s = svc();
    const ctl = new PluginCatalogController(s);
    expect(await run(ctx(), () => ctl.catalog())).toEqual({ items: [{ toolName: 'currentDate', installed: true }] });
    expect(s.catalog).toHaveBeenCalledWith(42, 'bob');
    expect(await run(ctx(), () => ctl.myTools())).toEqual({ items: [{ toolName: 'currentDate', enabled: true }] });
    expect(s.myTools).toHaveBeenCalledWith(42, 'bob');
  });

  test('POST/PATCH/DELETE /my/tools delegate to service', async () => {
    const s = svc();
    const ctl = new PluginCatalogController(s);
    await run(ctx({ body: { toolName: 'currentDate' } }), () => ctl.installTool());
    expect(s.install).toHaveBeenCalledWith(42, 'bob', { toolName: 'currentDate' });
    await run(ctx({ params: { toolName: 'currentDate' }, body: { enabled: false } }), () => ctl.patchTool());
    expect(s.patch).toHaveBeenCalledWith(42, 'bob', 'currentDate', { enabled: false });
    const c = ctx({ params: { toolName: 'currentDate' } });
    await run(c, () => ctl.removeTool());
    expect(s.remove).toHaveBeenCalledWith(42, 'bob', 'currentDate');
    expect(c.setStatus).toHaveBeenCalledWith(204);
  });
});
