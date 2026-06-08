import { describe, expect, it } from 'bun:test';
import type {
  KnowledgeQueryPort,
  KnowledgeQueryRequest,
  KnowledgeQueryResponse,
} from '@cube-ai/contracts';
import { KnowledgeHandler } from './knowledge-handler';
import type { ToolHandlerCtx } from '../tool-context';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';

function ctx(
  runtimeRefs: NonNullable<ToolHandlerCtx['turn']>['runtimeRefs'] | null = {
    knowledgeBases: [{ kbId: 'kb', displayName: 'Product KB' }],
  },
): ToolHandlerCtx {
  const base = {
    traceId: 'tr',
    signal: new AbortController().signal,
    auth: { tenant: 9, user: { userId: 'u', scopes: [] } },
    session: { id: '1234567890123456789', turnId: '1234567890123456788' },
  } as ToolHandlerCtx;
  if (runtimeRefs !== null) {
    base.turn = { runtimeRefs };
  }
  return base;
}

class MockKnowledgePort implements KnowledgeQueryPort {
  lastReq: KnowledgeQueryRequest | undefined;
  toReturn: KnowledgeQueryResponse = { hits: [], truncated: false };
  toThrow: Error | undefined;
  async query(req: KnowledgeQueryRequest): Promise<KnowledgeQueryResponse> {
    this.lastReq = req;
    if (this.toThrow) throw this.toThrow;
    return this.toReturn;
  }
}

describe('KnowledgeHandler', () => {
  it('forwards tenant from ctx and full query body', async () => {
    const port = new MockKnowledgePort();
    port.toReturn = {
      hits: [
        { docId: 'd1', kbId: 'kb', title: 't', snippet: 's', score: 0.9, link: 'https://x' },
      ],
      truncated: false,
    };
    const out = await new KnowledgeHandler(port).invoke(
      { query: 'hello world', kbIds: ['kb'], topK: 3, scoreThreshold: 0.5 },
      ctx(),
    );
    expect(port.lastReq?.tenant).toBe(9);
    expect(port.lastReq?.kbIds).toEqual(['kb']);
    expect(port.lastReq?.topK).toBe(3);
    expect(out.hits).toHaveLength(1);
    expect(out.truncated).toBe(false);
  });

  it('applies handler defaults when input omits topK / scoreThreshold', async () => {
    const port = new MockKnowledgePort();
    await new KnowledgeHandler(port).invoke({ query: 'hi there' }, ctx());
    expect(port.lastReq?.kbIds).toEqual(['kb']);
    expect(port.lastReq?.topK).toBe(5);
    expect(port.lastReq?.scoreThreshold).toBe(0.3);
  });

  it('defaults omitted kbIds to the current turn runtimeRefs knowledgeBases', async () => {
    const port = new MockKnowledgePort();
    await new KnowledgeHandler(port).invoke(
      { query: 'release checklist' },
      ctx({
        knowledgeBases: [
          { kbId: 'kb-a', displayName: 'A' },
          { kbId: 'kb-b', displayName: 'B' },
          { kbId: 'kb-a', displayName: 'A duplicated' },
        ],
      }),
    );
    expect(port.lastReq?.kbIds).toEqual(['kb-a', 'kb-b']);
  });

  it('rejects kbIds that are not attached to the current turn', async () => {
    const port = new MockKnowledgePort();
    let caught: AgenticEngineError | undefined;
    try {
      await new KnowledgeHandler(port).invoke(
        { query: 'release checklist', kbIds: ['kb-b'] },
        ctx({ knowledgeBases: [{ kbId: 'kb-a', displayName: 'A' }] }),
      );
    } catch (e) {
      caught = e as AgenticEngineError;
    }
    expect(caught?.code).toBe('PERMISSION_DENIED_AUTHZ_AT_RUNTIME');
    expect(port.lastReq).toBeUndefined();
  });

  it('rejects knowledge query when this turn has no knowledgeBases runtime ref', async () => {
    const port = new MockKnowledgePort();
    let caught: AgenticEngineError | undefined;
    try {
      await new KnowledgeHandler(port).invoke({ query: 'release checklist' }, ctx(null));
    } catch (e) {
      caught = e as AgenticEngineError;
    }
    expect(caught?.code).toBe('PERMISSION_DENIED_AUTHZ_AT_RUNTIME');
    expect(port.lastReq).toBeUndefined();
  });

  it('rejects query length 1 with INVALID_ARGUMENT_SCHEMA_VIOLATION', async () => {
    let caught: AgenticEngineError | undefined;
    try {
      await new KnowledgeHandler(new MockKnowledgePort()).invoke({ query: 'x' }, ctx());
    } catch (e) {
      caught = e as AgenticEngineError;
    }
    expect(caught?.code).toBe('INVALID_ARGUMENT_SCHEMA_VIOLATION');
  });
});
