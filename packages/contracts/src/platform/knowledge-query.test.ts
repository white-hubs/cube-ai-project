import { describe, expect, it } from "bun:test";

import { type KnowledgeQueryPort, KnowledgeQueryRequestSchema, KnowledgeQueryResponseSchema } from "./knowledge-query";

describe("KnowledgeQueryPort contracts", () => {
  it("Request: applies defaults topK=5 and scoreThreshold=0.3", () => {
    const ok = KnowledgeQueryRequestSchema.parse({
      query: "how to reset password",
      tenant: 1,
      traceId: "trace-1",
    });
    expect(ok.topK).toBe(5);
    expect(ok.scoreThreshold).toBe(0.3);
  });

  it("Request: rejects topK > 20", () => {
    expect(() =>
      KnowledgeQueryRequestSchema.parse({
        query: "x",
        tenant: 1,
        topK: 21,
        traceId: "t",
      }),
    ).toThrow();
  });

  it("Request: rejects query shorter than 2 chars", () => {
    expect(() =>
      KnowledgeQueryRequestSchema.parse({
        query: "a",
        tenant: 1,
        traceId: "t",
      }),
    ).toThrow();
  });

  it("Request: kbIds.maxItems = 10", () => {
    expect(() =>
      KnowledgeQueryRequestSchema.parse({
        kbIds: Array.from({ length: 11 }, (_, i) => `kb${i}`),
        query: "something",
        tenant: 1,
        traceId: "t",
      }),
    ).toThrow();
  });

  it("Response: parses hits and truncated", () => {
    const ok = KnowledgeQueryResponseSchema.parse({
      hits: [
        { docId: "d1", kbId: "kb1", link: "https://x", score: 0.9, snippet: "abc", title: "T" },
        { docId: "d2", score: 0.7, snippet: "def" },
      ],
      truncated: true,
    });
    expect(ok.hits).toHaveLength(2);
    expect(ok.truncated).toBe(true);
  });

  it("Response: preserves a structured chunk source anchor when provided", () => {
    const ok = KnowledgeQueryResponseSchema.parse({
      hits: [{ chunkId: "c1", docId: "d1", pageNo: 2, score: 0.9, sectionId: "s1", snippet: "abc" }],
    });
    expect(ok.hits[0]?.chunkId).toBe("c1");
    expect(ok.hits[0]?.pageNo).toBe(2);
    expect(ok.hits[0]?.sectionId).toBe("s1");
  });

  it("Response: defaults truncated to false when omitted", () => {
    const ok = KnowledgeQueryResponseSchema.parse({ hits: [] });
    expect(ok.truncated).toBe(false);
  });

  it("exports the KnowledgeQueryPort type", () => {
    const fake: KnowledgeQueryPort = { query: async () => ({ hits: [], truncated: false }) };
    expect(typeof fake.query).toBe("function");
  });
});
