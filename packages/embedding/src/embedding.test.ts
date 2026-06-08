import { describe, expect, test } from 'bun:test';
import type { LlmProviderPort } from '@cube-ai/contracts';
import {
  buildDoubaoMultimodalEmbedBody,
  LlmProviderEmbeddingPort,
  normalizeSparseEmbedding,
  resolveRetrievalInstruction,
} from './index';

describe('buildDoubaoMultimodalEmbedBody', () => {
  test('builds multimodal request body using text inputs', () => {
    const body = buildDoubaoMultimodalEmbedBody({
      model: 'doubao-embedding-vision-251215',
      input: ['第一段文本', '第二段文本'],
      dimension: 1024,
      purpose: 'document',
    });

    expect(body).toEqual({
      model: 'doubao-embedding-vision-251215',
      instructions: 'Instruction:Compress the text into one word.\nQuery:',
      input: [{ type: 'text', text: '第一段文本' }, { type: 'text', text: '第二段文本' }],
      dimensions: 1024,
      multi_embedding: { type: 'enabled' },
      sparse_embedding: { type: 'enabled' },
      encoding_format: 'float',
    });
  });

  test('uses retrieval-specific instruction for query embeddings', () => {
    const body = buildDoubaoMultimodalEmbedBody({
      model: 'doubao-embedding-vision-251215',
      input: ['痛点问题'],
      dimension: 1024,
      purpose: 'query',
    });

    expect(body.instructions).toBe(
      'Target_modality: text.\nInstruction:为这个问题生成表示以用于检索可回答问题的相关内容\nQuery:',
    );
  });

  test('uses entity lookup instruction when retrieval profile is provided', () => {
    const body = buildDoubaoMultimodalEmbedBody({
      model: 'doubao-embedding-vision-251215',
      input: ['研发中心3号265CBRS'],
      dimension: 1024,
      purpose: 'query',
      contexts: [{ retrievalProfile: 'entity-lookup' }],
    });

    expect(body.instructions).toBe(
      'Target_modality: text.\nInstruction:根据名称、编号、别名或关键词检索最相关的结构化记录\nQuery:',
    );
  });
});

describe('normalizeSparseEmbedding', () => {
  test('extracts dense and sparse embedding from response payload', () => {
    expect(
      normalizeSparseEmbedding([{ index: 1, value: 0.9 }]),
    ).toEqual({ indices: [1], values: [0.9] });
  });
});

describe('LlmProviderEmbeddingPort', () => {
  test('embed returns {dense,sparse} from provider', async () => {
    const provider: LlmProviderPort = {
      chat: async () => ({ content: '', finishReason: 'stop' }),
      chatStream: async function* () {},
      embed: async () => [
        { dense: [0.1, 0.2], sparse: { indices: [1], values: [0.9] } },
        { dense: [0.3, 0.4], sparse: { indices: [2], values: [0.7] } },
      ],
    };

    const port = new LlmProviderEmbeddingPort({
      provider,
      modelCode: 'doubao-embedding-vision-251215',
      tenant: 1,
      dimension: 1024,
    });

    const vectors = await port.embed(['q1', 'q2'], 'query', [{ retrievalProfile: 'semantic-qa' }]);

    expect(vectors).toEqual([
      { dense: [0.1, 0.2], sparse: { indices: [1], values: [0.9] } },
      { dense: [0.3, 0.4], sparse: { indices: [2], values: [0.7] } },
    ]);
    expect(port.dimension).toBe(1024);
  });

  test('resolveModelCode overrides static modelCode per embed call', async () => {
    const seen: string[] = [];
    const provider: LlmProviderPort = {
      chat: async () => ({ content: '', finishReason: 'stop' }),
      chatStream: async function* () {},
      embed: async (req) => {
        seen.push(req.modelCode);
        return req.input.map(() => ({ dense: [0.1] }));
      },
    };

    const port = new LlmProviderEmbeddingPort({
      provider,
      modelCode: 'env-model',
      tenant: 1,
      dimension: 4,
      resolveModelCode: () => 'turn-model',
    });

    await port.embed(['q']);
    expect(seen).toEqual(['turn-model']);
  });
});

describe('resolveRetrievalInstruction', () => {
  test('maps retrieval profile to query instructions', () => {
    expect(resolveRetrievalInstruction('query', 'entity-lookup')).toContain('结构化记录');
  });
});
