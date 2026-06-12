import { describe, expect, test } from 'bun:test';
import { createAgentConsoleClient } from './client';

describe('AgentConsoleClient', () => {
  test('createAgent POSTs JSON to /agent/agents', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({ id: 'agt_1' });
    };

    const client = createAgentConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const body = { prompt: 'hello', displayName: 'A' };
    await client.createAgent(body);

    expect(capturedUrl).toBe('http://ai-center.test/agent/agents');
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.accept).toBe('application/json');
    expect(capturedInit?.body).toBe(JSON.stringify(body));
  });

  test('publishAgent POSTs to /agent/agents/<id>/publish', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedMethod = init?.method ?? '';
      return Response.json({ id: 'agt_1', status: 'published' });
    };

    const client = createAgentConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    await client.publishAgent('agt_1');

    expect(capturedUrl).toBe('http://ai-center.test/agent/agents/agt_1/publish');
    expect(capturedMethod).toBe('POST');
  });

  test('createFromDocument(skill) POSTs text/plain to /agent/skills:fromDocument', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({
        id: 'skl_1',
        name: 'my-skill',
        action: 'created',
        headVersionNo: 1,
        status: 'draft',
      });
    };

    const client = createAgentConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const raw = '---\nname: my-skill\n---\n# instructions';
    await client.createFromDocument('skill', raw);

    expect(capturedUrl).toBe('http://ai-center.test/agent/skills:fromDocument');
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('text/plain');
    // Body must be the raw text, NOT JSON-stringified.
    expect(capturedInit?.body).toBe(raw);
    expect(capturedInit?.body).not.toBe(JSON.stringify(raw));
  });
});
