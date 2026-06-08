import { describe, expect, it } from 'bun:test';
import type { AdapterCallContext } from '@tachu/core';
import {
  PAYLOAD_AGENTIC_SFID_KEY,
  toQdrantPointId,
} from './qdrant-point-id';
import { CubeQdrantMemoryIndex } from './cube-qdrant-memory-index';

describe('toQdrantPointId', () => {
  it('maps long numeric SFID to deterministic UUID', () => {
    const id = toQdrantPointId('9999999999999999999');
    expect(typeof id).toBe('string');
    expect(String(id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe('CubeQdrantMemoryIndex', () => {
  const ctx: AdapterCallContext = {
    correlation: { traceId: 'tr1', requestId: 'rq1', sessionId: 's1', turnId: 't1' },
    tenant: 7,
  };

  it('upsert maps tenant + sfid payload and uses vector-qdrant dense upsert', async () => {
    let captured:
      | {
          collectionName: string;
          points: Array<{ id: string; vectors: { dense: number[] }; payload: Record<string, unknown> }>;
        }
      | undefined;
    const index = new CubeQdrantMemoryIndex({ url: 'http://localhost:6333' });
    const mutable = index as unknown as {
      collectionReady: boolean;
      vectorIndex: {
        ensureCollection: () => Promise<void>;
        upsert: (
          collectionName: string,
          points: Array<{ id: string; vectors: { dense: number[] }; payload: Record<string, unknown> }>,
        ) => Promise<void>;
      };
    };
    mutable.collectionReady = true;
    mutable.vectorIndex = {
      async ensureCollection() {},
      async upsert(collectionName, points) {
        captured = { collectionName, points };
      },
    };

    await index.upsert(
      [
        {
          id: '281474976710656',
          vector: [0.1, 0.2],
          payload: { sessionId: 's1', userId: 'u1' },
        },
      ],
      ctx,
    );
    expect(captured?.collectionName).toBe('agentic_engine_memory');
    expect(captured?.points).toHaveLength(1);
    expect(captured?.points[0]?.payload['tenant']).toBe(7);
    expect(captured?.points[0]?.payload[PAYLOAD_AGENTIC_SFID_KEY]).toBe('281474976710656');
    expect(captured?.points[0]?.vectors.dense).toEqual([0.1, 0.2]);
  });

  it('searchVector merges tenant filter and restores business id', async () => {
    const index = new CubeQdrantMemoryIndex({ url: 'http://localhost:6333' });
    const mutable = index as unknown as {
      collectionReady: boolean;
      vectorIndex: {
        ensureCollection: () => Promise<void>;
        query: (params: {
          filter?: { must?: Array<{ key: string; match: { value: unknown } }> };
        }) => Promise<Array<{ id: string; score: number; payload: Record<string, unknown> }>>;
      };
    };
    mutable.collectionReady = true;
    mutable.vectorIndex = {
      async ensureCollection() {},
      async query(params) {
        expect(
          params.filter?.must?.some(
            (clause) => clause.key === 'tenant' && clause.match.value === 7,
          ),
        ).toBe(true);
        expect(
          params.filter?.must?.some(
            (clause) => clause.key === 'sessionId' && clause.match.value === 's1',
          ),
        ).toBe(true);
        return [
          {
            id: String(toQdrantPointId('entry-1')),
            score: 0.9,
            payload: {
              tenant: 7,
              [PAYLOAD_AGENTIC_SFID_KEY]: 'entry-1',
              snippet: 'hello',
            },
          },
        ];
      },
    };

    const hits = await index.searchVector(
      [0.1, 0.2],
      5,
      { must: { sessionId: 's1' } },
      ctx,
    );
    expect(hits[0]!.id).toBe('entry-1');
    expect(hits[0]!.score).toBe(0.9);
  });
});
