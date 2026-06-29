import { describe, expect, test } from "bun:test";

import { createAgenticClient } from "@cube-ai/agent-sdk-client";

import { DEFAULT_CONNECTION_PROFILE } from "./connection-profile";
import { invokeCapability } from "./invoke-capability";
import { type CapabilityEntry } from "./types";

describe("invoke-capability", () => {
  test("invokeCapability calls agent-sdk-client.sessions.list via fetch mock", async () => {
    const cap: CapabilityEntry = {
      apiPath: "sessions",
      domain: "agent",
      face: "client",
      factory: "createAgenticClient",
      id: "agent-sdk-client.sessions.list",
      kind: "json",
      method: "list",
      package: "@cube-ai/agent-sdk-client",
      params: [],
    };

    const fetchImpl = (() =>
      Response.json({
        items: [
          {
            agentId: "8300000000000000001",
            createTime: Date.now(),
            id: "1000000000000000003",
            status: "ACTIVE",
            title: "demo",
            updateTime: Date.now(),
            userId: "1000000000000000002",
          },
        ],
        page: { hasMore: false },
      })) as unknown as typeof fetch;

    const profile = {
      ...DEFAULT_CONNECTION_PROFILE,
      headers: { authorization: "Bearer test", tenant: "1", terminal: "t" },
    };

    const result = await invokeCapability(cap, profile, {}, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("json");
    expect((result.data as { items: unknown[] }).items).toHaveLength(1);
  });

  test("createAgenticClient factory is wired for agent client capabilities", () => {
    const client = createAgenticClient({
      auth: { provider: () => "token" },
      baseUrl: "http://example.test/agent",
    });
    expect(typeof client.sessions.list).toBe("function");
  });
});
