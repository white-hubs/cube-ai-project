import { describe, expect, test } from 'bun:test';
import { createAgenticClient } from './client';
import {
  AgenticClientError,
  SessionBusyError,
  StartTurnFailedError,
  StreamDisconnectedError,
} from './errors';
import {
  buildImageRefBlock,
  buildMultimodalTurnBody,
  buildTextMessage,
} from './session';

function sseResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const chunk = lines.join('');
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(enc.encode(chunk));
      ctrl.close();
    },
  });
  return new Response(stream as ReadableStream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('SessionApi — CRUD', () => {
  test('create 请求体仅含 agentId（无 tenant）', async () => {
    let body = '';
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      body = init?.body as string;
      return Response.json(
        { id: '3000000000000000001', status: 'ACTIVE', createTime: Date.now() },
        { status: 201 },
      );
    };

    const client = createAgenticClient({
      baseUrl:   'http://mock',
      token:     'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const agentSfid = '3000000000000000002';
    await client.sessions.create({ agentId: agentSfid, title: 'hi' });
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed.agentId).toBe(agentSfid);
    expect(String(parsed.agentId)).toMatch(/^\d{19}$/);
    expect(parsed).not.toHaveProperty('tenant');
  });

  test('get 解析 Session', async () => {
    const agentSfid = '4000000000000000002';
    const fetchImpl = async (): Promise<Response> =>
      Response.json({
        id: '4000000000000000001',
        status: 'ACTIVE',
        agentId: agentSfid,
        userId: 'u',
        title: null,
        createTime: 1,
        updateTime: 2,
      });

    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const one = await client.sessions.get('4000000000000000001');
    expect(one.id).toMatch(/^\d{1,20}$/);
  });

  test('list 解析分页 envelope', async () => {
    const fetchImpl = async (): Promise<Response> =>
      Response.json({
        items: [{
          id: '4000000000000000001',
          status: 'ACTIVE',
          agentId: '4000000000000000002',
          userId: 'u',
          title: null,
          createTime: 1,
          updateTime: 2,
        }],
        page: { hasMore: false },
      });

    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const list = await client.sessions.list({});
    expect(list.page.hasMore).toBe(false);
    expect(list.items).toHaveLength(1);
  });

  test('delete 调用 DELETE 且 204 无 JSON 解析异常', async () => {
    let method = '';
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      method = init?.method ?? '';
      return new Response(null, { status: 204 });
    };

    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.sessions.delete('6000000000000000001');
    expect(method).toBe('DELETE');
  });

  test('patchSession PATCHes /sessions/:id with title', async () => {
    let captured: { url?: string; method?: string; body?: string } = {};
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      captured = { url, method: init?.method, body: init?.body as string };
      return new Response(null, { status: 204 });
    };

    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.sessions.patch('6000000000000000001', { title: 'new title' });
    expect(captured.method).toBe('PATCH');
    expect(captured.url).toContain('/sessions/6000000000000000001');
    const parsed = JSON.parse(captured.body ?? '{}') as Record<string, unknown>;
    expect(parsed.title).toBe('new title');
  });

  test('listMessages GETs /sessions/:id/messages?limit=', async () => {
    let captured = '';
    const fetchImpl = async (url: string): Promise<Response> => {
      captured = url;
      return Response.json({
        items: [
          {
            id: '8000000000000000001',
            turnId: '8000000000000000010',
            sessionId: '8000000000000000099',
            seq: 0,
            role: 'assistant',
            content: { schema: 'message-content-v1', blocks: [{ type: 'text', text: 'hi' }] },
            createTime: 1,
          },
        ],
        page: { hasMore: false },
      });
    };

    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.sessions.listMessages('8000000000000000099', { limit: 200 });
    expect(captured).toContain('/sessions/8000000000000000099/messages');
    expect(captured).toContain('limit=200');
    expect(result.items).toHaveLength(1);
  });
});

describe('SessionApi — startTurn', () => {
  test('POST /sessions/:id/messages → returns { turnId } + content-type 小写 + 自动 idempotency-key', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      captured = { url, init };
      return Response.json({ turnId: '9000000000000000001' }, { status: 200 });
    };

    const client = createAgenticClient({
      baseUrl:   'http://mock',
      token:     'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const { turnId } = await client.sessions.startTurn('8000000000000000099', {
      content: buildTextMessage('hello'),
    });
    expect(turnId).toBe('9000000000000000001');
    expect(captured.url).toContain('/sessions/8000000000000000099/messages');
    expect(captured.init?.method).toBe('POST');
    const h = captured.init?.headers as Record<string, string>;
    expect(h['content-type']).toBe('application/json');
    expect(h['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('respects caller-provided idempotencyKey', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      captured = init;
      return Response.json({ turnId: '1' });
    };
    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.sessions.startTurn('1', { content: buildTextMessage('x') }, { idempotencyKey: 'caller-key-1' });
    expect((captured!.headers as Record<string, string>)['idempotency-key']).toBe('caller-key-1');
  });

  test('forwards modelCode / providerCode / providerId', async () => {
    let captured = '';
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      captured = init?.body as string;
      return Response.json({ turnId: '1' });
    };
    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.sessions.startTurn('1', {
      content: buildTextMessage('x'),
      modelCode: 'gpt-4o',
      providerCode: 'openai',
      providerId: 'p-1',
    });
    const parsed = JSON.parse(captured) as Record<string, unknown>;
    expect(parsed.modelCode).toBe('gpt-4o');
    expect(parsed.providerCode).toBe('openai');
    expect(parsed.providerId).toBe('p-1');
  });

  test('forwards skillEmbeddingModelCode in startTurn body', async () => {
    let captured = '';
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      captured = init?.body as string;
      return Response.json({ turnId: '1' });
    };
    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.sessions.startTurn('1', {
      content: buildTextMessage('x'),
      skillEmbeddingModelCode: 'text-embedding-3-large',
    });
    const parsed = JSON.parse(captured) as Record<string, unknown>;
    expect(parsed.skillEmbeddingModelCode).toBe('text-embedding-3-large');
  });

  test('forwards runtimeRefs in startTurn body', async () => {
    let captured = '';
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      captured = init?.body as string;
      return Response.json({ turnId: '1' });
    };
    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.sessions.startTurn('1', {
      content: buildTextMessage('x'),
      runtimeRefs: {
        knowledgeBases: [{ kbId: 'kb-1', displayName: '产品知识库' }],
      },
    });
    const parsed = JSON.parse(captured) as Record<string, unknown>;
    expect(parsed.runtimeRefs).toEqual({
      knowledgeBases: [{ kbId: 'kb-1', displayName: '产品知识库' }],
    });
  });

  test('forwards attachments for multimodal startTurn body', async () => {
    let captured = '';
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      captured = init?.body as string;
      return Response.json({ turnId: '1' });
    };
    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.sessions.startTurn(
      '1',
      buildMultimodalTurnBody(
        [{ type: 'text', text: 'look' }, buildImageRefBlock('att_01')],
        [
          {
            attachmentId: 'att_01',
            kind: 'image',
            fileId: 'file_01',
            mimeType: 'image/png',
            previewUrl: '/files/file_01/preview',
          },
        ],
      ),
    );
    const parsed = JSON.parse(captured) as Record<string, unknown>;
    expect(parsed.attachments).toEqual([
      {
        attachmentId: 'att_01',
        kind: 'image',
        fileId: 'file_01',
        mimeType: 'image/png',
        previewUrl: '/files/file_01/preview',
      },
    ]);
  });

  test('409 RESOURCE_CONFLICT_TURN_RUNNING → SessionBusyError', async () => {
    const fetchImpl = async (): Promise<Response> =>
      Response.json(
        {
          status: 409,
          code: 'RESOURCE_CONFLICT_TURN_RUNNING',
          message: 'session already has a running turn',
          details: null,
          timestamp: Date.now(),
        },
        { status: 409 },
      );

    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.sessions.startTurn('1', { content: buildTextMessage('x') }),
    ).rejects.toBeInstanceOf(SessionBusyError);
  });

  test('5xx → StartTurnFailedError', async () => {
    const fetchImpl = async (): Promise<Response> =>
      Response.json(
        {
          status: 500,
          code: 'INTERNAL_UNKNOWN',
          message: 'oops',
          details: null,
          timestamp: Date.now(),
        },
        { status: 500 },
      );
    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retry: { maxAttempts: 1, baseDelayMs: 1 },
    });

    let err: unknown;
    try {
      await client.sessions.startTurn('1', { content: buildTextMessage('x') });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StartTurnFailedError);
    expect(err).toBeInstanceOf(AgenticClientError);
  });
});

describe('SessionApi — streamEvents', () => {
  test('GET /sessions/:id/events → yields parsed SseEvents', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      captured = { url, init };
      return sseResponse([
        'id: 5000000000000000002:000001\n',
        'event: turn.started\n',
        `data: ${JSON.stringify({
          schema: 'turn-started-v1',
          turnId: '5000000000000000002',
          turnNo: 1,
          startTime: Date.now(),
          userMessageId: '5000000000000000003',
        })}\n\n`,
      ]);
    };

    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const collected: string[] = [];
    for await (const ev of client.sessions.streamEvents('5000000000000000099')) {
      collected.push(ev.schema);
    }

    expect(captured.init?.method).toBe('GET');
    expect(captured.url).toContain('/sessions/5000000000000000099/events');
    expect((captured.init?.headers as Record<string, string>).accept).toBe('text/event-stream');
    expect(collected).toContain('turn-started-v1');
  });

  test('passes last-event-id (lowercase) header when opts.lastEventId is provided', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      captured = init;
      return sseResponse([]);
    };
    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const iter = client.sessions.streamEvents('1', { lastEventId: 'evt-99' });
    for await (const _ of iter) { /* drain */ void _ }
    const h = captured!.headers as Record<string, string>;
    expect(h['last-event-id']).toBe('evt-99');
  });

  test('appends ?turnId={turnId} when opts.turnId is provided (per-turn SSE, ADR-0008 §D5.1.v2)', async () => {
    let capturedUrl: string | undefined;
    const fetchImpl = async (url: string): Promise<Response> => {
      capturedUrl = url;
      return sseResponse([]);
    };
    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const iter = client.sessions.streamEvents('s-1', {
      turnId: '5000000000000000002',
    });
    for await (const _ of iter) { /* drain */ void _ }
    expect(capturedUrl).toBe('http://mock/sessions/s-1/events?turnId=5000000000000000002');
  });

  test('omits ?turnId= when not provided (session-scope v1 compat)', async () => {
    let capturedUrl: string | undefined;
    const fetchImpl = async (url: string): Promise<Response> => {
      capturedUrl = url;
      return sseResponse([]);
    };
    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const iter = client.sessions.streamEvents('s-1');
    for await (const _ of iter) { /* drain */ void _ }
    expect(capturedUrl).toBe('http://mock/sessions/s-1/events');
  });

  test('AbortSignal terminates the stream early', async () => {
    // Server pretends to send one event then keeps stream open
    const enc = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(
          enc.encode(
            `id: 1:1\nevent: ping\ndata: ${JSON.stringify({ schema: 'ping-v1', time: 1 })}\n\n`,
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = async (): Promise<Response> =>
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });

    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const ac = new AbortController();
    const collected: string[] = [];
    const iter = client.sessions.streamEvents('1', { signal: ac.signal });
    for await (const ev of iter) {
      collected.push(ev.schema);
      ac.abort();
    }

    expect(collected).toEqual(['ping-v1']);
    expect(cancelled).toBe(true);
  });

  test('network error during stream → StreamDisconnectedError', async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new TypeError('fetch failed');
    };
    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    let err: unknown;
    try {
      for await (const _ of client.sessions.streamEvents('1')) { void _ }
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StreamDisconnectedError);
  });

  test('non-2xx → throws AgenticClientError (not StreamDisconnectedError) before any yield', async () => {
    const fetchImpl = async (): Promise<Response> =>
      Response.json(
        {
          status: 404,
          code: 'RESOURCE_NOT_FOUND_SESSION',
          message: 'no session',
          details: null,
          timestamp: Date.now(),
        },
        { status: 404 },
      );
    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    let err: unknown;
    try {
      for await (const _ of client.sessions.streamEvents('1')) { void _ }
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AgenticClientError);
    expect(err).not.toBeInstanceOf(StreamDisconnectedError);
    expect((err as AgenticClientError).code).toBe('RESOURCE_NOT_FOUND_SESSION');
  });
});

describe('SessionApi — cancelTurn', () => {
  test('POST /sessions/:id/turns/:turnId/cancel', async () => {
    let captured: { url?: string; method?: string } = {};
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      captured = { url, method: init?.method };
      return new Response(null, { status: 204 });
    };
    const client = createAgenticClient({
      baseUrl: 'http://mock',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.sessions.cancelTurn('1', '2');
    expect(captured.url).toContain('/sessions/1/turns/2/cancel');
    expect(captured.method).toBe('POST');
  });
});

describe('buildTextMessage', () => {
  test('builds message-content-v1 with single text block', () => {
    expect(buildTextMessage('hello world')).toEqual({
      schema: 'message-content-v1',
      blocks: [{ type: 'text', text: 'hello world' }],
    });
  });

  describe('buildMultimodalTurnBody', () => {
    test('builds a multimodal message body with image_ref and attachments', () => {
      expect(
        buildMultimodalTurnBody(
          [{ type: 'text', text: 'hello world' }, buildImageRefBlock('att_01')],
          [{ attachmentId: 'att_01', kind: 'image', fileId: 'file_01', mimeType: 'image/png' }],
        ),
      ).toEqual({
        content: {
          schema: 'message-content-v1',
          blocks: [
            { type: 'text', text: 'hello world' },
            { type: 'image_ref', attachmentId: 'att_01' },
          ],
        },
        attachments: [{ attachmentId: 'att_01', kind: 'image', fileId: 'file_01', mimeType: 'image/png' }],
      });
    });
  });
});
