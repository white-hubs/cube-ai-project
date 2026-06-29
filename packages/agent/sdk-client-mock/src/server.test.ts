import { describe, expect, test } from "bun:test";

import { createAgenticClient } from "@cube-ai/agent-sdk-client";

import { SCENARIOS } from "./scenarios";
import { startMockEngine } from "./server";

describe("startMockEngine", () => {
  test("启动后可 POST /sessions 并 GET 回 SFID session", async () => {
    const mock = await startMockEngine({
      port: 0,
      scenarioName: "health_up",
    });
    try {
      const client = createAgenticClient({
        baseUrl: mock.url,
        sse: { maxReconnectAttempts: 0, reconnect: false },
        token: "mock-token",
      });

      const created = await client.sessions.create({
        agentId: "8200000000000000001",
      });
      expect(created.id).toMatch(/^\d{19}$/u);

      const s = await client.sessions.get(created.id);
      expect(s.status).toBe("ACTIVE");
      expect(s.agentId).toBe("8200000000000000001");
    } finally {
      await mock.stop();
    }
  });

  test("GET /descriptors + GET /jobs/:id + cancel 语义闭环", async () => {
    const mock = await startMockEngine({ port: 0 });
    try {
      const client = createAgenticClient({ baseUrl: mock.url, token: "t" });

      const tools = await client.tools.list();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0]!.name).toBe("platform.echo");

      const jobId = "2000000000000000001";
      const job = await client.jobs.get(jobId);
      expect(job.status).toBe("RUNNING");

      await client.jobs.cancel(jobId);
      const cancelled = await client.jobs.get(jobId);
      expect(cancelled.status).toBe("CANCELLED");
    } finally {
      await mock.stop();
    }
  });

  test("turn_streaming 场景 startTurn + streamEvents 可得 turn-completed-v1", async () => {
    const mock = await startMockEngine({
      port: 0,
      scenario: SCENARIOS.turn_streaming,
    });
    try {
      const client = createAgenticClient({
        baseUrl: mock.url,
        sse: { maxReconnectAttempts: 0, reconnect: false },
        token: "t",
      });

      const { id } = await client.sessions.create({
        agentId: "8300000000000000001",
      });

      const ac = new AbortController();
      const schemas: string[] = [];
      const streamPromise = (async (): Promise<void> => {
        for await (const ev of client.sessions.streamEvents(id, { signal: ac.signal })) {
          schemas.push(ev.schema);
          if (ev.schema === "turn-completed-v1") {
            ac.abort();
            return;
          }
        }
      })();

      await client.sessions.startTurn(id, {
        content: { blocks: [{ type: "text", text: "hi" }], schema: "message-content-v1" },
      });
      await streamPromise;

      expect(schemas).toContain("turn-completed-v1");
    } finally {
      await mock.stop();
    }
  });
});
