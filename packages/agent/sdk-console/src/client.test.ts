import { describe, expect, test } from 'bun:test';
import { createAgentConsoleClient } from './client';

describe('AgentConsoleClient', () => {
  test('createAgent POSTs JSON to /agent/console/agents', async () => {
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

    expect(capturedUrl).toBe('http://ai-center.test/agent/console/agents');
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.accept).toBe('application/json');
    expect(capturedInit?.body).toBe(JSON.stringify(body));
  });

  test('publishAgent POSTs to /agent/console/agents/<id>/publish', async () => {
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

    expect(capturedUrl).toBe('http://ai-center.test/agent/console/agents/agt_1/publish');
    expect(capturedMethod).toBe('POST');
  });

  test('listAgents unwraps the controller items envelope', async () => {
    const view = {
      id: 'agt_1',
      kind: 'agent',
      name: 'support',
      ownerUserId: 'alice',
      status: 'draft',
      headVersionNo: 1,
      publishedVersionNo: null,
      hasUnpublishedChanges: true,
      content: { prompt: 'hello' },
      createTime: 0,
      updateTime: 0,
    } as const;
    const fetchImpl = async (): Promise<Response> => Response.json({ items: [view] });

    const client = createAgentConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const agents = await client.listAgents();

    expect(agents).toEqual([view]);
  });

  test('marketplace management methods use exact /agent/console paths', async () => {
    const calls: Array<{ url: string; method?: string; body?: BodyInit | null }> = [];
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith('/versions')) {
        return Response.json({ items: [{ versionNo: 1, createBy: 'alice', createTime: 1 }] });
      }
      if (url.endsWith('/versions/1')) {
        return Response.json({ content: { prompt: 'v1' } });
      }
      if (url.endsWith('/rollback')) {
        return Response.json({ id: 'agt_1', publishedVersionNo: 2 });
      }
      if (url.endsWith('/listing') || url.endsWith('/list') || url.endsWith('/unlist')) {
        return Response.json({
          descriptorId: 'agt_1',
          listed: true,
          sharedVersionNo: 1,
          publisherUserId: 'alice',
          listedTime: 1,
          unlistedTime: null,
        });
      }
      return Response.json({});
    };

    const client = createAgentConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    await client.listAgentVersions('agt_1');
    await client.getAgentVersion('agt_1', 1);
    await client.rollbackAgent('agt_1', 1);
    await client.listAgent('agt_1', 1);
    await client.unlistAgent('agt_1');
    await client.getAgentListing('agt_1');

    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', 'http://ai-center.test/agent/console/agents/agt_1/versions'],
      ['GET', 'http://ai-center.test/agent/console/agents/agt_1/versions/1'],
      ['POST', 'http://ai-center.test/agent/console/agents/agt_1/rollback'],
      ['POST', 'http://ai-center.test/agent/console/agents/agt_1/list'],
      ['POST', 'http://ai-center.test/agent/console/agents/agt_1/unlist'],
      ['GET', 'http://ai-center.test/agent/console/agents/agt_1/listing'],
    ]);
    expect(calls[2].body).toBe(JSON.stringify({ versionNo: 1 }));
    expect(calls[3].body).toBe(JSON.stringify({ versionNo: 1 }));
  });

  test('shelf, library, and plugin methods use exact /agent/console paths', async () => {
    const calls: Array<{ url: string; method?: string; body?: BodyInit | null }> = [];
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/library/agents/agt_1')) {
        return Response.json({ ref: 'agt_1', kind: 'agent', tier: 'tenant' });
      }
      if (url.endsWith('/library/skills/web%2Fskill')) {
        return Response.json({ ref: 'web/skill', kind: 'skill', tier: 'system' });
      }
      if (url.includes('/library/') || url.endsWith('/plugins') || url.endsWith('/my/tools')) {
        return Response.json({ items: [] });
      }
      if (url.includes('/my/tools/')) {
        return Response.json({ toolName: 'web/search', enabled: false });
      }
      if (url.endsWith('/my/tools')) {
        return Response.json({ toolName: 'web/search', enabled: true });
      }
      return Response.json({
        id: 'she_1',
        targetKind: 'agent',
        targetId: 'agt_1',
        source: 'ref',
        pinVersionNo: null,
        enabled: true,
        effectiveVersionNo: 1,
        runnableStatus: 'runnable',
      });
    };

    const client = createAgentConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    await client.myAgents({ enabled: true, source: 'ref' });
    await client.mySkills();
    await client.installAgent({ ref: 'agt_1', mode: 'ref', pin: false });
    await client.patchShelfAgent('she_1', { enabled: false });
    await client.removeShelfAgent('she_1');
    await client.browseLibraryAgents({ q: 'support', tier: 'tenant' });
    await client.getLibraryAgent('agt_1');
    await client.browseLibrarySkills();
    await client.getLibrarySkill('web/skill');
    await client.pluginCatalog();
    await client.myTools();
    await client.installTool('web/search');
    await client.patchTool('web/search', false);
    await client.removeTool('web/search');

    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', 'http://ai-center.test/agent/console/my/agents?enabled=true&source=ref'],
      ['GET', 'http://ai-center.test/agent/console/my/skills'],
      ['POST', 'http://ai-center.test/agent/console/my/agents'],
      ['PATCH', 'http://ai-center.test/agent/console/my/agents/she_1'],
      ['DELETE', 'http://ai-center.test/agent/console/my/agents/she_1'],
      ['GET', 'http://ai-center.test/agent/console/library/agents?q=support&tier=tenant'],
      ['GET', 'http://ai-center.test/agent/console/library/agents/agt_1'],
      ['GET', 'http://ai-center.test/agent/console/library/skills'],
      ['GET', 'http://ai-center.test/agent/console/library/skills/web%2Fskill'],
      ['GET', 'http://ai-center.test/agent/console/plugins'],
      ['GET', 'http://ai-center.test/agent/console/my/tools'],
      ['POST', 'http://ai-center.test/agent/console/my/tools'],
      ['PATCH', 'http://ai-center.test/agent/console/my/tools/web%2Fsearch'],
      ['DELETE', 'http://ai-center.test/agent/console/my/tools/web%2Fsearch'],
    ]);
    expect(calls[2].body).toBe(JSON.stringify({ ref: 'agt_1', mode: 'ref', pin: false }));
    expect(calls[3].body).toBe(JSON.stringify({ enabled: false }));
    expect(calls[11].body).toBe(JSON.stringify({ toolName: 'web/search' }));
    expect(calls[12].body).toBe(JSON.stringify({ enabled: false }));
  });

  test('createFromDocument(skill) POSTs text/plain to /agent/console/skills:fromDocument', async () => {
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

    expect(capturedUrl).toBe('http://ai-center.test/agent/console/skills:fromDocument');
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('text/plain');
    // Body must be the raw text, NOT JSON-stringified.
    expect(capturedInit?.body).toBe(raw);
    expect(capturedInit?.body).not.toBe(JSON.stringify(raw));
  });

  test('propose consumes the SSE stream and resolves the final ProposeResult', async () => {
    const proposal = {
      content: { prompt: 'You are a concise agent.', skillRefs: ['web-search'] },
      suggestions: [{ kind: 'skill', ref: 'web-search', rationale: 'lookup' }],
      valid: true,
    };
    const sseBody =
      'event: delta\ndata: {"delta":"You are a "}\n\n' +
      'event: delta\ndata: {"delta":"concise agent."}\n\n' +
      `event: proposal\ndata: ${JSON.stringify(proposal)}\n\n`;

    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(sseBody, {
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const client = createAgentConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });

    const deltas: string[] = [];
    const result = await client.propose(
      'agent',
      { intent: 'a concise agent' },
      { onDelta: (d) => deltas.push(d) },
    );

    expect(capturedUrl).toBe('http://ai-center.test/agent/console/agents:propose');
    expect(capturedInit?.method).toBe('POST');
    expect((capturedInit?.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
    expect(capturedInit?.body).toBe(JSON.stringify({ intent: 'a concise agent' }));

    expect(deltas.join('')).toBe('You are a concise agent.');
    expect(result.valid).toBe(true);
    expect((result.content as { skillRefs: string[] }).skillRefs).toEqual(['web-search']);
    expect(result.suggestions).toEqual([
      { kind: 'skill', ref: 'web-search', rationale: 'lookup' },
    ]);
  });
});
