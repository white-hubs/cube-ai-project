import { describe, expect, it } from "bun:test";

import { AUTHORITATIVE_SYSTEM_CATALOG_SEED } from "./system-seed.data";

describe("AUTHORITATIVE_SYSTEM_CATALOG_SEED", () => {
  it("every provider references an existing type_code", () => {
    const types = new Set((AUTHORITATIVE_SYSTEM_CATALOG_SEED.types ?? []).map((t) => t.code));
    for (const p of AUTHORITATIVE_SYSTEM_CATALOG_SEED.providers ?? []) {
      expect(types.has(p.type_code)).toBe(true);
    }
  });

  it("every model references an existing provider id and has endpoint_type", () => {
    const providerIds = new Set((AUTHORITATIVE_SYSTEM_CATALOG_SEED.providers ?? []).map((p) => p.id));
    for (const m of AUTHORITATIVE_SYSTEM_CATALOG_SEED.models ?? []) {
      expect(providerIds.has(m.system_provider_id)).toBe(true);
      expect(typeof m.endpoint_type).toBe("string");
      expect((m.endpoint_type as string).length).toBeGreaterThan(0);
    }
  });

  it("match rules reference known endpoint_type values", () => {
    const known = new Set([
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
    ]);
    for (const r of AUTHORITATIVE_SYSTEM_CATALOG_SEED.matchRules ?? []) {
      expect(known.has(r.endpoint_type as string)).toBe(true);
    }
  });

  it("H4: seeds qwen3-rerank under dashscope with openai_rerank", () => {
    const endpoint = "https://llm-rsqnz4dqml5koq8p.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks";
    const model = (AUTHORITATIVE_SYSTEM_CATALOG_SEED.models ?? []).find((m) => m.model_code === "qwen3-rerank");
    expect(model).toBeDefined();
    expect(model?.api_base_url).toBe(endpoint);
    expect(model?.endpoint_type).toBe("openai_rerank");
    expect(model?.system_provider_id).toBe("900000000000001007");
    expect(model?.model_types).toContain("rerank");

    const exactRule = (AUTHORITATIVE_SYSTEM_CATALOG_SEED.matchRules ?? []).find((r) => r.pattern === "qwen3-rerank");
    expect(exactRule?.api_base_url).toBe(endpoint);
    expect(exactRule?.endpoint_type).toBe("openai_rerank");
    expect(exactRule?.provider_type_code).toBe("dashscope");
  });
});
