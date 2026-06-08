import { describe, expect, test } from 'bun:test';
import { createFlowClient } from './client';

describe('FlowClient', () => {
  test('run POST /flow/run/:flowId with stream=false', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({ outputs: [{ text: 'ok' }] });
    };

    const client = createFlowClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.run('flow-abc', { input: 'hello' });

    expect(capturedUrl).toBe('http://ai-center.test/flow/run/flow-abc');
    expect(capturedInit?.method).toBe('POST');
    expect(JSON.parse(String(capturedInit?.body))).toEqual({ stream: false, input: 'hello' });
    expect(result).toEqual({ outputs: [{ text: 'ok' }] });
  });
});
