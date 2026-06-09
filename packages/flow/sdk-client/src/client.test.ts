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

  test('createFlow POST /flow/studio/ with editorFlowJson body', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({ id: '123', name: 'demo' });
    };
    const client = createFlowClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.createFlow({ name: 'demo', editorFlowJson: { nodes: [], edges: [] } });

    expect(capturedUrl).toBe('http://ai-center.test/flow/studio/');
    expect(capturedInit?.method).toBe('POST');
    expect((result as { id: string }).id).toBe('123');
  });

  test('listFlowsPage GET /flow/studio/ with paging query', async () => {
    let capturedUrl = '';
    const fetchImpl = async (url: string): Promise<Response> => {
      capturedUrl = url;
      return Response.json({ total: 0, pages: 0, currentPage: 1, pageSize: 20, records: [] });
    };
    const client = createFlowClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    await client.listFlowsPage({ pageNumber: 1, pageSize: 20, keyword: 'foo' });
    expect(capturedUrl).toBe('http://ai-center.test/flow/studio/?pageNumber=1&pageSize=20&keyword=foo');
  });
});
