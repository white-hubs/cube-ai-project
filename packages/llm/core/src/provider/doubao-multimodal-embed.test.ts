import { describe, expect, it } from "bun:test";

import {
  DoubaoMultimodalEmbedProvider,
  buildDoubaoMultimodalEmbedBody,
  mapEmbedResponseData,
  normalizeSparseEmbedding,
  planEmbedBatches,
} from "./doubao-multimodal-embed";
import { LlmProviderError } from "./openai-compat-provider";

describe("DoubaoMultimodalEmbedProvider", () => {
  it("buildDoubaoMultimodalEmbedBody enables multi_embedding and sparse_embedding", () => {
    const body = buildDoubaoMultimodalEmbedBody({
      contexts: [{ retrievalProfile: "semantic-qa" }],
      dimension: 1024,
      input: ["hello"],
      model: "doubao-embedding-vision-251215",
      purpose: "query",
    });
    expect(body.multi_embedding).toEqual({ type: "enabled" });
    expect(body.sparse_embedding).toEqual({ type: "enabled" });
    expect(body.instructions).toContain("检索可回答问题的相关内容");
  });

  it("embed returns dense and sparse (G3)", async () => {
    const provider = new DoubaoMultimodalEmbedProvider({
      apiKey: "sk-test",
      baseURL: "https://ark.example.com/api/v3",
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
      model: "doubao-embedding-vision-251215",
    });
    const res = await provider.embed({
      input: ["query text"],
      modelCode: "doubao-embedding-vision-251215",
      purpose: "query",
      tenant: 1,
    });
    expect(res[0]?.dense).toEqual([0.1, 0.2]);
    expect(res[0]?.sparse).toEqual({ indices: [1, 3], values: [0.9, 0.4] });
  });

  it("normalizeSparseEmbedding returns null for empty arrays", () => {
    expect(normalizeSparseEmbedding([])).toBeNull();
    expect(normalizeSparseEmbedding(undefined)).toBeNull();
  });

  it("W3.2-H1: data[i] / index field aligns with input order", async () => {
    const mapped = mapEmbedResponseData(
      [
        { embedding: [2], index: 1, sparse_embedding: [] },
        { embedding: [1], index: 0, sparse_embedding: [] },
      ],
      2,
    );
    expect(mapped.map((r) => r.dense)).toEqual([[1], [2]]);

    let call = 0;
    const provider = new DoubaoMultimodalEmbedProvider({
      apiKey: "sk-test",
      baseURL: "https://ark.example.com/api/v3",
      embedBatchSize: 2,
      embedConcurrency: 1,
      fetch: (async (_url: string, init?: RequestInit) => {
        call += 1;
        const body = JSON.parse(String(init?.body)) as { input: { text: string }[] };
        expect(body.input.map((x) => x.text)).toEqual(["a", "b"]);
        return Response.json({
          data: [
            { embedding: [20], index: 1 },
            { embedding: [10], index: 0 },
          ],
        });
      }) as unknown as typeof fetch,
      model: "doubao-embedding-vision-251215",
      retryBaseDelayMs: 0,
    });

    const res = await provider.embed({
      input: ["a", "b"],
      modelCode: "doubao-embedding-vision-251215",
      purpose: "document",
      tenant: 1,
    });
    expect(call).toBe(1);
    expect(res.map((r) => r.dense)).toEqual([[10], [20]]);
  });

  it("W3.2-H2: mixed query profiles are never co-batched", async () => {
    const batches = planEmbedBatches(
      {
        contexts: [{ retrievalProfile: "semantic-qa" }, { retrievalProfile: "entity-lookup" }, { retrievalProfile: "semantic-qa" }],
        input: ["q1", "q2", "q3"],
        purpose: "query",
      },
      16,
    );
    expect(batches).toHaveLength(2);
    expect(batches.every((b) => new Set(b.items.map((i) => i.retrievalProfile)).size === 1)).toBe(true);

    const seenProfiles: string[] = [];
    const provider = new DoubaoMultimodalEmbedProvider({
      apiKey: "sk-test",
      baseURL: "https://ark.example.com/api/v3",
      embedBatchSize: 16,
      embedConcurrency: 1,
      fetch: (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          input: { text: string }[];
          instructions: string;
        };
        const profiles = new Set(
          body.input.map(() => {
            if (body.instructions.includes("结构化记录")) return "entity-lookup";
            if (body.instructions.includes("检索可回答问题的相关内容")) return "semantic-qa";
            return "other";
          }),
        );
        expect(profiles.size).toBe(1);
        seenProfiles.push([...profiles][0]!);
        return Response.json({
          data: body.input.map((_, i) => ({ embedding: [i], index: i })),
        });
      }) as unknown as typeof fetch,
      model: "doubao-embedding-vision-251215",
      retryBaseDelayMs: 0,
    });

    const res = await provider.embed({
      contexts: [{ retrievalProfile: "semantic-qa" }, { retrievalProfile: "entity-lookup" }, { retrievalProfile: "semantic-qa" }],
      input: ["q1", "q2", "q3"],
      modelCode: "doubao-embedding-vision-251215",
      purpose: "query",
      tenant: 1,
    });

    expect(seenProfiles.toSorted()).toEqual(["entity-lookup", "semantic-qa"]);
    expect(res).toHaveLength(3);
    expect(res.every((r) => Array.isArray(r.dense))).toBe(true);
  });

  it("W3.2-H3: 429/5xx retries then succeeds", async () => {
    const statuses = [503, 429, 200];
    let attempt = 0;
    const sleeps: number[] = [];
    const provider = new DoubaoMultimodalEmbedProvider({
      apiKey: "sk-test",
      baseURL: "https://ark.example.com/api/v3",
      embedBatchSize: 8,
      embedConcurrency: 1,
      fetch: (async () => {
        const status = statuses[attempt++] ?? 200;
        if (status !== 200) {
          return new Response(`transient ${status}`, { status });
        }
        return Response.json({
          data: [{ embedding: [0.5], index: 0 }],
        });
      }) as unknown as typeof fetch,
      maxRetries: 3,
      model: "doubao-embedding-vision-251215",
      retryBaseDelayMs: 7,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const res = await provider.embed({
      input: ["retry-me"],
      modelCode: "doubao-embedding-vision-251215",
      purpose: "document",
      tenant: 1,
    });
    expect(attempt).toBe(3);
    expect(res[0]?.dense).toEqual([0.5]);
    expect(sleeps).toEqual([7, 14]);
  });

  it("W3.2-H4: document call count equals ceil(N/batchSize)", async () => {
    const batchSize = 8;
    const n = 20;
    let calls = 0;
    const provider = new DoubaoMultimodalEmbedProvider({
      apiKey: "sk-test",
      baseURL: "https://ark.example.com/api/v3",
      embedBatchSize: batchSize,
      embedConcurrency: 2,
      fetch: (async (_url: string, init?: RequestInit) => {
        calls += 1;
        const body = JSON.parse(String(init?.body)) as { input: { text: string }[] };
        return Response.json({
          data: body.input.map((_, i) => ({ embedding: [i], index: i })),
        });
      }) as unknown as typeof fetch,
      model: "doubao-embedding-vision-251215",
      retryBaseDelayMs: 0,
    });

    const input = Array.from({ length: n }, (_, i) => `doc-${i}`);
    const res = await provider.embed({
      input,
      modelCode: "doubao-embedding-vision-251215",
      purpose: "document",
      tenant: 1,
    });
    expect(calls).toBe(Math.ceil(n / batchSize));
    expect(res).toHaveLength(n);
  });

  it("W3.2-H4/H5: unverified endpoints default to concurrent single-input requests", async () => {
    let calls = 0;
    const provider = new DoubaoMultimodalEmbedProvider({
      apiKey: "sk-test",
      baseURL: "https://ark.example.com/api/v3",
      fetch: (async (_url: string, init?: RequestInit) => {
        calls += 1;
        const body = JSON.parse(String(init?.body)) as { input: { text: string }[] };
        expect(body.input).toHaveLength(1);
        return Response.json({ data: [{ embedding: [calls], index: 0 }] });
      }) as unknown as typeof fetch,
      model: "doubao-embedding-vision-251215",
    });

    const result = await provider.embed({
      input: ["a", "b", "c"],
      modelCode: "doubao-embedding-vision-251215",
      purpose: "document",
      tenant: 1,
    });
    expect(calls).toBe(3);
    expect(result).toHaveLength(3);
  });

  it("W3.2-H6: Retry-After is honored and permanent 4xx is not retried", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const retrying = new DoubaoMultimodalEmbedProvider({
      apiKey: "sk-test",
      baseURL: "https://ark.example.com/api/v3",
      fetch: (async () => {
        calls += 1;
        return calls === 1
          ? new Response("rate limited", { headers: { "Retry-After": "2" }, status: 429 })
          : Response.json({ data: [{ embedding: [1], index: 0 }] });
      }) as unknown as typeof fetch,
      maxRetries: 1,
      model: "doubao-embedding-vision-251215",
      retryBaseDelayMs: 7,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await retrying.embed({ input: ["a"], modelCode: "doubao-embedding-vision-251215", tenant: 1 });
    expect(sleeps).toEqual([2000]);

    calls = 0;
    const permanent = new DoubaoMultimodalEmbedProvider({
      apiKey: "sk-test",
      baseURL: "https://ark.example.com/api/v3",
      fetch: (async () => {
        calls += 1;
        return new Response("bad request", { status: 400 });
      }) as unknown as typeof fetch,
      maxRetries: 3,
      model: "doubao-embedding-vision-251215",
      retryBaseDelayMs: 0,
    });
    await expect(permanent.embed({ input: ["a"], modelCode: "doubao-embedding-vision-251215", tenant: 1 })).rejects.toThrow("bad request");
    expect(calls).toBe(1);
  });

  it("W3.2-H6: an already-aborted request performs no HTTP call", async () => {
    let calls = 0;
    const provider = new DoubaoMultimodalEmbedProvider({
      apiKey: "sk-test",
      baseURL: "https://ark.example.com/api/v3",
      fetch: (async () => {
        calls += 1;
        return Response.json({ data: [{ embedding: [1], index: 0 }] });
      }) as unknown as typeof fetch,
      model: "doubao-embedding-vision-251215",
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.embed({ input: ["a"], modelCode: "doubao-embedding-vision-251215", tenant: 1 }, controller.signal),
    ).rejects.toThrow("Aborted");
    expect(calls).toBe(0);
  });

  it("mapEmbedResponseData throws retryable error when a slot is missing", () => {
    expect(() => mapEmbedResponseData([{ embedding: [1], index: 0 }], 2)).toThrow(LlmProviderError);
    try {
      mapEmbedResponseData([{ embedding: [1], index: 0 }], 2);
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProviderError);
      expect((err as LlmProviderError).retryable).toBe(true);
    }
  });
});
