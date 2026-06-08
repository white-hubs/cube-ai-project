import { describe, expect, test } from 'bun:test';
import { createFlowConsoleClient } from './client';

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
