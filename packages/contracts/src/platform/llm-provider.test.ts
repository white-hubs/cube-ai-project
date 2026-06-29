import { describe, expect, it } from "bun:test";

import {
  LlmChatRequestSchema,
  LlmChatResponseSchema,
  LlmEmbedRequestSchema,
  LlmEmbedResultSchema,
  type LlmProviderPort,
  LlmSparseVectorSchema,
  LlmStreamChunkSchema,
} from "./llm-provider";

describe("LlmProviderPort contracts", () => {
  it("LlmChatRequestSchema requires tenant and modelCode", () => {
    expect(() =>
      LlmChatRequestSchema.parse({
        messages: [{ role: "user", content: "hi" }],
        modelCode: "gpt-4o",
        tenant: 1,
      }),
    ).not.toThrow();

    expect(() =>
      LlmChatRequestSchema.parse({
        messages: [],
        modelCode: "gpt-4o",
        tenant: 1,
      }),
    ).toThrow();
  });

  it("LlmChatResponseSchema accepts content and usage", () => {
    const ok = LlmChatResponseSchema.parse({
      content: "hello",
      finishReason: "stop",
      usage: { completionTokens: 2, promptTokens: 1, totalTokens: 3 },
    });
    expect(ok.content).toBe("hello");
  });

  it("LlmStreamChunkSchema accepts text-delta and finish", () => {
    expect(LlmStreamChunkSchema.parse({ delta: "x", type: "text-delta" })).toEqual({
      delta: "x",
      type: "text-delta",
    });
    expect(
      LlmStreamChunkSchema.parse({
        finishReason: "stop",
        type: "finish",
        usage: { completionTokens: 1, promptTokens: 1, totalTokens: 2 },
      }).type,
    ).toBe("finish");
  });

  it("LlmEmbedResultSchema enforces G3 dense + optional sparse", () => {
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

  it("LlmEmbedRequestSchema accepts purpose and retrievalProfile context", () => {
    const ok = LlmEmbedRequestSchema.parse({
      contexts: [{ retrievalProfile: "semantic-qa" }],
      input: ["query text"],
      modelCode: "doubao-embedding-vision-251215",
      purpose: "query",
      tenant: 42,
    });
    expect(ok.purpose).toBe("query");
  });

  it("LlmProviderPort type compiles for chat/stream/embed", () => {
    const fake: LlmProviderPort = {
      chat: async () => ({ content: "ok", finishReason: "stop" }),
      async *chatStream() {
        yield { type: "finish", finishReason: "stop" };
      },
      embed: async () => [{ dense: [1] }],
    };
    expect(typeof fake.chat).toBe("function");
    expect(typeof fake.chatStream).toBe("function");
    expect(typeof fake.embed).toBe("function");
  });
});
