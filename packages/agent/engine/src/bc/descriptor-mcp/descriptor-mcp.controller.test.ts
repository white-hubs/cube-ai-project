import 'reflect-metadata';
import { describe, test, expect } from 'bun:test';
import type { Context } from '@dangao/bun-server';
import { contextStore } from '@dangao/bun-server';
import { DescriptorMcpController } from './descriptor-mcp.controller';
import { DescriptorMcpService } from './descriptor-mcp.service';
import type { DescriptorManagementService } from '../descriptor/descriptor-management.service';

function svc(): DescriptorMcpService {
  const mgmt = {
    create: async () => ({ id: 'agt_1', kind: 'agent', name: 'n', status: 'draft' }),
  } as unknown as DescriptorManagementService;
  return new DescriptorMcpService(mgmt);
}

function ctx(opts: {
  body?: unknown;
  headers?: Record<string, string>;
  tenant?: number;
  userId?: string;
}): Context {
  const headers = opts.headers ?? {};
  return {
    getBody: async () => opts.body ?? {},
    getHeader: (k: string) => headers[k.toLowerCase()] ?? null,
    state: {
      subject: {
        tenant: opts.tenant ?? 42,
        user: { userId: opts.userId ?? 'u-1', tenant: opts.tenant ?? 42, displayName: 'U' },
        traceId: 't',
        terminal: 'web',
      },
    },
  } as unknown as Context;
}

const run = <T>(c: Context, fn: () => Promise<T>) => contextStore.run(c, fn);

function parseSse(text: string): Array<{ event: string; data: unknown }> {
  const out: Array<{ event: string; data: unknown }> = [];
  for (const block of text.split('\n\n')) {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (data) out.push({ event, data: JSON.parse(data) });
  }
  return out;
}

describe('DescriptorMcpController — MCP Streamable HTTP transport', () => {
  test('initialize over JSON Accept → application/json + minted Mcp-Session-Id, version negotiated', async () => {
    const ctl = new DescriptorMcpController(svc());
    const c = ctx({
      headers: { accept: 'application/json, text/event-stream' },
      body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    });
    const res = await run(c, () => ctl.rpc());

    expect(res.headers.get('content-type')).toContain('application/json');
    const sid = res.headers.get('mcp-session-id');
    expect(sid && sid.length > 0).toBe(true);
    const payload = (await res.json()) as { result: { protocolVersion: string } };
    expect(payload.result.protocolVersion).toBe('2025-06-18');
  });

  test('initialize echoes incoming Mcp-Session-Id instead of minting a new one', async () => {
    const ctl = new DescriptorMcpController(svc());
    const c = ctx({
      headers: { accept: 'application/json', 'mcp-session-id': 'sess-abc' },
      body: { jsonrpc: '2.0', id: 1, method: 'initialize' },
    });
    const res = await run(c, () => ctl.rpc());
    expect(res.headers.get('mcp-session-id')).toBe('sess-abc');
  });

  test('SSE-only Accept → text/event-stream carrying the JSON-RPC response as a message event', async () => {
    const ctl = new DescriptorMcpController(svc());
    const c = ctx({
      headers: { accept: 'text/event-stream' },
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    });
    const res = await run(c, () => ctl.rpc());

    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSse(await res.text());
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('message');
    expect((events[0]!.data as { id: number }).id).toBe(2);
  });

  test('notification-only POST (no id) → 202 Accepted with empty body', async () => {
    const ctl = new DescriptorMcpController(svc());
    const c = ctx({
      headers: { accept: 'application/json' },
      body: { jsonrpc: '2.0', method: 'notifications/initialized' },
    });
    const res = await run(c, () => ctl.rpc());
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  test('batch request over JSON → array of responses', async () => {
    const ctl = new DescriptorMcpController(svc());
    const c = ctx({
      headers: { accept: 'application/json' },
      body: [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ],
    });
    const res = await run(c, () => ctl.rpc());
    const payload = (await res.json()) as Array<{ id: number }>;
    expect(payload.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  test('GET → 405 (no server-initiated stream)', async () => {
    const ctl = new DescriptorMcpController(svc());
    const res = await run(ctx({}), async () => ctl.openStream());
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('POST');
  });

  test('DELETE → 204 (stateless session termination)', async () => {
    const ctl = new DescriptorMcpController(svc());
    const res = await run(ctx({}), async () => ctl.terminate());
    expect(res.status).toBe(204);
  });
});
