import { describe, expect, it } from "bun:test";

import { type LlmCatalogPort, type LlmModelRuntimeConfig } from "@cube-ai/contracts";

import { CatalogDrivenProvider, createInnerProviderFromCatalogRuntimeConfig } from "./catalog-driven-provider";

describe("CatalogDrivenProvider", () => {
  it("resolves catalog runtime and delegates chat to inner openai-compat provider", async () => {
    const runtime: LlmModelRuntimeConfig = {
      apiBaseUrl: "https://api.example.com/v1",
      apiKey: "sk-catalog",
      displayName: "GPT-4o",
      endpointType: "openai",
      isFree: false,
      modelCode: "gpt-4o",
      modelTypes: ["chat"],
      providerCode: "openai-official",
    };
    const catalog: LlmCatalogPort = {
      listProviders: async () => [],
      resolveModelRuntime: async () => runtime,
    };

    const provider = new CatalogDrivenProvider({
      catalog,
      providerFactory: (cfg) => ({
        chat: async () => ({
          content: `ok:${cfg.apiKey}`,
          finishReason: "stop",
        }),
        chatStream: async function* () {
          yield { type: "finish", finishReason: "stop" };
        },
        embed: async () => [{ dense: [1] }],
        id: "mock",
      }),
    });

    const res = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
      modelCode: "gpt-4o",
      tenant: 1,
    });
    expect(res.content).toBe("ok:sk-catalog");
  });

  it("uses legacy key fallback when catalog misses (M1.T8 soft transition)", async () => {
    const fallbackEvents: { tenant: number; modelCode: string }[] = [];
    const catalog: LlmCatalogPort = {
      listProviders: async () => [],
      resolveModelRuntime: async () => null,
    };
    const provider = new CatalogDrivenProvider({
      catalog,
      onLegacyKeyFallback: (event) => fallbackEvents.push(event),
      providerFactory: (cfg) => ({
        chat: async () => ({ content: cfg.apiKey, finishReason: "stop" }),
        chatStream: async function* () {
          yield { type: "finish", finishReason: "stop" };
        },
        embed: async () => [{ dense: [0.5] }],
        id: "legacy",
      }),
    });

    const res = await provider.chat({
      legacyApiKey: "sk-inline",
      messages: [{ role: "user", content: "x" }],
      modelCode: "legacy-model",
      tenant: 9,
    });
    expect(res.content).toBe("sk-inline");
    expect(fallbackEvents).toEqual([{ modelCode: "legacy-model", tenant: 9 }]);
  });

  it("createInnerProviderFromCatalogRuntimeConfig routes volcengine embedding to doubao multimodal", () => {
    const inner = createInnerProviderFromCatalogRuntimeConfig({
      apiBaseUrl: "https://ark.example.com/api/v3",
      apiKey: "sk-volc",
      displayName: "Doubao",
      endpointType: "volcengine_ark",
      isFree: false,
      modelCode: "doubao-embedding-vision-251215",
      modelTypes: ["embedding", "multimodal"],
      providerCode: "volc-doubao",
    });
    expect(inner.id).toBe("doubao-multimodal-embed");
  });
});
