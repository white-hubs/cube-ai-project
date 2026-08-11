import { describe, expect, it } from "bun:test";

import { type LlmCatalogPort, type LlmModelRuntimeConfig } from "@cube-ai/contracts";

import { CatalogRerankProvider, createRerankProviderFromRuntimeConfig } from "./catalog-rerank-provider";
import { LlmProviderError } from "./openai-compat-provider";

function runtime(
  partial: Partial<LlmModelRuntimeConfig> & Pick<LlmModelRuntimeConfig, "endpointType" | "modelCode">,
): LlmModelRuntimeConfig {
  return {
    apiBaseUrl: partial.apiBaseUrl ?? "https://llm-rsqnz4dqml5koq8p.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks",
    apiKey: partial.apiKey ?? "sk-ds",
    displayName: partial.displayName ?? partial.modelCode,
    endpointType: partial.endpointType,
    isFree: partial.isFree ?? false,
    modelCode: partial.modelCode,
    modelTypes: partial.modelTypes ?? ["rerank"],
    providerCode: partial.providerCode ?? "aliyun-bailian",
  };
}

describe("createRerankProviderFromRuntimeConfig", () => {
  it("H1: openai_rerank creates provider without throwing", () => {
    const p = createRerankProviderFromRuntimeConfig(runtime({ endpointType: "openai_rerank", modelCode: "qwen3-rerank" }));
    expect(p.id).toBe("openai-compat-rerank");
  });

  it("keeps jina_rerank unsupported with stable code", () => {
    try {
      createRerankProviderFromRuntimeConfig(runtime({ endpointType: "jina_rerank", modelCode: "jina-reranker" }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProviderError);
      expect((err as LlmProviderError).code).toBe("UPSTREAM_LLM_UNAVAILABLE");
      expect((err as LlmProviderError).message).toContain("jina_rerank");
    }
  });

  it("rejects qwen3-vl-rerank on the text OpenAI-compatible protocol", () => {
    try {
      createRerankProviderFromRuntimeConfig(runtime({ endpointType: "openai_rerank", modelCode: "qwen3-vl-rerank" }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProviderError);
      expect((err as LlmProviderError).code).toBe("UPSTREAM_LLM_UNAVAILABLE");
      expect((err as LlmProviderError).message).toContain("native DashScope text-rerank protocol");
    }
  });
});

describe("CatalogRerankProvider", () => {
  it("H4: resolves qwen3-rerank via catalog and delegates rerank", async () => {
    const cfg = runtime({ endpointType: "openai_rerank", modelCode: "qwen3-rerank" });
    const catalog: LlmCatalogPort = {
      listProviders: async () => [],
      resolveModelRuntime: async (_t, modelCode) => (modelCode === "qwen3-rerank" ? cfg : null),
    };

    const provider = new CatalogRerankProvider({
      catalog,
      providerFactory: () => ({
        id: "mock",
        rerank: async () => [{ index: 1, relevanceScore: 0.8 }],
      }),
    });

    const out = await provider.rerank({
      documents: ["a", "b"],
      modelCode: "qwen3-rerank",
      query: "q",
      tenant: 7,
    });
    expect(out).toEqual([{ index: 1, relevanceScore: 0.8 }]);
  });

  it("H3: missing catalog entry uses UPSTREAM_LLM_UNAVAILABLE", async () => {
    const catalog: LlmCatalogPort = {
      listProviders: async () => [],
      resolveModelRuntime: async () => null,
    };
    const provider = new CatalogRerankProvider({ catalog });
    try {
      await provider.rerank({ documents: ["a"], modelCode: "missing", query: "q", tenant: 1 });
      expect.unreachable();
    } catch (err) {
      expect((err as LlmProviderError).code).toBe("UPSTREAM_LLM_UNAVAILABLE");
      expect((err as LlmProviderError).message).toContain("no catalog entry");
    }
  });
});
