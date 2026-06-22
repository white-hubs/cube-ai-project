import 'reflect-metadata';
import { describe, expect, mock, test } from 'bun:test';
import type { Context } from '@dangao/bun-server';
import { contextStore } from '@dangao/bun-server';
import { LibraryController, ListingController } from './listing.controller';
import type { LibraryService, ListingService } from './listing.service';

function baseCtx(
  extra: {
    body?: unknown;
    params?: Record<string, string>;
    tenant?: number;
    userId?: string;
    scopes?: string[];
    query?: Record<string, string>;
  } = {},
): Context {
  const params = extra.params ?? {};
  return {
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
          scopes: extra.scopes ?? [],
        },
        traceId: 't',
        terminal: 'web',
      },
    },
  } as unknown as Context;
}

const run = <T>(ctx: Context, fn: () => Promise<T>) => contextStore.run(ctx, fn);

function listingSvc(over: Partial<ListingService> = {}): ListingService {
  return {
    list: mock(async () => ({ descriptorId: 'agt_1', listed: true, sharedVersionNo: 1 })),
    unlist: mock(async () => ({ descriptorId: 'agt_1', listed: false, sharedVersionNo: 1 })),
    get: mock(async () => ({ descriptorId: 'agt_1', listed: true, sharedVersionNo: 1 })),
    ...over,
  } as unknown as ListingService;
}

function librarySvc(over: Partial<LibraryService> = {}): LibraryService {
  return {
    browse: mock(async () => [{ ref: 'agt_1', kind: 'agent', tier: 'tenant' }]),
    get: mock(async () => ({ ref: 'agt_1', kind: 'agent', tier: 'tenant' })),
    ...over,
  } as unknown as LibraryService;
}

describe('ListingController', () => {
  test('POST /agents/:id/list validates body and lists as current actor', async () => {
    const svc = listingSvc();
    const ctl = new ListingController(svc);
    const ctx = baseCtx({ params: { id: 'agt_1' }, body: { versionNo: 2 }, userId: 'alice' });

    await run(ctx, () => ctl.listAgent());

    expect(svc.list).toHaveBeenCalledWith(42, 'agt_1', 2, 'alice');
  });

  test('POST /agents/:id/unlist forwards descriptor admin scope', async () => {
    const svc = listingSvc();
    const ctl = new ListingController(svc);
    const ctx = baseCtx({
      params: { id: 'agt_1' },
      userId: 'admin',
      scopes: ['engine.descriptor.admin'],
    });

    await run(ctx, () => ctl.unlistAgent());

    expect(svc.unlist).toHaveBeenCalledWith(42, 'agt_1', 'admin', { isAdmin: true });
  });

  test('GET /agents/:id/listing returns listing projection', async () => {
    const svc = listingSvc();
    const ctl = new ListingController(svc);
    const ctx = baseCtx({ params: { id: 'agt_1' } });

    await run(ctx, () => ctl.getAgentListing());

    expect(svc.get).toHaveBeenCalledWith(42, 'agt_1');
  });
});

describe('LibraryController', () => {
  test('GET /library/agents wraps browse results in {items}', async () => {
    const svc = librarySvc();
    const ctl = new LibraryController(svc);
    const ctx = baseCtx({ tenant: 7 });

    const res = await run(ctx, () => ctl.browseAgents());

    expect(svc.browse).toHaveBeenCalledWith(7, 'agent', {});
    expect(res).toEqual({ items: [{ ref: 'agt_1', kind: 'agent', tier: 'tenant' }] });
  });

  test('GET /library/agents forwards q and tier filters', async () => {
    const svc = librarySvc();
    const ctl = new LibraryController(svc);
    const ctx = baseCtx({ tenant: 7, query: { q: 'support', tier: 'tenant' } });

    await run(ctx, () => ctl.browseAgents());

    expect(svc.browse).toHaveBeenCalledWith(7, 'agent', { q: 'support', tier: 'tenant' });
  });

  test('GET /library/agents/:ref and /skills/:ref return detail projections', async () => {
    const svc = librarySvc({
      get: mock(async (_tenant: number, kind: 'agent' | 'skill', ref: string) => ({
        ref,
        kind,
        tier: ref.startsWith('agt_') ? 'tenant' : 'system',
      })),
    });
    const ctl = new LibraryController(svc);

    const agentRes = await run(
      baseCtx({ tenant: 7, params: { ref: 'agt_1' } }),
      () => ctl.getAgent(),
    );
    const skillRes = await run(
      baseCtx({ tenant: 7, params: { ref: 'builtin-skill' } }),
      () => ctl.getSkill(),
    );

    expect(svc.get).toHaveBeenCalledWith(7, 'agent', 'agt_1');
    expect(svc.get).toHaveBeenCalledWith(7, 'skill', 'builtin-skill');
    expect(agentRes).toEqual({ ref: 'agt_1', kind: 'agent', tier: 'tenant' });
    expect(skillRes).toEqual({ ref: 'builtin-skill', kind: 'skill', tier: 'system' });
  });
});
