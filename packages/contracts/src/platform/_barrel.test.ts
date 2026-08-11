import { describe, expect, it } from "bun:test";

import * as root from "../index";

describe("contracts root barrel re-exports platform/*", () => {
  it("exports the platform Port tokens", () => {
    expect(typeof root.AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN).toBe("symbol");
    expect(typeof root.AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN).toBe("symbol");
    expect(typeof root.AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN).toBe("symbol");
    expect(typeof root.AGENTIC_PLATFORM_LLM_CATALOG_TOKEN).toBe("symbol");
    expect(typeof root.AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN).toBe("symbol");
    expect(typeof root.AGENTIC_PLATFORM_RERANK_TOKEN).toBe("symbol");
    expect(typeof root.AGENTIC_PLATFORM_IMAGE_GENERATION_TOKEN).toBe("symbol");
  });

  it("exports the platform Request schemas", () => {
    expect(typeof root.FlowInvokeRequestSchema.parse).toBe("function");
    expect(typeof root.FlowCatalogListRequestSchema.parse).toBe("function");
    expect(typeof root.KnowledgeQueryRequestSchema.parse).toBe("function");
    expect(typeof root.LlmModelRuntimeConfigSchema.parse).toBe("function");
    expect(typeof root.LlmChatRequestSchema.parse).toBe("function");
    expect(typeof root.LlmEmbedRequestSchema.parse).toBe("function");
  });
});
