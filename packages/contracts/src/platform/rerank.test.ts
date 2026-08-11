import { describe, expect, it } from "bun:test";

import { AGENTIC_PLATFORM_RERANK_TOKEN, RerankRequestSchema, RerankResultItemSchema } from "./rerank";

describe("RerankPort contracts", () => {
  it("parses a minimal rerank request", () => {
    const r = RerankRequestSchema.parse({
      documents: ["a", "b"],
      modelCode: "qwen3-rerank",
      query: "what is rerank",
      tenant: 1,
    });
    expect(r.modelCode).toBe("qwen3-rerank");
    expect(r.documents).toHaveLength(2);
    expect(r.topN).toBeUndefined();
  });

  it("allows optional topN", () => {
    const r = RerankRequestSchema.parse({
      documents: ["only"],
      modelCode: "qwen3-rerank",
      query: "q",
      tenant: 2,
      topN: 5,
    });
    expect(r.topN).toBe(5);
  });

  it("rejects empty documents / query / modelCode", () => {
    expect(() => RerankRequestSchema.parse({ documents: [], modelCode: "x", query: "q", tenant: 1 })).toThrow();
    expect(() => RerankRequestSchema.parse({ documents: ["a"], modelCode: "", query: "q", tenant: 1 })).toThrow();
    expect(() => RerankRequestSchema.parse({ documents: ["a"], modelCode: "x", query: "", tenant: 1 })).toThrow();
  });

  it("parses result items with camelCase relevanceScore (no vendor field names)", () => {
    const item = RerankResultItemSchema.parse({ index: 0, relevanceScore: 0.91 });
    expect(item.index).toBe(0);
    expect(item.relevanceScore).toBe(0.91);
    expect(() => RerankResultItemSchema.parse({ index: 0, relevance_score: 0.91 })).toThrow();
  });

  it("exports DI token under agentic.* namespace", () => {
    expect(typeof AGENTIC_PLATFORM_RERANK_TOKEN).toBe("symbol");
    expect(AGENTIC_PLATFORM_RERANK_TOKEN.description).toBe("agentic.adapter.platform.rerank");
  });
});
