import { describe, expect, it } from "bun:test";

import { GhcloudLlmCatalogAdapter } from "./catalog.adapter";

function mockFetch(handler: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const fn = async (input: Request | URL | string, init?: RequestInit) => {
    const r = input instanceof Request ? input : new Request(String(input), init);
    calls.push(r);
    return handler(r);
  };
  return { calls, fn: fn as unknown as typeof fetch };
}

describe("GhcloudLlmCatalogAdapter", () => {
  it("listProviders calls GET /ai/llm/providers", async () => {
    const m = mockFetch(() =>
      Response.json(
        [
          {
            apiBaseUrl: "https://api.openai.com",
            enabled: true,
            id: "p1",
            providerCode: "openai",
            typeCode: "openai",
          },
          {
            apiBaseUrl: "https://qwen.example",
            enabled: false,
            id: "p2",
            providerCode: "qwen",
            typeCode: "openai",
          },
        ],
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const adapter = new GhcloudLlmCatalogAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => "t",
    });
    const out = await adapter.listProviders(1, new AbortController().signal);
    expect(m.calls[0]!.method).toBe("GET");
    expect(m.calls[0]!.url).toBe("http://aias.test/ai/llm/providers");
    expect(m.calls[0]!.headers.get("tenant")).toBe("1");
    expect(m.calls[0]!.headers.get("terminal")).toBe("bimops-manage-web");
    expect(out.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(out.map((p) => p.providerCode)).toEqual(["openai", "qwen"]);
  });

  it("listProviders preserves null apiBaseUrl for unconfigured providers", async () => {
    const m = mockFetch(() =>
      Response.json(
        [
          {
            apiBaseUrl: null,
            enabled: true,
            id: "p1",
            providerCode: "kaihe",
            typeCode: "openai",
          },
        ],
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const adapter = new GhcloudLlmCatalogAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => "t",
    });
    const out = await adapter.listProviders(1, new AbortController().signal);
    expect(out).toHaveLength(1);
    expect(out[0]!.apiBaseUrl).toBeNull();
  });

  it("listProviders keeps vendor typeCode (geekai) without protocol enum validation", async () => {
    const m = mockFetch(() =>
      Response.json(
        [
          {
            apiBaseUrl: "https://geekai.co/api/v1",
            enabled: true,
            id: "p-geekai",
            providerCode: "geekai",
            typeCode: "geekai",
          },
          {
            apiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
            enabled: true,
            id: "p-ark",
            providerCode: "volcengine-ark",
            typeCode: "volcengine_ark",
          },
        ],
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const adapter = new GhcloudLlmCatalogAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => "t",
    });
    const out = await adapter.listProviders(1, new AbortController().signal);
    expect(out.map((p) => p.typeCode)).toEqual(["geekai", "volcengine_ark"]);
  });

  it("listProviders reads baseUrl when apiBaseUrl missing", async () => {
    const m = mockFetch(() =>
      Response.json(
        [
          {
            baseUrl: "https://upstream.example/v1",
            enabled: true,
            id: "p1",
            providerCode: "x",
            typeCode: "openai",
          },
        ],
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const adapter = new GhcloudLlmCatalogAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => "t",
    });
    const out = await adapter.listProviders(1, new AbortController().signal);
    expect(out[0]!.apiBaseUrl).toBe("https://upstream.example/v1");
  });

  it("resolveModelRuntime hits GET .../providers/:id/models/:modelCode/runtime-config and caches", async () => {
    const runtimePayload = {
      apiBaseUrl: "https://api.openai.com",
      apiKey: "sk-xxx",
      displayName: "GPT-4o",
      endpointType: "openai",
      isFree: false,
      modelCode: "gpt-4o",
      modelTypes: ["reasoning"],
      providerCode: "openai",
    };
    const m = mockFetch((req) => {
      const path = new URL(req.url).pathname;
      if (path === "/ai/llm/providers") {
        return Response.json(
          [
            {
              apiBaseUrl: "https://api.openai.com",
              enabled: true,
              id: "p1",
              providerCode: "openai",
              typeCode: "openai",
            },
          ],
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      if (path === "/ai/llm/providers/p1/models/gpt-4o/runtime-config") {
        return Response.json(runtimePayload, {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const adapter = new GhcloudLlmCatalogAdapter({
      baseUrl: "http://aias.test",
      cacheTtlMs: 60_000,
      fetchImpl: m.fn,
      tokenProvider: async () => "t",
    });
    const r1 = await adapter.resolveModelRuntime(1, "gpt-4o", new AbortController().signal);
    const r2 = await adapter.resolveModelRuntime(1, "gpt-4o", new AbortController().signal);
    expect(r1?.apiKey).toBe("sk-xxx");
    expect(r2).toEqual(r1);
    expect(m.calls).toHaveLength(2);
  });

  it("resolveModelRuntime tries next enabled provider after RESOURCE_NOT_FOUND_REMOTE (404)", async () => {
    const runtimePayload = {
      apiBaseUrl: "https://api.openai.com",
      apiKey: "sk-second",
      displayName: "GPT-4o",
      endpointType: "openai",
      isFree: false,
      modelCode: "gpt-4o",
      modelTypes: [],
      providerCode: "qwen",
    };
    const m = mockFetch((req) => {
      const path = new URL(req.url).pathname;
      if (path === "/ai/llm/providers") {
        return Response.json(
          [
            {
              apiBaseUrl: "https://api.openai.com",
              enabled: true,
              id: "p-first",
              providerCode: "openai",
              typeCode: "openai",
            },
            {
              apiBaseUrl: "https://qwen.example",
              enabled: true,
              id: "p-second",
              providerCode: "qwen",
              typeCode: "openai",
            },
          ],
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      if (path === "/ai/llm/providers/p-first/models/gpt-4o/runtime-config") {
        return new Response("not found", { status: 404 });
      }
      if (path === "/ai/llm/providers/p-second/models/gpt-4o/runtime-config") {
        return Response.json(runtimePayload, {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const adapter = new GhcloudLlmCatalogAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => "t",
    });
    const r = await adapter.resolveModelRuntime(1, "gpt-4o", new AbortController().signal);
    expect(r?.apiKey).toBe("sk-second");
    expect(m.calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/ai/llm/providers",
      "/ai/llm/providers/p-first/models/gpt-4o/runtime-config",
      "/ai/llm/providers/p-second/models/gpt-4o/runtime-config",
    ]);
  });

  it("resolveModelRuntime returns null on remote 404 (not throw)", async () => {
    const m = mockFetch((req) => {
      const path = new URL(req.url).pathname;
      if (path === "/ai/llm/providers") {
        return Response.json(
          [
            {
              apiBaseUrl: "https://api.openai.com",
              enabled: true,
              id: "p1",
              providerCode: "openai",
              typeCode: "openai",
            },
          ],
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });
    const adapter = new GhcloudLlmCatalogAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => "t",
    });
    const r = await adapter.resolveModelRuntime(1, "unknown", new AbortController().signal);
    expect(r).toBeNull();
  });

  it("different tenants do NOT share cache slots", async () => {
    let n = 0;
    const m = mockFetch((req) => {
      const path = new URL(req.url).pathname;
      if (path === "/ai/llm/providers") {
        return Response.json(
          [
            {
              apiBaseUrl: "https://api.openai.com",
              enabled: true,
              id: "p1",
              providerCode: "openai",
              typeCode: "openai",
            },
          ],
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      if (path.endsWith("/models/gpt-4o/runtime-config")) {
        return Response.json(
          {
            apiBaseUrl: "https://api.openai.com",
            apiKey: "k",
            displayName: `t${++n}`,
            endpointType: "openai",
            isFree: false,
            modelCode: "gpt-4o",
            modelTypes: [],
            providerCode: "openai",
          },
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      return new Response("unexpected", { status: 500 });
    });
    const adapter = new GhcloudLlmCatalogAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => "t",
    });
    const a = await adapter.resolveModelRuntime(1, "gpt-4o", new AbortController().signal);
    const b = await adapter.resolveModelRuntime(2, "gpt-4o", new AbortController().signal);
    expect(a?.displayName).not.toBe(b?.displayName);
    expect(m.calls).toHaveLength(4);
  });
});
