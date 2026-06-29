import { describe, expect, test } from "bun:test";

import { AgenticClient } from "@cube-ai/agent-sdk-client";
import { startMockEngine } from "@cube-ai/agent-sdk-client-mock";

describe("@cube-ai/agent-sdk-client-mock integration with sdk-core", () => {
  test("client.healthLive() → UP from mock engine", async () => {
    const mock = await startMockEngine();
    try {
      const client = new AgenticClient({ baseUrl: mock.url });
      const body = await client.healthLive();
      expect(body.status).toBe("UP");
      expect(typeof body.timestamp).toBe("number");
      expect(body.timestamp).toBeGreaterThan(0);
    } finally {
      await mock.stop();
    }
  });

  test("unknown route → AgenticError (5-field envelope)", async () => {
    const mock = await startMockEngine();
    try {
      const response = await fetch(`${mock.url}/nonexistent`);
      expect(response.status).toBe(404);
      const body = (await response.json()) as {
        status: number;
        code: string;
        message: string;
      };
      expect(body.status).toBe(404);
      expect(body.code).toBe("RESOURCE_NOT_FOUND_ROUTE");
      expect(body.message).toMatch(/No mock handler/u);
    } finally {
      await mock.stop();
    }
  });
});
