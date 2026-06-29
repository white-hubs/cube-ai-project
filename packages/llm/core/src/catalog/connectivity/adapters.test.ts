import { describe, expect, it } from "bun:test";

import { OpenAiCompatibleConnectivityAdapter, createDefaultConnectivityAdapters } from "./adapters";

describe("OpenAiCompatibleConnectivityAdapter", () => {
  it("testConnection uses fetch stub", async () => {
    const adapter = new OpenAiCompatibleConnectivityAdapter((async () =>
      Response.json({ data: [{ id: "gpt-4o" }] })) as unknown as typeof fetch);
    const result = await adapter.testConnection("https://api.example.com/v1", "sk-test");
    expect(result.ok).toBe(true);
  });

  it("fetchModels maps remote model ids", async () => {
    const adapter = new OpenAiCompatibleConnectivityAdapter((async () =>
      Response.json({ data: [{ id: "gpt-4o-mini" }] })) as unknown as typeof fetch);
    const models = await adapter.fetchModels?.("https://api.example.com/v1", "sk-test");
    expect(models).toEqual([{ displayName: "gpt-4o-mini", modelCode: "gpt-4o-mini" }]);
  });

  it("returns ok:false when upstream rejects credentials", async () => {
    const adapter = new OpenAiCompatibleConnectivityAdapter((async () => new Response(null, { status: 401 })) as unknown as typeof fetch);
    const result = await adapter.testConnection("https://api.example.com/v1", "invalid-key");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
  });
});

describe("createDefaultConnectivityAdapters", () => {
  const failingFetch = (async () => new Response(null, { status: 401 })) as unknown as typeof fetch;

  for (const endpointType of ["anthropic", "gemini", "azure_openai", "ollama", "dashscope"] as const) {
    it(`${endpointType} returns ok:false on HTTP 401 (not fake success)`, async () => {
      const adapter = createDefaultConnectivityAdapters(failingFetch).find((a) => a.endpointType === endpointType);
      expect(adapter).toBeDefined();
      const result = await adapter!.testConnection("https://api.example.com/v1", "invalid-key");
      expect(result.ok).toBe(false);
      expect(result.message).toContain("401");
    });
  }
});
