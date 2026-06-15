import { describe, expect, it } from 'bun:test';
import type {
  TenantDescriptorKind,
  TenantDescriptorView,
} from '@cube-ai/contracts';
import {
  CONFIRMATION_REQUIRED_CODE,
  DescriptorMcpService,
  type JsonRpcFailure,
  type JsonRpcSuccess,
} from './descriptor-mcp.service';
import type { DescriptorManagementService } from '../descriptor/descriptor-management.service';
import { managementToolNames } from '../tools/handlers/descriptor-ops';

function draftView(over: Partial<TenantDescriptorView> = {}): TenantDescriptorView {
  return {
    id: 'agt_1',
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
  createCalls: Array<{ tenant: number; kind: TenantDescriptorKind }> = [];
  publishCalls: Array<{ tenant: number; id: string }> = [];

  async create(
    tenant: number,
    kind: TenantDescriptorKind,
  ): Promise<TenantDescriptorView> {
    this.createCalls.push({ tenant, kind });
    return draftView({ kind });
  }

  async publish(tenant: number, id: string): Promise<TenantDescriptorView> {
    this.publishCalls.push({ tenant, id });
    return draftView({ id, status: 'published', publishedVersionNo: 1 });
  }
}

function serviceWith(mock: MockManagementService): DescriptorMcpService {
  return new DescriptorMcpService(mock as unknown as DescriptorManagementService);
}

describe('DescriptorMcpService', () => {
  it('tools/list → returns the management ops tool set', async () => {
    const svc = serviceWith(new MockManagementService());
    const res = (await svc.handle({ id: 1, method: 'tools/list' }, 7)) as JsonRpcSuccess;
    const tools = (res.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...managementToolNames()].sort());
    expect(tools).toHaveLength(7);
  });

  it('tools/call create → produces a draft, tenant from caller not args', async () => {
    const mock = new MockManagementService();
    const svc = serviceWith(mock);
    const res = (await svc.handle(
      {
        id: 2,
        method: 'tools/call',
        params: {
          name: 'platform.descriptor.create',
          arguments: { tenant: 999, kind: 'agent', name: 'a', content: { prompt: 'p' } },
        },
      },
      7,
      'actor-1',
    )) as JsonRpcSuccess;

    expect(mock.createCalls).toEqual([{ tenant: 7, kind: 'agent' }]);
    const structured = (res.result as { structuredContent: TenantDescriptorView }).structuredContent;
    expect(structured.status).toBe('draft');
  });

  it('tools/call publish WITHOUT confirmed:true → rejected, publish not called', async () => {
    const mock = new MockManagementService();
    const svc = serviceWith(mock);
    const res = (await svc.handle(
      {
        id: 3,
        method: 'tools/call',
        params: { name: 'platform.descriptor.publish', arguments: { id: 'agt_1' } },
      },
      7,
    )) as JsonRpcFailure;

    expect(res.error).toBeDefined();
    expect((res.error.data as { code?: string })?.code).toBe(CONFIRMATION_REQUIRED_CODE);
    expect(mock.publishCalls).toHaveLength(0);
  });

  it('tools/call publish WITH confirmed:true → publishes', async () => {
    const mock = new MockManagementService();
    const svc = serviceWith(mock);
    const res = (await svc.handle(
      {
        id: 4,
        method: 'tools/call',
        params: {
          name: 'platform.descriptor.publish',
          arguments: { id: 'agt_1', confirmed: true },
        },
      },
      7,
    )) as JsonRpcSuccess;

    expect(mock.publishCalls).toEqual([{ tenant: 7, id: 'agt_1' }]);
    const structured = (res.result as { structuredContent: TenantDescriptorView }).structuredContent;
    expect(structured.status).toBe('published');
  });

  it('unknown method → METHOD_NOT_FOUND', async () => {
    const svc = serviceWith(new MockManagementService());
    const res = (await svc.handle({ id: 5, method: 'tools/frobnicate' }, 7)) as JsonRpcFailure;
    expect(res.error.code).toBe(-32601);
  });

  it('initialize → advertises tools capability', async () => {
    const svc = serviceWith(new MockManagementService());
    const res = (await svc.handle({ id: 6, method: 'initialize' }, 7)) as JsonRpcSuccess;
    expect((res.result as { capabilities: { tools: unknown } }).capabilities.tools).toBeDefined();
  });
});
