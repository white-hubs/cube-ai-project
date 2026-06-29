import { describe, expect, it } from "bun:test";

import { GhcloudPlatformError } from "../errors";
import { GhcloudKnowledgeQueryAdapter } from "./knowledge.adapter";

function mockFetch(handler: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = input instanceof Request ? input : new Request(String(input), init);
    calls.push(r);
    return handler(r);
  };
  return { calls, fn: fn as unknown as typeof fetch };
}

describe("GhcloudKnowledgeQueryAdapter", () => {
  it("POSTs to /ai/knowledge/query with the full request body", async () => {
    const m = mockFetch(() =>
      Response.json(
        {
          hits: [{ docId: "d1", kbId: "kb1", link: "https://x", score: 0.9, snippet: "hello", title: "T" }],
          truncated: false,
        },
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const adapter = new GhcloudKnowledgeQueryAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => "svc",
    });

    const resp = await adapter.query(
      {
        kbIds: ["kb1", "kb2"],
        query: "how to reset password",
        scoreThreshold: 0.7,
        tenant: 1,
        topK: 3,
        traceId: "trace-2",
      },
      new AbortController().signal,
    );

    expect(m.calls).toHaveLength(1);
    const r = m.calls[0]!;
    expect(r.method).toBe("POST");
    expect(r.url).toBe("http://aias.test/ai/knowledge/query");
    expect(r.headers.get("authorization")).toBe("Bearer svc");
    expect(r.headers.get("tenant")).toBe("1");
    expect(r.headers.get("terminal")).toBe("bimops-manage-web");
    expect(r.headers.get("x-trace-id")).toBe("trace-2");
    const body = await r.json();
    expect(body).toEqual({
      kbIds: ["kb1", "kb2"],
      query: "how to reset password",
      scoreThreshold: 0.7,
      topK: 3,
    });
    expect(resp.hits).toHaveLength(1);
    expect(resp.hits[0]!.score).toBe(0.9);
  });

  it("omits kbIds from body when undefined", async () => {
    const m = mockFetch(() =>
      Response.json(
        { hits: [], truncated: false },
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    const adapter = new GhcloudKnowledgeQueryAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => "svc",
    });
    await adapter.query({ query: "hi", scoreThreshold: 0.6, tenant: 1, topK: 5, traceId: "t" }, new AbortController().signal);
    const sent = await m.calls[0]!.json();
    expect(Object.hasOwn(sent, "kbIds")).toBe(false);
  });

  it("maps 4xx to RESOURCE_NOT_FOUND_REMOTE on 404", async () => {
    const m = mockFetch(() => new Response("not found", { status: 404 }));
    const adapter = new GhcloudKnowledgeQueryAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => "t",
    });
    let caught: unknown;
    try {
      await adapter.query({ query: "hi", scoreThreshold: 0.6, tenant: 1, topK: 5, traceId: "t" }, new AbortController().signal);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GhcloudPlatformError);
    expect((caught as GhcloudPlatformError).code).toBe("RESOURCE_NOT_FOUND_REMOTE");
  });
});
