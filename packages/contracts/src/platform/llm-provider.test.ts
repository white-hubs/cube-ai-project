import { describe, expect, it } from 'bun:test';
import {
  LlmChatRequestSchema,
  LlmChatResponseSchema,
  LlmEmbedRequestSchema,
  LlmEmbedResultSchema,
  LlmSparseVectorSchema,
  LlmStreamChunkSchema,
  type LlmProviderPort,
} from './llm-provider';

describe('LlmProviderPort contracts', () => {
  it('LlmChatRequestSchema requires tenant and modelCode', () => {
    expect(() =>
      LlmChatRequestSchema.parse({
        tenant: 1,
        modelCode: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).not.toThrow();

    expect(() =>
      LlmChatRequestSchema.parse({
        tenant: 1,
        modelCode: 'gpt-4o',
        messages: [],
      }),
    ).toThrow();
  });

  it('LlmChatResponseSchema accepts content and usage', () => {
    const ok = LlmChatResponseSchema.parse({
      content: 'hello',
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });
    expect(ok.content).toBe('hello');
  });

  it('LlmStreamChunkSchema accepts text-delta and finish', () => {
    expect(LlmStreamChunkSchema.parse({ type: 'text-delta', delta: 'x' })).toEqual({
      type: 'text-delta',
      delta: 'x',
    });
    expect(
      LlmStreamChunkSchema.parse({
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }).type,
    ).toBe('finish');
  });

  it('LlmEmbedResultSchema enforces G3 dense + optional sparse', () => {
    expect(
      LlmEmbedResultSchema.parse({
        dense: [0.1, 0.2],
      }).sparse,
    ).toBeUndefined();

    const withSparse = LlmEmbedResultSchema.parse({
      dense: [0.1, 0.2],
      sparse: { indices: [1, 3], values: [0.5, 0.9] },
    });
    expect(withSparse.sparse?.indices).toEqual([1, 3]);

    expect(LlmSparseVectorSchema.parse(null)).toBeNull();
  });

  it('LlmEmbedRequestSchema accepts purpose and retrievalProfile context', () => {
    const ok = LlmEmbedRequestSchema.parse({
      tenant: 42,
      modelCode: 'doubao-embedding-vision-251215',
      input: ['query text'],
      purpose: 'query',
      contexts: [{ retrievalProfile: 'semantic-qa' }],
    });
    expect(ok.purpose).toBe('query');
  });

  it('LlmProviderPort type compiles for chat/stream/embed', () => {
    const fake: LlmProviderPort = {
      chat: async () => ({ content: 'ok', finishReason: 'stop' }),
      chatStream: async function* () {
        yield { type: 'finish', finishReason: 'stop' };
      },
      embed: async () => [{ dense: [1] }],
    };
    expect(typeof fake.chat).toBe('function');
    expect(typeof fake.chatStream).toBe('function');
    expect(typeof fake.embed).toBe('function');
  });
});
