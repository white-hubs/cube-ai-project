/**
 * P3-06 SSE：Last-Event-ID 回放 / 心跳 / drain-mode
 *
 * SSE：Last-Event-ID / 心跳 `ping-v1` 已并入
 * `mysql-redis-qdrant.testcontainers.test.ts`（`USE_TESTCONTAINERS=1`）。
 * 本文件保留 `describe.skip`：含 drain（需 SIGTERM 子进程）等需人工场景。
 *
 * ref: docs/technical-design/prompts/phase-3/P3-06-session-sse.md §6
 */
import { describe, expect, test } from "bun:test";

const PORT = Number(process.env.TEST_PORT ?? 4006);
const BASE = `http://127.0.0.1:${PORT}`;

describe.skip("SSE replay + heartbeat + drain (live stack)", () => {
  test("GET /events with Last-Event-ID replays buffered events newer than anchor id", async () => {
    const sid = process.env.TEST_SESSION_ID!;
    const lastId = process.env.TEST_LAST_EVENT_ID!;
    const res = await fetch(`${BASE}/sessions/${sid}/events`, {
      headers: { "Last-Event-ID": lastId },
    });
    expect(res.ok).toBe(true);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const txt = await res.text();
    expect(txt.length).toBeGreaterThan(20);
    expect(txt).toMatch(/id:\s*\d{1,20}:\d{6}/u);
    expect(txt).not.toContain(lastId);
  });

  test("heartbeat emits ping with schema ping-v1 within ~30s window", async () => {
    const sid = process.env.TEST_SESSION_ID!;
    const ac = new AbortController();
    const p = fetch(`${BASE}/sessions/${sid}/events`, { signal: ac.signal });
    const res = await p;
    expect(res.ok).toBe(true);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 35_000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buf += dec.decode(value);
      if (buf.includes('"schema":"ping-v1"') || buf.includes('"schema": "ping-v1"')) {
        break;
      }
    }
    ac.abort();
    expect(buf).toContain("ping-v1");
  });

  test("after SIGTERM on engine, active SSE reads drain.mode with drain-mode-v1 before close", async () => {
    const sid = process.env.TEST_SESSION_ID!;
    const ac = new AbortController();
    const res = await fetch(`${BASE}/sessions/${sid}/events`, { signal: ac.signal });
    expect(res.ok).toBe(true);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buf += dec.decode(value);
      if (buf.includes("drain-mode-v1")) {
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    ac.abort();
    expect(buf).toContain("drain.mode");
    expect(buf).toContain("drain-mode-v1");
  });
});
