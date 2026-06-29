/**
 * Auth BC integration tests — requires live stack + IdP when oauth2 mode enabled.
 *
 * Q-M3-2: kept skipped until user wires Redis / OUAA / env.
 */
import { describe, expect, test } from "bun:test";

describe.skip("Auth BC Integration", () => {
  test("mock mode: POST /sessions without Authorization uses fake subject (tenant=1 default)", async () => {
    const base = process.env["AGENTIC_ENGINE_TEST_BASE"] ?? "http://127.0.0.1:4002";
    const res = await fetch(`${base}/sessions`, {
      body: JSON.stringify({ title: "i1" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(200);
  });

  test("oauth2 mode: missing bearer returns 401 UNAUTHENTICATED", async () => {
    const base = process.env["AGENTIC_ENGINE_TEST_BASE"] ?? "http://127.0.0.1:4002";
    const res = await fetch(`${base}/sessions`, {
      body: JSON.stringify({ title: "i1" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(String(body.code ?? "")).toMatch(/UNAUTHENTICATED/u);
  });

  test("oauth2 mode: valid bearer from real IdP returns 200 (user must wire IdP + client creds)", async () => {
    const base = process.env["AGENTIC_ENGINE_TEST_BASE"] ?? "http://127.0.0.1:4002";
    const token = process.env["AGENTIC_ENGINE_TEST_USER_TOKEN"] ?? "";
    const res = await fetch(`${base}/sessions`, {
      body: JSON.stringify({ title: "live" }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    expect(res.status).toBe(200);
  });
});
