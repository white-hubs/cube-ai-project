import { describe, expect, it } from "bun:test";

import * as pkg from "./index";

describe("platform-adapters-ghcloud skeleton", () => {
  it("re-exports the four Port tokens (same Symbol identity as contracts)", async () => {
    const contracts = await import("@cube-ai/contracts");
    expect(pkg.AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN).toBe(contracts.AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN);
    expect(pkg.AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN).toBe(contracts.AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN);
    expect(pkg.AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN).toBe(contracts.AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN);
    expect(pkg.AGENTIC_PLATFORM_LLM_CATALOG_TOKEN).toBe(contracts.AGENTIC_PLATFORM_LLM_CATALOG_TOKEN);
  });

  it("exports GhcloudPlatformError with code-based factory", () => {
    expect(typeof pkg.GhcloudPlatformError).toBe("function");
    const err = pkg.GhcloudPlatformError.fromCode("UPSTREAM_TOOL_HTTP_FAILED", "boom");
    expect(err).toBeInstanceOf(pkg.GhcloudPlatformError);
    expect(err.code).toBe("UPSTREAM_TOOL_HTTP_FAILED");
  });
});
