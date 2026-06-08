import { describe, expect, test } from 'bun:test';
import {
  KnowledgeQueryPortImpl,
  mapKbIdsToDirectoryIds,
  mapSearchItemToKnowledgeHit,
  mapTenantToProjectId,
} from './knowledge-query.port-impl';
import type { SearchItem } from '../modules/common/document-types';
import type { RetrievalService } from '../modules/vector-store/services/retrieval.service';

describe('KnowledgeQueryPort mapping', () => {
  test('maps tenant to projectId string', () => {
    expect(mapTenantToProjectId(9)).toBe('9');
  });

  test('maps kbIds to unique directory ids', () => {
    expect(mapKbIdsToDirectoryIds(['kb-a', 'kb-b', 'kb-a'])).toEqual(['kb-a', 'kb-b']);
  });

  test('maps SearchItem to KnowledgeHit using text and rankScore', () => {
    const item: SearchItem = {
      chunkId: 'doc-1-0',
      documentId: 'doc-1',
      chunkIndex: 0,
      text: 'aggregated snippet text',
      fileName: 'guide.pdf',
      sourceType: 'pdf',
      score: 0.5,
      vectorScore: 0.4,
      rankScore: 0.82,
      sectionId: 's1',
      headingPath: ['Intro'],
      pageNo: 1,
      chunkType: 'paragraph',
    };

    expect(mapSearchItemToKnowledgeHit(item, 'dir-1')).toEqual({
      docId: 'doc-1',
      kbId: 'dir-1',
      title: 'guide.pdf',
      snippet: 'aggregated snippet text',
      score: 0.82,
      link: undefined,
    });
  });

  test('query delegates to retrievalService.searchByDirectory per kbId', async () => {
    const calls: Array<{ directoryId: string; similarityThreshold: number }> = [];
    const retrievalService = {
      searchByDirectory: async (params: {
        query: string;
        topK: number;
        directoryId: string;
        similarityThreshold?: number;
      }) => {
        calls.push({
          directoryId: params.directoryId,
          similarityThreshold: params.similarityThreshold ?? 0,
        });
        return {
          items: [
            {
              chunkId: `${params.directoryId}-0`,
              documentId: 'doc-1',
              chunkIndex: 0,
              text: 'body',
              fileName: 'f.pdf',
              sourceType: 'pdf',
              score: 0.9,
              vectorScore: 0.9,
              rankScore: 0.91,
              sectionId: 's',
              headingPath: [],
              pageNo: null,
              chunkType: 'paragraph',
              orderInSection: 0,
            },
          ],
        };
      },
    } as unknown as RetrievalService;

    const port = new KnowledgeQueryPortImpl(retrievalService);
    const resp = await port.query(
      {
        tenant: 42,
        query: 'hello world',
        kbIds: ['dir-a', 'dir-b'],
        topK: 3,
        scoreThreshold: 0.3,
        traceId: 'tr',
      },
      new AbortController().signal,
    );

    expect(calls).toEqual([
      { directoryId: 'dir-a', similarityThreshold: 0.3 },
      { directoryId: 'dir-b', similarityThreshold: 0.3 },
    ]);
    expect(resp.hits).toHaveLength(2);
    expect(resp.hits[0]?.kbId).toBe('dir-a');
  });
});
