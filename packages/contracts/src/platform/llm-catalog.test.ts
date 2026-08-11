import { describe, expect, it } from "bun:test";

import { type LlmCatalogPort, LlmEndpointTypeSchema, LlmModelRuntimeConfigSchema, LlmProviderSummarySchema } from "./llm-catalog";

describe("LlmCatalogPort contracts", () => {
  it("LlmEndpointTypeSchema enumerates exactly the 14 supported codes", () => {
    const expected = [
      "openai",
      "openai_response",
      "anthropic",
      "gemini",
      "azure_openai",
      "new_api",
      "openai_image",
      "jina_rerank",
      "openai_rerank",
      "ollama",
      "geekai",
      "dashscope",
      "dashscope_text2image",
      "volcengine_ark",
    ] as const;
    for (const code of expected) {
      expect(LlmEndpointTypeSchema.parse(code)).toBe(code);
    }
    expect(() => LlmEndpointTypeSchema.parse("unknown")).toThrow();
  });

  it("LlmProviderSummarySchema accepts vendor typeCode (not protocol endpointType)", () => {
    const ok = LlmProviderSummarySchema.parse({
      apiBaseUrl: "https://geekai.co/api/v1",
      enabled: true,
      id: "prov-sfid-001",
      providerCode: "geekai",
      typeCode: "geekai",
    });
    expect(ok.id).toBe("prov-sfid-001");
    expect(ok.typeCode).toBe("geekai");
    expect(ok.enabled).toBe(true);
  });

  it("LlmProviderSummarySchema accepts unconfigured provider apiBaseUrl null", () => {
    const ok = LlmProviderSummarySchema.parse({
      apiBaseUrl: null,
      enabled: false,
      id: "prov-sfid-002",
      providerCode: "dashscope",
      typeCode: "dashscope",
    });
    expect(ok.apiBaseUrl).toBeNull();
  });

  it("LlmModelRuntimeConfigSchema requires apiKey and modelCode", () => {
    expect(() =>
      LlmModelRuntimeConfigSchema.parse({
        modelCode: "gpt-4o",
        displayName: "GPT-4o",
        endpointType: "openai",
        apiBaseUrl: "https://api.openai.com",
        // apiKey missing
        providerCode: "openai-tenant1",
      }),
    ).toThrow();

    const ok = LlmModelRuntimeConfigSchema.parse({
      apiBaseUrl: "https://api.openai.com",
      apiKey: "sk-xxx",
      displayName: "GPT-4o",
      endpointType: "openai",
      modelCode: "gpt-4o",
      providerCode: "openai-tenant1",
    });
    expect(ok.modelTypes).toEqual([]);
    expect(ok.isFree).toBe(false);
  });

  it("LlmCatalogPort type compiles for both methods", () => {
    const fake: LlmCatalogPort = {
      listProviders: async () => [],
      resolveModelRuntime: async () => null,
    };
    expect(typeof fake.listProviders).toBe("function");
    expect(typeof fake.resolveModelRuntime).toBe("function");
  });
});
