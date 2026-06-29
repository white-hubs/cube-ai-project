import { describe, expect, it } from "bun:test";

import { mcpListTransportParamsFromLfMcpTemplate } from "./lf-mcp-tool-options-enrich";

describe("mcpListTransportParamsFromLfMcpTemplate", () => {
  it("parses stream URL, headers, and timeout seconds", () => {
    const tpl = {
      mcp_server: {
        value: {
          config: {
            headers: {
              "X-Auth": "secret",
            },
            timeout: 50,
            url: "https://mcp.example/sse",
          },
          name: "demo",
        },
      },
    };
    const p = mcpListTransportParamsFromLfMcpTemplate(tpl);
    expect(p).not.toBeNull();
    expect(p!.url).toBe("https://mcp.example/sse");
    expect(p!.headers).toEqual({ "X-Auth": "secret" });
    expect(p!.timeoutMs).toBe(50_000);
  });

  it("returns null without url (stdio / empty)", () => {
    expect(
      mcpListTransportParamsFromLfMcpTemplate({
        mcp_server: { value: { config: { command: "npx" }, name: "s" } },
      }),
    ).toBeNull();
    expect(mcpListTransportParamsFromLfMcpTemplate({})).toBeNull();
  });

  it("uses millisecond timeout when value is large", () => {
    const p = mcpListTransportParamsFromLfMcpTemplate({
      mcp_server: {
        value: {
          config: {
            timeout: 45_000,
            url: "http://localhost/mcp",
          },
        },
      },
    });
    expect(p).not.toBeNull();
    expect(p!.timeoutMs).toBe(45_000);
  });
});
