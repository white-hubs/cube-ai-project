import { describe, expect, test } from "bun:test";

import { DrainService } from "./drain.service";
import { InMemoryReplayBufferStore } from "./replay-buffer";
import { SessionSseEmitter } from "./sse-emitter";
import { createSessionSseStreamResponse, formatSseRecord, parseLastEventIdHeader } from "./sse-handler";
import { type ReplayBufferEntry } from "./types";

const SCOPE = { sessionId: "281474976710656", tenant: 2 };

describe("parseLastEventIdHeader", () => {
  test("parses valid turnId:seq6", () => {
    expect(parseLastEventIdHeader("281474976710657:000042")).toBe("281474976710657:000042");
  });

  test("returns null for malformed id", () => {
    expect(parseLastEventIdHeader("bad")).toBe(null);
    expect(parseLastEventIdHeader(undefined)).toBe(null);
  });
});

describe("formatSseRecord", () => {
  test("includes id / event / data JSON with schema", () => {
    const entry: ReplayBufferEntry = {
      event: "turn.started",
      eventId: "281474976710657:000001",
      payload: {
        schema: "turn-started-v1",
        turnId: "281474976710657",
        turnNo: 1,
      },
      schema: "turn-started-v1",
      time: 1,
    };
    const s = formatSseRecord(entry);
    expect(s).toContain("id: 281474976710657:000001");
    expect(s).toContain("event: turn.started");
    expect(s).toContain("turn-started-v1");
  });
});

describe("createSessionSseStreamResponse", () => {
  test("returns 503 when drain rejects new streams", async () => {
    const ds = new DrainService();
    await ds.triggerDrain(50);
    const emitter = new SessionSseEmitter(new InMemoryReplayBufferStore());
    const res = createSessionSseStreamResponse({
      drainService: ds,
      emitter,
      lastEventId: null,
      scope: SCOPE,
      signal: AbortSignal.abort(),
    });
    expect(res.status).toBe(503);
  });

  test("first chunk contains replay from buffer after stream opens", async () => {
    const store = new InMemoryReplayBufferStore();
    const emitter = new SessionSseEmitter(store);
    const drain = new DrainService();
    const e1: ReplayBufferEntry = {
      event: "turn.started",
      eventId: "281474976710657:000001",
      payload: { schema: "turn-started-v1", turnId: "281474976710657" },
      schema: "turn-started-v1",
      time: 1,
    };
    await store.append(SCOPE, e1);

    const ac = new AbortController();
    const res = createSessionSseStreamResponse({
      drainService: drain,
      emitter,
      lastEventId: null,
      scope: SCOPE,
      signal: ac.signal,
    });

    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const { value } = await reader.read();
    const chunk = dec.decode(value ?? new Uint8Array());
    expect(chunk).toContain("281474976710657:000001");
    reader.cancel();
    ac.abort();
  });

  test("turnId filter excludes other-turn replay + live events (ADR-0022 §D5.1.v2)", async () => {
    const store = new InMemoryReplayBufferStore();
    const emitter = new SessionSseEmitter(store);
    const drain = new DrainService();

    const T_TURN = "281474976710700";
    const OTHER_TURN = "281474976710701";

    // 用 emitter 自然写入两条历史（每 turn seq 自增）
    await emitter.emit(SCOPE, T_TURN, {
      payload: { schema: "reasoning-step-v1", stepId: "a", turnId: T_TURN },
      sseEvent: "reasoning.step",
    });
    await emitter.emit(SCOPE, OTHER_TURN, {
      payload: { schema: "reasoning-step-v1", stepId: "b", turnId: OTHER_TURN },
      sseEvent: "reasoning.step",
    });

    const ac = new AbortController();
    const res = createSessionSseStreamResponse({
      drainService: drain,
      emitter,
      lastEventId: null,
      scope: SCOPE,
      signal: ac.signal,
      turnId: T_TURN,
    });
    expect(res.ok).toBe(true);

    // 让 subscribe 注册
    await new Promise((r) => setTimeout(r, 20));

    // live emit 一条非本 turn 的事件 — 应当被 filter 丢弃
    await emitter.emit(SCOPE, OTHER_TURN, {
      payload: { schema: "reasoning-step-v1", stepId: "c", turnId: OTHER_TURN },
      sseEvent: "reasoning.step",
    });
    // live emit 一条本 turn 的事件 — 应当透传
    await emitter.emit(SCOPE, T_TURN, {
      payload: { schema: "reasoning-delta-v1", text: "hi", turnId: T_TURN },
      sseEvent: "reasoning.delta",
    });

    await new Promise((r) => setTimeout(r, 20));

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let aggregated = "";
    for (let i = 0; i < 5; i++) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      aggregated += dec.decode(value ?? new Uint8Array());
      if (aggregated.includes(`${T_TURN}:000002`)) {
        break;
      }
    }
    expect(aggregated).toContain(`${T_TURN}:000001`);
    expect(aggregated).toContain(`${T_TURN}:000002`);
    expect(aggregated).not.toContain(`${OTHER_TURN}:000001`);
    expect(aggregated).not.toContain(`${OTHER_TURN}:000002`);
    reader.cancel();
    ac.abort();
  });

  // Regression — per-turn 流收到终态事件后服务端必须主动 close，使 HTTP 请求以
  // 正常 EOF 结束（DevTools 能保留完整 Response）。根因见 ADR-0022 §D5.1.v2。
  async function readUntilDone(
    reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> },
    budgetMs: number,
  ): Promise<{ closed: boolean; text: string }> {
    const dec = new TextDecoder();
    let text = "";
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      const race = await Promise.race([
        reader.read().then((r) => ({ kind: "read" as const, r })),
        new Promise<{ kind: "timeout" }>((res) => setTimeout(() => res({ kind: "timeout" }), 60)),
      ]);
      if (race.kind === "timeout") {
        continue;
      }
      if (race.r.done) {
        return { closed: true, text };
      }
      text += dec.decode(race.r.value ?? new Uint8Array());
    }
    return { closed: false, text };
  }

  test("per-turn 流收到 turn-completed-v1 → server 主动 close（live 路径）", async () => {
    const store = new InMemoryReplayBufferStore();
    const emitter = new SessionSseEmitter(store);
    const drain = new DrainService();
    const T = "281474976710710";

    const ac = new AbortController();
    const res = createSessionSseStreamResponse({
      drainService: drain,
      emitter,
      lastEventId: null,
      scope: SCOPE,
      signal: ac.signal,
      turnId: T,
    });
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 20));

    await emitter.emit(SCOPE, T, {
      payload: { schema: "turn-started-v1", turnId: T, turnNo: 1 },
      sseEvent: "turn.started",
    });
    await emitter.emit(SCOPE, T, {
      payload: { schema: "turn-completed-v1", turnId: T },
      sseEvent: "turn.completed",
    });

    const reader = res.body!.getReader();
    const { closed, text } = await readUntilDone(reader, 800);
    expect(closed).toBe(true);
    expect(text).toContain("turn-completed-v1");
    ac.abort();
  });

  test("per-turn 流重连后回放命中终态 → 回放完即 close（replay 路径）", async () => {
    const store = new InMemoryReplayBufferStore();
    const emitter = new SessionSseEmitter(store);
    const drain = new DrainService();
    const T = "281474976710720";

    // turn 早已完成，事件全在 replay 缓冲里
    await emitter.emit(SCOPE, T, {
      payload: { schema: "turn-started-v1", turnId: T, turnNo: 1 },
      sseEvent: "turn.started",
    });
    await emitter.emit(SCOPE, T, {
      payload: { error: { code: "X", message: "y" }, schema: "turn-failed-v1", turnId: T },
      sseEvent: "turn.failed",
    });

    const ac = new AbortController();
    const res = createSessionSseStreamResponse({
      drainService: drain,
      emitter,
      lastEventId: null,
      scope: SCOPE,
      signal: ac.signal,
      turnId: T,
    });
    expect(res.ok).toBe(true);

    const reader = res.body!.getReader();
    const { closed, text } = await readUntilDone(reader, 800);
    expect(closed).toBe(true);
    expect(text).toContain("turn-failed-v1");
    ac.abort();
  });

  test("session-scope 流（无 turnId）收到终态事件不被误关", async () => {
    const store = new InMemoryReplayBufferStore();
    const emitter = new SessionSseEmitter(store);
    const drain = new DrainService();
    const T = "281474976710730";

    const ac = new AbortController();
    const res = createSessionSseStreamResponse({
      scope: SCOPE,
      lastEventId: null,
      emitter,
      drainService: drain,
      signal: ac.signal,
      // 不传 turnId → session-scope（v1 兼容），长连接不应因单个 turn 终态而关
    });
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 20));

    await emitter.emit(SCOPE, T, {
      payload: { schema: "turn-completed-v1", turnId: T },
      sseEvent: "turn.completed",
    });

    const reader = res.body!.getReader();
    const { closed, text } = await readUntilDone(reader, 400);
    expect(text).toContain("turn-completed-v1");
    expect(closed).toBe(false); // 仍保持 open
    reader.cancel();
    ac.abort();
  });
});
