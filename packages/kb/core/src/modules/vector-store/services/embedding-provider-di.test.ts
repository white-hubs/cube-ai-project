import { describe, expect, test } from 'bun:test';
import { EmbeddingProvider } from '../infrastructure/embeddings/embedding-provider';
import { EMBEDDING_PORT_TOKEN } from '@cube-ai/contracts/platform';

describe('EmbeddingProvider DI token', () => {
  test('exports a symbol token for interface-based injection', () => {
    expect(typeof EmbeddingProvider).toBe('symbol');
  });

  test('embedding port token is distinct from kb EmbeddingProvider', () => {
    expect(typeof EMBEDDING_PORT_TOKEN).toBe('symbol');
    expect(EMBEDDING_PORT_TOKEN).not.toBe(EmbeddingProvider);
  });
});
