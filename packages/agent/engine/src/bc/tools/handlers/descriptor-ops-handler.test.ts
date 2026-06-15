import { describe, expect, it } from 'bun:test';
import type {
  ProposeRequest,
  ProposeResult,
  TenantDescriptorKind,
  TenantDescriptorView,
} from '@cube-ai/contracts';
import { DescriptorOpsHandler } from './descriptor-ops-handler';
import type { DescriptorManagementService } from '../../descriptor/descriptor-management.service';
import type { ToolHandlerCtx } from '../tool-context';

function ctx(overrides?: Partial<ToolHandlerCtx>): ToolHandlerCtx {
  return {
    traceId: 'trace-x',
    signal: new AbortController().signal,
    auth: { tenant: 7, user: { userId: 'u1', scopes: [] } },
    session: { id: '1234567890123456789', turnId: '1234567890123456788' },
    ...overrides,
  } as ToolHandlerCtx;
}

function draftView(over: Partial<TenantDescriptorView> = {}): TenantDescriptorView {
  return {
    id: 'agt_111',
    kind: 'agent',
    name: 'my-agent',
    status: 'draft',
    headVersionNo: 1,
    publishedVersionNo: null,
    content: { prompt: 'hi' },
    createTime: 1,
    updateTime: 1,
    ...over,
  };
}

class MockManagementService {
  createCalls: Array<{ tenant: number; kind: TenantDescriptorKind; body: unknown; actor?: string }> = [];
  publishCalls: Array<{ tenant: number; id: string; actor?: string }> = [];
  proposeCalls: Array<{ tenant: number; kind: TenantDescriptorKind; req: ProposeRequest }> = [];

  async create(
    tenant: number,
    kind: TenantDescriptorKind,
    body: { name?: unknown; content?: unknown },
    actor?: string,
  ): Promise<TenantDescriptorView> {
    this.createCalls.push({ tenant, kind, body, actor });
    return draftView({ kind, name: String((body.name as string) ?? 'x') });
  }

  async publish(tenant: number, id: string, actor?: string): Promise<TenantDescriptorView> {
    this.publishCalls.push({ tenant, id, actor });
    return draftView({ id, status: 'published', publishedVersionNo: 1 });
  }

  async propose(
    tenant: number,
    kind: TenantDescriptorKind,
    req: ProposeRequest,
  ): Promise<ProposeResult> {
    this.proposeCalls.push({ tenant, kind, req });
    return { content: { prompt: 'generated' }, suggestions: [], valid: true };
  }
}

function handlerWith(mock: MockManagementService): DescriptorOpsHandler {
  return new DescriptorOpsHandler(mock as unknown as DescriptorManagementService);
}

describe('DescriptorOpsHandler', () => {
  it('create op → calls service.create with tenant from ctx and returns the draft view', async () => {
    const mock = new MockManagementService();
    const handler = handlerWith(mock);
    const out = (await handler.invoke(
      { op: 'create', args: { kind: 'agent', name: 'my-agent', content: { prompt: 'hi' } } },
      ctx(),
    )) as TenantDescriptorView;

    expect(mock.createCalls).toHaveLength(1);
    expect(mock.createCalls[0]?.tenant).toBe(7);
    expect(mock.createCalls[0]?.kind).toBe('agent');
    expect(mock.createCalls[0]?.actor).toBe('u1');
    expect(out.status).toBe('draft');
  });

  it('never takes tenant from tool input — ctx tenant wins', async () => {
    const mock = new MockManagementService();
    const handler = handlerWith(mock);
    await handler.invoke(
      { op: 'create', args: { tenant: 999, kind: 'skill', name: 's', content: { description: 'd', instructions: 'i' } } },
      ctx({ auth: { tenant: 42 } }),
    );
    expect(mock.createCalls[0]?.tenant).toBe(42);
  });

  it('publish op → calls service.publish (consent is descriptor-declared, not enforced here)', async () => {
    const mock = new MockManagementService();
    const handler = handlerWith(mock);
    const out = (await handler.invoke(
      { op: 'publish', args: { id: 'agt_111' } },
      ctx(),
    )) as TenantDescriptorView;
    expect(mock.publishCalls).toEqual([{ tenant: 7, id: 'agt_111', actor: 'u1' }]);
    expect(out.status).toBe('published');
  });

  it('propose op → calls service.propose and returns the ProposeResult', async () => {
    const mock = new MockManagementService();
    const handler = handlerWith(mock);
    const out = (await handler.invoke(
      { op: 'propose', args: { kind: 'agent', intent: 'a helpdesk agent' } },
      ctx(),
    )) as ProposeResult;
    expect(mock.proposeCalls).toHaveLength(1);
    expect(mock.proposeCalls[0]?.kind).toBe('agent');
    expect(mock.proposeCalls[0]?.req.intent).toBe('a helpdesk agent');
    expect(out.valid).toBe(true);
  });

  it('unknown op → INVALID_ARGUMENT_SCHEMA_VIOLATION', async () => {
    const mock = new MockManagementService();
    const handler = handlerWith(mock);
    await expect(
      handler.invoke({ op: 'frobnicate' as never, args: {} }, ctx()),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT_SCHEMA_VIOLATION' });
  });
});
