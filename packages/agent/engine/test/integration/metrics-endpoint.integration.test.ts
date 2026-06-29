/**
 * Phase 3 infra — requires `bun run dev` / 真实监听端口。
 * Q-M3-2：integration 断言写齐；默认 `.skip`，解开后需 `TEST_PORT=4001`。
 */
import { describe, expect, test } from "bun:test";

describe.skip("P3-01 metrics endpoint (integration)", () => {
  test("GET /metrics returns Prometheus text with agentic_engine_http_requests_total", async () => {
    const port = process.env.TEST_PORT ?? "4001";
    const base = process.env.TEST_BASE_URL ?? `http://127.0.0.1:${port}`;
    const res = await fetch(`${base}/metrics`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/plain");
    const text = await res.text();
    expect(text.length).toBeGreaterThan(20);
    expect(text).toContain("agentic_engine_http_requests_total");
    expect(text).toContain("# HELP");
  });
});
