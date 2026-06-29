import { type Application } from "@dangao/bun-server";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createTestJwtKeyPair, signTestJwt } from "@cube-ai/platform-adapter-ghcloud";

import {
  shouldRunAiCenterIntegration,
  startAiCenterIntegrationStack,
  stopAiCenterIntegrationStack,
} from "./test-helpers/ai-center-integration.harness";

const run = shouldRunAiCenterIntegration;

(run ? describe : describe.skip)("ai-center ghcloud identity e2e [testcontainers]", () => {
  let baseUrl = "";
  let app: Application | undefined;
  let server: ReturnType<NonNullable<Application>["getServer"]> | undefined;
  let bootstrap: (opts?: { port?: number; hostname?: string }) => Promise<Application>;
  let envSnapshot: Record<string, string | undefined>;
  let jwtServer: ReturnType<typeof Bun.serve> | undefined;
  let bearerToken = "";

  beforeAll(async () => {
    ({ envSnapshot } = await startAiCenterIntegrationStack());

    const { privateKey, publicKey, jwk } = await createTestJwtKeyPair();
    bearerToken = await signTestJwt(privateKey, {
      account: "alice@corp",
      admin: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      id: 42,
      name: "alice",
      tenants: [900001],
    });

    jwtServer = Bun.serve({
      fetch(req) {
        if (req.url.endsWith("/jwt.key")) {
          return Response.json({ keys: [{ ...jwk, alg: "RS256", use: "sig" }] });
        }
        return new Response("not found", { status: 404 });
      },
      hostname: "127.0.0.1",
      port: 0,
    });

    process.env.USE_GHCLOUD_IDENTITY = "1";
    process.env.JWT_KEY_URL = `http://127.0.0.1:${jwtServer.port}/jwt.key`;
    void publicKey;

    ({ bootstrap } = await import("./bootstrap"));

    const port = 4300 + Math.floor(Math.random() * 500);
    app = await bootstrap({ hostname: "127.0.0.1", port });
    server = app.getServer();
    baseUrl = `http://127.0.0.1:${port}`;
  }, 180_000);

  afterAll(async () => {
    await server?.stop?.();
    await jwtServer?.stop(true);
    delete process.env.USE_GHCLOUD_IDENTITY;
    delete process.env.JWT_KEY_URL;
    await stopAiCenterIntegrationStack(envSnapshot);
  });

  it("accepts RS256 JWT via USE_GHCLOUD_IDENTITY=1 middleware chain", async () => {
    const resp = await fetch(`${baseUrl}/flow/flows`, {
      headers: {
        authorization: `Bearer ${bearerToken}`,
        tenant: "900001",
      },
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as unknown;
    expect(Array.isArray(body)).toBe(true);
  });
});

// WS3 Task 3.1 — default-on: ghcloud identity should be active unless USE_GHCLOUD_IDENTITY=0
(run ? describe : describe.skip)("ghcloud identity default-on [testcontainers]", () => {
  let baseUrl = "";
  let app: Application | undefined;
  let server: ReturnType<NonNullable<Application>["getServer"]> | undefined;
  let envSnapshot: Record<string, string | undefined>;
  let jwtServer: ReturnType<typeof Bun.serve> | undefined;

  beforeAll(async () => {
    ({ envSnapshot } = await startAiCenterIntegrationStack());

    const { jwk } = await createTestJwtKeyPair();

    jwtServer = Bun.serve({
      fetch(req) {
        if (req.url.endsWith("/jwt.key")) {
          return Response.json({ keys: [{ ...jwk, alg: "RS256", use: "sig" }] });
        }
        return new Response("not found", { status: 404 });
      },
      hostname: "127.0.0.1",
      port: 0,
    });

    // Default-on: applyAiCenterIntegrationTestEnv sets USE_GHCLOUD_IDENTITY=0 for other tests;
    // here we explicitly delete it to prove the default is ON.
    delete process.env.USE_GHCLOUD_IDENTITY;
    process.env.JWT_KEY_URL = `http://127.0.0.1:${jwtServer.port}/jwt.key`;

    const { bootstrap } = await import("./bootstrap");

    const port = 4800 + Math.floor(Math.random() * 100);
    app = await bootstrap({ hostname: "127.0.0.1", port });
    server = app.getServer();
    baseUrl = `http://127.0.0.1:${port}`;
  }, 180_000);

  afterAll(async () => {
    await server?.stop?.();
    await jwtServer?.stop(true);
    delete process.env.JWT_KEY_URL;
    await stopAiCenterIntegrationStack(envSnapshot);
  });

  it("enables ghcloud identity by default when JWT_KEY_URL is set (USE_GHCLOUD_IDENTITY not set)", async () => {
    // No JWT provided → ghcloud middleware must reject with 401
    const resp = await fetch(`${baseUrl}/flow/flows`);
    expect(resp.status).toBe(401);
  });
});
