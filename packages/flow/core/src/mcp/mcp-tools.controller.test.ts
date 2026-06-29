import { describe, expect, test } from "bun:test";

import { mcpToolsCandidateUrls } from "./mcp-list-tools-sdk";

describe("mcpToolsCandidateUrls", () => {
  test("SSE URL adds streamable HTTP fallbacks on same host", () => {
    const c = mcpToolsCandidateUrls("http://localhost:1234/sse/");
    expect(c[0]).toBe("http://localhost:1234/sse");
    expect(c).toContain("http://localhost:1234/mcp");
    expect(c).toContain("http://localhost:1234");
  });

  test("nested /app/sse strips suffix for base path", () => {
    const c = mcpToolsCandidateUrls("https://x.example/app/sse");
    expect(c[0]).toBe("https://x.example/app/sse");
    expect(c).toContain("https://x.example/app/mcp");
    expect(c).toContain("https://x.example/app");
  });
});
