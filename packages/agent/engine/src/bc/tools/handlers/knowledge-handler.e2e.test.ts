import { describe, expect, it } from 'bun:test';
import { KnowledgeQueryPortImpl } from '@cube-ai/kb-core';
import type { RetrievalService } from '@cube-ai/kb-core';
import { KnowledgeHandler } from './knowledge-handler';
import type { ToolHandlerCtx } from '../tool-context';

function ctx(): ToolHandlerCtx {
  return {
    traceId: 'tr',
    signal: new AbortController().signal,
    auth: { tenant: 7, user: { userId: 'u', scopes: [] } },
    session: { id: '1234567890123456789', turnId: '1234567890123456788' },
    turn: {
      runtimeRefs: {
        knowledgeBases: [{ kbId: 'dir-kb', displayName: 'KB' }],
      },
    },
  } as ToolHandlerCtx;
}

describe('KnowledgeHandler e2e with in-repo KnowledgeQueryPort', () => {
  it('returns hits from kb-core adapter backed by retrieval service', async () => {
    const retrievalService = {
      searchByDirectory: async () => ({
        items: [
          {
            chunkId: 'doc-1-0',
            documentId: 'doc-1',
            chunkIndex: 0,
            text: 'answer body',
            text: 'expanded answer body',
            fileName: 'policy.pdf',
            sourceType: 'pdf',
            score: 0.88,
            vectorScore: 0.8,
            rankScore: 0.91,
            sectionId: 's1',
            headingPath: ['Policy'],
            pageNo: 2,
            chunkType: 'paragraph',
            orderInSection: 0,
          },
        ],
      }),
    } as unknown as RetrievalService;

    const port = new KnowledgeQueryPortImpl(retrievalService);
    const out = await new KnowledgeHandler(port).invoke(
      { query: 'refund policy', kbIds: ['dir-kb'], topK: 5, scoreThreshold: 0.3 },
      ctx(),
    );

    expect(out.hits).toHaveLength(1);
    expect(out.hits[0]).toEqual({
      docId: 'doc-1',
      kbId: 'dir-kb',
      title: 'policy.pdf',
      snippet: 'expanded answer body',
      score: 0.91,
      link: undefined,
    });
  });
});
