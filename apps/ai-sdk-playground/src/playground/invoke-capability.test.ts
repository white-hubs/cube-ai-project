import { describe, expect, test } from 'bun:test';
import { createAgenticClient } from '@cube-ai/agent-sdk-client';
import type { CapabilityEntry } from './types';
import { invokeCapability } from './invoke-capability';
import { DEFAULT_CONNECTION_PROFILE } from './connection-profile';

describe('invoke-capability', () => {
  test('invokeCapability calls agent-sdk-client.sessions.list via fetch mock', async () => {
    const cap: CapabilityEntry = {
      id: 'agent-sdk-client.sessions.list',
      package: '@cube-ai/agent-sdk-client',
      domain: 'agent',
      face: 'client',
      factory: 'createAgenticClient',
      apiPath: 'sessions',
      method: 'list',
      kind: 'json',
      params: [],
    };

    const fetchImpl = ((() =>
      Response.json({
        items: [
          {
            id: '1000000000000000003',
            title: 'demo',
            status: 'ACTIVE',
            agentId: '8300000000000000001',
            userId: '1000000000000000002',
            createTime: Date.now(),
            updateTime: Date.now(),
          },
        ],
        page: { hasMore: false },
      })) as unknown) as typeof fetch;

    const profile = {
      ...DEFAULT_CONNECTION_PROFILE,
      headers: { authorization: 'Bearer test', tenant: '1', terminal: 't' },
    };

    const result = await invokeCapability(cap, profile, {}, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('json');
    expect((result.data as { items: unknown[] }).items).toHaveLength(1);
  });

  test('createAgenticClient factory is wired for agent client capabilities', () => {
    const client = createAgenticClient({
      baseUrl: 'http://example.test/agent',
      auth: { provider: () => 'token' },
    });
    expect(typeof client.sessions.list).toBe('function');
  });
});
