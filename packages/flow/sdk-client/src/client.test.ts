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

  test('exportFlow GET /flow/studio/:id/export', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({
        schemaVersion: '1',
        exportedAt: 1700000000000,
        flow: { id: 'flow-1', name: 'demo', description: null, enabled: true, remark: null, compileStatus: 'ok', compileRevision: 'r1', publishedRevision: null },
        editorFlowJson: { nodes: [], edges: [] },
        compiledFlowJson: null,
        componentSnapshotJson: null,
      });
    };
    const client = createFlowClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.exportFlow('flow-1');

    expect(capturedUrl).toBe('http://ai-center.test/flow/studio/flow-1/export');
    expect(capturedInit?.method).toBe('GET');
    expect(result.schemaVersion).toBe('1');
    expect(result.flow.id).toBe('flow-1');
  });

  test('importFlow POST /flow/studio/:id/import with body', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({ id: 'flow-1', name: 'imported', editorFlowJson: { nodes: [], edges: [] } });
    };
    const client = createFlowClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const body = { name: 'imported', editorFlowJson: { nodes: [], edges: [] } };
    const result = await client.importFlow('flow-1', body);

    expect(capturedUrl).toBe('http://ai-center.test/flow/studio/flow-1/import');
    expect(capturedInit?.method).toBe('POST');
    expect(JSON.parse(String(capturedInit?.body))).toEqual(body);
    expect((result as { id: string; name: string }).id).toBe('flow-1');
    expect((result as { id: string; name: string }).name).toBe('imported');
  });

  test('runFlow POST /flow/studio/:id/run with JSON body', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({ raw: { outputs: [{ text: 'done' }], session_id: 'sess-1' } });
    };
    const client = createFlowClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const body = { input: 'hello', sessionId: 'sess-1' };
    const result = await client.runFlow('flow-1', body);

    expect(capturedUrl).toBe('http://ai-center.test/flow/studio/flow-1/run');
    expect(capturedInit?.method).toBe('POST');
    expect(JSON.parse(String(capturedInit?.body))).toEqual(body);
    expect(result).toEqual({ raw: { outputs: [{ text: 'done' }], session_id: 'sess-1' } });
  });
});
