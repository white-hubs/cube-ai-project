import { describe, expect, it } from 'bun:test';
import {
  buildDoubaoMultimodalEmbedBody,
  DoubaoMultimodalEmbedProvider,
  normalizeSparseEmbedding,
} from './doubao-multimodal-embed';

describe('DoubaoMultimodalEmbedProvider', () => {
  it('buildDoubaoMultimodalEmbedBody enables multi_embedding and sparse_embedding', () => {
    const body = buildDoubaoMultimodalEmbedBody({
      model: 'doubao-embedding-vision-251215',
      input: ['hello'],
      dimension: 1024,
      purpose: 'query',
      contexts: [{ retrievalProfile: 'semantic-qa' }],
    });
    expect(body.multi_embedding).toEqual({ type: 'enabled' });
    expect(body.sparse_embedding).toEqual({ type: 'enabled' });
    expect(body.instructions).toContain('检索可回答问题的相关内容');
  });

  it('embed returns dense and sparse (G3)', async () => {
    const provider = new DoubaoMultimodalEmbedProvider({
      baseURL: 'https://ark.example.com/api/v3',
      apiKey: 'sk-test',
      model: 'doubao-embedding-vision-251215',
      fetch: (async () =>
        Response.json({
          data: {
            embedding: [0.1, 0.2],
            sparse_embedding: [
              { index: 1, value: 0.9 },
              { index: 3, value: 0.4 },
            ],
          },
        })) as unknown as typeof fetch,
    });
    const res = await provider.embed({
      tenant: 1,
      modelCode: 'doubao-embedding-vision-251215',
      input: ['query text'],
      purpose: 'query',
    });
    expect(res[0]?.dense).toEqual([0.1, 0.2]);
    expect(res[0]?.sparse).toEqual({ indices: [1, 3], values: [0.9, 0.4] });
  });

  it('normalizeSparseEmbedding returns null for empty arrays', () => {
    expect(normalizeSparseEmbedding([])).toBeNull();
    expect(normalizeSparseEmbedding(undefined)).toBeNull();
  });
});
