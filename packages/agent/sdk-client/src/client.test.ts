import { describe, expect, test } from 'bun:test';
import { createAgenticClient, AgenticClient } from './client';
import { AgenticClientError } from './errors';
import { SDK_VERSION } from './versioning';
import { AGENTIC_CONTRACTS_VERSION } from '@cube-ai/contracts';

describe('AgenticClient HTTP 封装', () => {
  test('requestJson 自动注入 X-Agentic-SDK-Version / X-Request-Id / traceparent + Bearer', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      captured = init;
      return Response.json(
        { status: 200, id: '1000000000000000001', createTime: Date.now() },
        { status: 201 },
      );
    };

    const client = new AgenticClient({
      baseUrl:    'http://engine.test',
      auth:       { provider: () => 'tok-ok' },
      fetchImpl:  fetchImpl as unknown as typeof fetch,
    });

    await client.requestJson({ method: 'POST', path: '/v1/sessions', body: { agentId: '1' } });

    const h = new Headers(captured!.headers as HeadersInit);
    expect(h.get('Authorization')).toBe('Bearer tok-ok');
    expect(h.get('X-Agentic-SDK-Version')).toBe(SDK_VERSION);
    expect(h.get('X-Agentic-Contracts-Version')).toBe(AGENTIC_CONTRACTS_VERSION);
    expect(h.get('traceparent')).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    expect(h.get('X-Request-Id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test('4xx 响应解析 5 字段 envelope → AgenticClientError', async () => {
    const fetchImpl = async (): Promise<Response> =>
      Response.json(
        {
          status:    404,
          code:      'RESOURCE_NOT_FOUND_SESSION',
          message:   'no session',
          details:   { traceId: 'abc123' },
          timestamp: Date.now(),
        },
        {
          status: 404,
          headers: { 'X-Trace-Id': 'hdr-trace' },
        },
      );

    const client = createAgenticClient({
      baseUrl:   'http://engine.test',
      token:     't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    let err: AgenticClientError | undefined;
    try {
      await client.sessions.get('1');
    } catch (e) {
      err = e as AgenticClientError;
    }
    expect(err).toBeInstanceOf(AgenticClientError);
    expect(err!.code).toBe('RESOURCE_NOT_FOUND_SESSION');
    expect(err!.httpStatus).toBe(404);
    expect(err!.traceId).toBe('hdr-trace');
  });

  test('网络错误时按 retry 重试直到成功', async () => {
    let n = 0;
    const fetchImpl = async (): Promise<Response> => {
      n++;
      if (n < 3) throw new TypeError('fetch failed');
      return Response.json(
        { items: [], page: { hasMore: false } },
        { status: 200 },
      );
    };

    const client = createAgenticClient({
      baseUrl:   'http://engine.test',
      token:     't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retry:     { maxAttempts: 4, baseDelayMs: 1 },
    });

    const r = await client.sessions.list();
    expect(n).toBe(3);
    expect(r.items).toEqual([]);
  });

  test('默认产出的标准 header key 全部小写（RFC 7230 + ghcloud parity）', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      captured = init;
      return Response.json(
        { id: '1000000000000000001', status: 'ACTIVE', createTime: Date.now() },
        { status: 201 },
      );
    };

    const client = new AgenticClient({
      baseUrl:   'http://engine.test',
      auth:      { provider: () => 'tok' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.requestJson({
      method: 'POST',
      path:   '/v1/sessions',
      body:   { agentId: '1' },
      idempotencyKey: 'idem-1',
    });

    const raw = captured!.headers as Record<string, string>;
    expect(raw).toHaveProperty('authorization');
    expect(raw.authorization).toBe('Bearer tok');
    expect(raw).toHaveProperty('content-type');
    expect(raw['content-type']).toBe('application/json');
    expect(raw).toHaveProperty('idempotency-key');
    expect(raw['idempotency-key']).toBe('idem-1');
    expect(raw).toHaveProperty('accept');
    expect(raw.accept).toBe('application/json');
    expect(raw).toHaveProperty('traceparent');
    expect(raw).not.toHaveProperty('Authorization');
    expect(raw).not.toHaveProperty('Content-Type');
  });

  test('headersProvider 合并入 outgoing headers（auth 之后、caller-extra 之前）', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      captured = init;
      return Response.json({}, { status: 204 });
    };

    let tenantCalled = 0;
    const client = new AgenticClient({
      baseUrl:   'http://engine.test',
      auth:      { provider: () => 'tok' },
      headersProvider: () => {
        tenantCalled++;
        return { tenant: '42', terminal: '3', authorization: 'should-not-override' };
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.requestJson({ method: 'GET', path: '/v1/sessions/1' });

    expect(tenantCalled).toBe(1);
    const raw = captured!.headers as Record<string, string>;
    expect(raw.tenant).toBe('42');
    expect(raw.terminal).toBe('3');
    // headersProvider override `authorization`（合并顺序：auth → provider → caller extra）
    expect(raw.authorization).toBe('should-not-override');
  });

  test('headersProvider 支持 async function', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      captured = init;
      return Response.json({}, { status: 204 });
    };

    const client = new AgenticClient({
      baseUrl: 'http://engine.test',
      headersProvider: async () => ({ tenant: '7' }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.requestJson({ method: 'GET', path: '/v1/sessions/1' });
    expect((captured!.headers as Record<string, string>).tenant).toBe('7');
  });

  test('401 时 onUnauthorized 返回新 token 后重放一次', async () => {
    let call = 0;
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      call++;
      const auth = new Headers(init?.headers as HeadersInit).get('Authorization');
      if (call === 1) {
        expect(auth).toBe('Bearer old');
        return Response.json(
          { status: 401, code: 'UNAUTHENTICATED_TOKEN_EXPIRED', message: 'exp', details: null, timestamp: Date.now() },
          { status: 401 },
        );
      }
      expect(auth).toBe('Bearer fresh');
      return Response.json(
        {
          id:         '1000000000000000001',
          status:     'ACTIVE',
          agentId:    '2000000000000000001',
          userId:     'u1',
          title:      null,
          createTime: Date.now(),
          updateTime: Date.now(),
        },
        { status: 200 },
      );
    };

    const client = createAgenticClient({
      baseUrl:   'http://engine.test',
      auth:      {
        provider:        () => 'old',
        onUnauthorized:  async () => 'fresh',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const s = await client.sessions.get('1000000000000000001');
    expect(String(s.id)).toBe('1000000000000000001');
    expect(call).toBe(2);
  });

  /**
   * 回归：`baseUrl` 含 path 段（如网关反代 `https://gw/api/agentic-engine`）时，
   * 必须**保留**该 path 段做前缀拼接，**不**走 `new URL(path, base)` 的语义
   * （后者会把 `/v1/sessions` 当绝对路径吞掉 base.path）。
   */
  test('baseUrl 带 path 前缀时，请求 URL 保留该 path（不被 path-absolute 吞掉）', async () => {
    let capturedUrl = '';
    const fetchImpl = async (u: string, _init?: RequestInit): Promise<Response> => {
      capturedUrl = u;
      return Response.json({ items: [], page: { hasMore: false } }, { status: 200 });
    };
    const client = createAgenticClient({
      baseUrl:   'https://gw.example.com/api/agentic-engine',
      auth:      { provider: () => '' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.sessions.list({ limit: 10 });
    expect(capturedUrl).toContain('https://gw.example.com/api/agentic-engine/v1/sessions');
    expect(capturedUrl).toContain('limit=10');
  });

  /** baseUrl 是「纯路径」（如 qiankun 子应用相对路径 `/api/agentic-engine`）也保留前缀。 */
  test('baseUrl 为相对路径前缀时，请求 URL 仍保留该前缀', async () => {
    let capturedUrl = '';
    const fetchImpl = async (u: string, _init?: RequestInit): Promise<Response> => {
      capturedUrl = u;
      return Response.json({ items: [], page: { hasMore: false } }, { status: 200 });
    };
    const client = createAgenticClient({
      baseUrl:   '/api/agentic-engine',
      auth:      { provider: () => '' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.sessions.list();
    expect(capturedUrl).toBe('/api/agentic-engine/v1/sessions');
  });
});
