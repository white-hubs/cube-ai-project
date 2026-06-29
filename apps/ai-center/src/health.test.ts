import { type Application } from "@dangao/bun-server";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  shouldRunAiCenterIntegration,
  startAiCenterIntegrationStack,
  stopAiCenterIntegrationStack,
} from "./test-helpers/ai-center-integration.harness";

const run = shouldRunAiCenterIntegration;

(run ? describe : describe.skip)("ai-center health [testcontainers]", () => {
  let baseUrl = "";
  let app: Application | undefined;
  let server: ReturnType<NonNullable<Application>["getServer"]> | undefined;
  let bootstrap: (opts?: { port?: number; hostname?: string }) => Promise<Application>;
  let envSnapshot: Record<string, string | undefined>;

  beforeAll(async () => {
    ({ envSnapshot } = await startAiCenterIntegrationStack());

    ({ bootstrap } = await import("./bootstrap"));

    const port = 4100 + Math.floor(Math.random() * 500);
    app = await bootstrap({ hostname: "127.0.0.1", port });
    server = app.getServer();
    baseUrl = `http://127.0.0.1:${port}`;
  }, 180_000);

  afterAll(async () => {
    await server?.stop?.();
    await stopAiCenterIntegrationStack(envSnapshot);
  });

  it("GET /health/live returns 200 UP", async () => {
    const resp = await fetch(`${baseUrl}/health/live`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { status?: string };
    expect(body.status).toBe("UP");
  });
});
