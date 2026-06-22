import 'reflect-metadata';
import { describe, expect, mock, test } from 'bun:test';
import type { Context } from '@dangao/bun-server';
import { contextStore } from '@dangao/bun-server';
import { MyShelfController } from './shelf.controller';
import type { ShelfService } from './shelf.service';

function baseCtx(
  extra: {
    body?: unknown;
    params?: Record<string, string>;
    tenant?: number;
    userId?: string;
    query?: Record<string, string>;
  } = {},
): Context & { setStatus: ReturnType<typeof mock> } {
  const params = extra.params ?? {};
  const setStatus = mock(() => {});
  return {
    setStatus,
    params,
    query: new URLSearchParams(extra.query ?? {}),
    getBody: mock(async () => extra.body ?? {}),
    getParam: mock((k: string) => params[k]),
    state: {
      subject: {
        tenant: extra.tenant ?? 42,
        user: {
          userId: extra.userId ?? 'u-1',
          tenant: extra.tenant ?? 42,
          displayName: 'U',
          scopes: [],
        },
        traceId: 't',
        terminal: 'web',
      },
    },
  } as unknown as Context & { setStatus: ReturnType<typeof mock> };
}

const run = <T>(ctx: Context, fn: () => Promise<T>) => contextStore.run(ctx, fn);

function shelfSvc(over: Partial<ShelfService> = {}): ShelfService {
  return {
    list: mock(async () => [{ id: 'she_1', targetKind: 'agent' }]),
    install: mock(async () => ({ id: 'she_1', targetKind: 'agent' })),
    patch: mock(async () => ({ id: 'she_1', enabled: false })),
    remove: mock(async () => undefined),
    upsertAuthored: mock(async () => ({ id: 'she_1' })),
    ...over,
  } as unknown as ShelfService;
}

describe('MyShelfController', () => {
  test('GET /my/agents lists current user shelf', async () => {
    const svc = shelfSvc();
    const ctl = new MyShelfController(svc);
    const ctx = baseCtx({ tenant: 7, userId: 'bob' });

    const res = await run(ctx, () => ctl.listAgents());

    expect(svc.list).toHaveBeenCalledWith(7, 'bob', 'agent', {});
    expect(res).toEqual({ items: [{ id: 'she_1', targetKind: 'agent' }] });
  });

  test('GET /my/agents parses enabled and source filters', async () => {
    const svc = shelfSvc();
    const ctl = new MyShelfController(svc);
    const ctx = baseCtx({
      tenant: 7,
      userId: 'bob',
      query: { enabled: 'false', source: 'authored' },
    });

    await run(ctx, () => ctl.listAgents());

    expect(svc.list).toHaveBeenCalledWith(7, 'bob', 'agent', {
      enabled: false,
      source: 'authored',
    });
  });

  test('POST /my/agents installs via service', async () => {
    const svc = shelfSvc();
    const ctl = new MyShelfController(svc);
    const ctx = baseCtx({ tenant: 7, userId: 'bob', body: { ref: 'agt_1', pin: true } });

    await run(ctx, () => ctl.installAgent());

    expect(svc.install).toHaveBeenCalledWith(7, 'bob', 'agent', {
      ref: 'agt_1',
      mode: 'ref',
      pin: true,
    });
  });

  test('PATCH and DELETE operate on current user shelf entry', async () => {
    const svc = shelfSvc();
    const ctl = new MyShelfController(svc);
    const patchCtx = baseCtx({ params: { sheId: 'she_1' }, body: { enabled: false } });

    await run(patchCtx, () => ctl.patchAgent());
    expect(svc.patch).toHaveBeenCalledWith(42, 'u-1', 'she_1', { enabled: false });

    const deleteCtx = baseCtx({ params: { sheId: 'she_1' } });
    const res = await run(deleteCtx, () => ctl.removeAgent());
    expect(svc.remove).toHaveBeenCalledWith(42, 'u-1', 'she_1');
    expect(deleteCtx.setStatus).toHaveBeenCalledWith(204);
    expect(res).toBeUndefined();
  });
});
