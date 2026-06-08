import { describe, expect, it } from 'bun:test';
import {
  KnowledgeQueryRequestSchema,
  KnowledgeQueryResponseSchema,
  type KnowledgeQueryPort,
} from './knowledge-query';

describe('KnowledgeQueryPort contracts', () => {
  it('Request: applies defaults topK=5 and scoreThreshold=0.3', () => {
    const ok = KnowledgeQueryRequestSchema.parse({
      tenant: 1,
      query: 'how to reset password',
      traceId: 'trace-1',
    });
    expect(ok.topK).toBe(5);
    expect(ok.scoreThreshold).toBe(0.3);
  });

  it('Request: rejects topK > 20', () => {
    expect(() =>
      KnowledgeQueryRequestSchema.parse({
        tenant: 1,
        query: 'x',
        topK: 21,
        traceId: 't',
      }),
    ).toThrow();
  });

  it('Request: rejects query shorter than 2 chars', () => {
    expect(() =>
      KnowledgeQueryRequestSchema.parse({
        tenant: 1,
        query: 'a',
        traceId: 't',
      }),
    ).toThrow();
  });

  it('Request: kbIds.maxItems = 10', () => {
    expect(() =>
      KnowledgeQueryRequestSchema.parse({
        tenant: 1,
        query: 'something',
        traceId: 't',
        kbIds: Array.from({ length: 11 }, (_, i) => `kb${i}`),
      }),
    ).toThrow();
  });

  it('Response: parses hits and truncated', () => {
    const ok = KnowledgeQueryResponseSchema.parse({
      hits: [
        { docId: 'd1', snippet: 'abc', score: 0.9, kbId: 'kb1', title: 'T', link: 'https://x' },
        { docId: 'd2', snippet: 'def', score: 0.7 },
      ],
      truncated: true,
    });
    expect(ok.hits).toHaveLength(2);
    expect(ok.truncated).toBe(true);
  });

  it('Response: defaults truncated to false when omitted', () => {
    const ok = KnowledgeQueryResponseSchema.parse({ hits: [] });
    expect(ok.truncated).toBe(false);
  });

  it('exports the KnowledgeQueryPort type', () => {
    const fake: KnowledgeQueryPort = { query: async () => ({ hits: [], truncated: false }) };
    expect(typeof fake.query).toBe('function');
  });
});
