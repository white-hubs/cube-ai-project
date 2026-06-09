import { describe, expect, test } from 'bun:test';
import { createFlowConsoleClient } from './client';

describe('FlowConsoleClient studio surface', () => {
  test('publishFlow POST /flow/studio/:id/publish', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({ releaseId: 'r1', releaseVersion: '1' });
    };
    const client = createFlowConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.publishFlow('42', { releaseNote: 'note' });
    expect(capturedUrl).toBe('http://ai-center.test/flow/studio/42/publish');
    expect(capturedInit?.method).toBe('POST');
    expect(result.releaseId).toBe('r1');
  });

  test('getFlowMonitorTraces GET /flow/studio/:id/monitor/traces with query', async () => {
    let capturedUrl = '';
    const fetchImpl = async (url: string): Promise<Response> => {
      capturedUrl = url;
      return Response.json({});
    };
    const client = createFlowConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    await client.getFlowMonitorTraces('42', { page: 1, size: 10 });
    expect(capturedUrl).toBe('http://ai-center.test/flow/studio/42/monitor/traces?page=1&size=10');
  });
});

describe('FlowConsoleClient', () => {
  test('listFlows GET /flow/flows', async () => {
    let capturedUrl = '';
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      expect(init?.method).toBe('GET');
      return Response.json({ items: [{ id: '1', name: 'demo' }] });
    };

    const client = createFlowConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.listFlows();

    expect(capturedUrl).toBe('http://ai-center.test/flow/flows');
    expect(result.items?.[0]?.name).toBe('demo');
  });
});
