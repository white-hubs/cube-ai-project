import { describe, expect, it, spyOn } from "bun:test";

import { LlmProviderError } from "./openai-compat-provider";
import { OpenAiCompatRerankProvider } from "./openai-compat-rerank-provider";

describe("OpenAiCompatRerankProvider", () => {
  it("H2: maps relevance_score and returns results sorted by score desc", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ body: JSON.parse(String(init?.body)), url });
      return new Response(
        JSON.stringify({
          results: [
            { index: 2, relevance_score: 0.2 },
            { index: 0, relevance_score: 0.9 },
            { index: 1, relevance_score: 0.5 },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const endpoint = "https://llm-rsqnz4dqml5koq8p.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks";
    const provider = new OpenAiCompatRerankProvider({
      apiBaseUrl: endpoint,
      apiKey: "sk-test",
      fetchImpl,
      modelCode: "qwen3-rerank",
    });

    const out = await provider.rerank({
      documents: ["doc0", "doc1", "doc2"],
      modelCode: "qwen3-rerank",
      query: "ranking query",
      tenant: 1,
      topN: 2,
    });

    expect(calls[0]?.url).toBe(endpoint);
    expect(calls[0]?.body).toEqual({
      documents: ["doc0", "doc1", "doc2"],
      model: "qwen3-rerank",
      query: "ranking query",
      top_n: 2,
    });
    expect(out.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(out.map((r) => r.relevanceScore)).toEqual([0.9, 0.5, 0.2]);
  });

  it("posts to the complete catalog endpoint without inferring or appending a path", async () => {
    const calls: string[] = [];
    const endpoint = "https://llm-rsqnz4dqml5koq8p.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks";
    const provider = new OpenAiCompatRerankProvider({
      apiBaseUrl: endpoint,
      apiKey: "sk-test",
      fetchImpl: (async (input: string | URL | Request) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ results: [{ index: 0, relevance_score: 0.9 }] }), { status: 200 });
      }) as unknown as typeof fetch,
      modelCode: "qwen3-rerank",
    });

    await provider.rerank({
      documents: ["doc0"],
      modelCode: "qwen3-rerank",
      query: "ranking query",
      tenant: 1,
    });

    expect(calls).toEqual([endpoint]);
  });

  it("emits model and endpoint-host audit logs without query, documents, or credentials", async () => {
    const logLines: string[] = [];
    const infoSpy = spyOn(console, "info").mockImplementation((message) => logLines.push(String(message)));
    const provider = new OpenAiCompatRerankProvider({
      apiBaseUrl: "https://llm-rsqnz4dqml5koq8p.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks",
      apiKey: "secret-api-key",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ results: [{ index: 0, relevance_score: 0.91 }] }), {
          status: 200,
        })) as unknown as typeof fetch,
      modelCode: "qwen3-rerank",
    });

    try {
      await provider.rerank({
        documents: ["sensitive document content"],
        modelCode: "qwen3-rerank",
        query: "sensitive query content",
        tenant: 1,
        topN: 1,
      });
    } finally {
      infoSpy.mockRestore();
    }

    const events = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual([
      expect.objectContaining({
        documentCount: 1,
        endpointHost: "llm-rsqnz4dqml5koq8p.cn-beijing.maas.aliyuncs.com",
        event: "started",
        modelCode: "qwen3-rerank",
        ns: "llm.provider.rerank-http",
      }),
      expect.objectContaining({
        endpointHost: "llm-rsqnz4dqml5koq8p.cn-beijing.maas.aliyuncs.com",
        event: "succeeded",
        modelCode: "qwen3-rerank",
        resultCount: 1,
        upstreamStatus: 200,
      }),
    ]);
    expect(logLines.join("\n")).not.toContain("sensitive query content");
    expect(logLines.join("\n")).not.toContain("sensitive document content");
    expect(logLines.join("\n")).not.toContain("secret-api-key");
  });

  it("H3: maps 401 to UPSTREAM_LLM_AUTH_FAILED", async () => {
    const fetchImpl = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    const provider = new OpenAiCompatRerankProvider({
      apiBaseUrl: "https://example.com/v1",
      apiKey: "bad",
      fetchImpl,
      modelCode: "qwen3-rerank",
    });

    try {
      await provider.rerank({ documents: ["a"], modelCode: "qwen3-rerank", query: "q", tenant: 1 });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProviderError);
      expect((err as LlmProviderError).code).toBe("UPSTREAM_LLM_AUTH_FAILED");
    }
  });

  it("H3: maps 429 / 5xx / fetch failure to stable retryable codes", async () => {
    const rateLimited = new OpenAiCompatRerankProvider({
      apiBaseUrl: "https://example.com/v1",
      apiKey: "sk",
      fetchImpl: (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch,
      modelCode: "qwen3-rerank",
    });
    try {
      await rateLimited.rerank({ documents: ["a"], modelCode: "qwen3-rerank", query: "q", tenant: 1 });
      expect.unreachable();
    } catch (err) {
      expect((err as LlmProviderError).code).toBe("UPSTREAM_LLM_RATE_LIMITED");
      expect((err as LlmProviderError).retryable).toBe(true);
    }

    const unavailable = new OpenAiCompatRerankProvider({
      apiBaseUrl: "https://example.com/v1",
      apiKey: "sk",
      fetchImpl: (async () => new Response("boom", { status: 503 })) as unknown as typeof fetch,
      modelCode: "qwen3-rerank",
    });
    try {
      await unavailable.rerank({ documents: ["a"], modelCode: "qwen3-rerank", query: "q", tenant: 1 });
      expect.unreachable();
    } catch (err) {
      expect((err as LlmProviderError).code).toBe("UPSTREAM_LLM_UNAVAILABLE");
      expect((err as LlmProviderError).retryable).toBe(true);
    }

    const network = new OpenAiCompatRerankProvider({
      apiBaseUrl: "https://example.com/v1",
      apiKey: "sk",
      fetchImpl: (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
      modelCode: "qwen3-rerank",
    });
    try {
      await network.rerank({ documents: ["a"], modelCode: "qwen3-rerank", query: "q", tenant: 1 });
      expect.unreachable();
    } catch (err) {
      expect((err as LlmProviderError).code).toBe("UPSTREAM_LLM_UNAVAILABLE");
      expect((err as LlmProviderError).retryable).toBe(true);
    }
  });

  it("H3: missing apiKey uses UPSTREAM_LLM_AUTH_FAILED", async () => {
    const provider = new OpenAiCompatRerankProvider({
      apiBaseUrl: "https://example.com/v1",
      apiKey: "",
      modelCode: "qwen3-rerank",
    });
    try {
      await provider.rerank({ documents: ["a"], modelCode: "qwen3-rerank", query: "q", tenant: 1 });
      expect.unreachable();
    } catch (err) {
      expect((err as LlmProviderError).code).toBe("UPSTREAM_LLM_AUTH_FAILED");
    }
  });

  it("enforces timeoutMs and returns a retryable stable error", async () => {
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })) as unknown as typeof fetch;
    const provider = new OpenAiCompatRerankProvider({
      apiBaseUrl: "https://example.com/v1",
      apiKey: "sk",
      fetchImpl,
      modelCode: "qwen3-rerank",
      timeoutMs: 5,
    });

    try {
      await provider.rerank({ documents: ["a"], modelCode: "qwen3-rerank", query: "q", tenant: 1 });
      expect.unreachable();
    } catch (err) {
      expect((err as LlmProviderError).code).toBe("UPSTREAM_LLM_UNAVAILABLE");
      expect((err as LlmProviderError).retryable).toBe(true);
      expect((err as LlmProviderError).message).toContain("timed out after 5ms");
    }
  });

  it("forwards caller cancellation through the combined signal", async () => {
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })) as unknown as typeof fetch;
    const provider = new OpenAiCompatRerankProvider({
      apiBaseUrl: "https://example.com/v1",
      apiKey: "sk",
      fetchImpl,
      modelCode: "qwen3-rerank",
      timeoutMs: 60_000,
    });
    const controller = new AbortController();
    const pending = provider.rerank({ documents: ["a"], modelCode: "qwen3-rerank", query: "q", tenant: 1 }, controller.signal);
    controller.abort(new Error("caller cancelled"));

    try {
      await pending;
      expect.unreachable();
    } catch (err) {
      expect((err as LlmProviderError).code).toBe("UPSTREAM_LLM_UNAVAILABLE");
      expect((err as LlmProviderError).message).toContain("caller cancelled");
      expect((err as LlmProviderError).message).not.toContain("timed out");
    }
  });
});
