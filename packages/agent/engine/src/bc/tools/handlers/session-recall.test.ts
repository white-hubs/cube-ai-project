import { describe, expect, test } from "bun:test";

import { extractTextFromContentJson } from "./mysql-session-transcript-reader";
import { assembleSessionRecall, type SessionTranscriptRow } from "./session-recall";

function row(partial: Partial<SessionTranscriptRow> & Pick<SessionTranscriptRow, "id" | "role" | "text">): SessionTranscriptRow {
  return {
    turnId: partial.turnId ?? "t1",
    createTime: partial.createTime ?? 1,
    ...partial,
  };
}

describe("assembleSessionRecall", () => {
  test("returns full mode with all messages when under maxChars budget", () => {
    const rows = [
      row({ id: "1", role: "user", text: "看今日报警", createTime: 10 }),
      row({ id: "2", role: "assistant", text: "今日 41 条一级告警", createTime: 20 }),
    ];
    const out = assembleSessionRecall(rows, {});
    expect(out.mode).toBe("full");
    expect(out.truncated).toBe(false);
    expect(out.messages).toEqual([
      { id: "1", turnId: "t1", role: "user", text: "看今日报警", createTime: 10 },
      { id: "2", turnId: "t1", role: "assistant", text: "今日 41 条一级告警", createTime: 20 },
    ]);
  });

  test("filters by case-insensitive query substring", () => {
    const rows = [
      row({ id: "1", role: "user", text: "hello", createTime: 1 }),
      row({ id: "2", role: "assistant", text: "今日告警态势分析报告：41 条", createTime: 2 }),
      row({ id: "3", role: "user", text: "其它话题", createTime: 3 }),
    ];
    const out = assembleSessionRecall(rows, { query: "告警态势" });
    expect(out.messages.map((m) => m.id)).toEqual(["2"]);
    expect(out.mode).toBe("full");
  });

  test("over maxChars returns summary mode with truncated true and keeps newest text fuller", () => {
    const old = "O".repeat(500);
    const recent = "今日告警态势分析报告正文";
    const rows = [
      row({ id: "old", role: "assistant", text: old, createTime: 1 }),
      row({ id: "new", role: "assistant", text: recent, createTime: 2 }),
    ];
    const out = assembleSessionRecall(rows, { maxChars: 80 });
    expect(out.mode).toBe("summary");
    expect(out.truncated).toBe(true);
    const newest = out.messages.find((m) => m.id === "new");
    expect(newest?.text).toBe(recent);
    const oldest = out.messages.find((m) => m.id === "old");
    expect(oldest?.text.length ?? 0).toBeLessThan(old.length);
  });
});

describe("extractTextFromContentJson", () => {
  test("reads message-content-v1 text blocks", () => {
    expect(
      extractTextFromContentJson({
        schema: "message-content-v1",
        blocks: [{ type: "text", text: "报告正文" }],
      }),
    ).toBe("报告正文");
  });
});

describe("SessionRecallHandler", () => {
  test("loads transcript for ctx.session.id and returns prior assistant text", async () => {
    const { SessionRecallHandler } = await import("./session-recall-handler");
    const reader = {
      listBySession: async (p: { tenant: number; sessionId: string; limit: number }) => {
        expect(p.tenant).toBe(42);
        expect(p.sessionId).toBe("sess-1");
        expect(p.limit).toBeGreaterThan(0);
        return [
          row({ id: "1", role: "user", text: "生成报告", createTime: 1 }),
          row({ id: "2", role: "assistant", text: "今日告警态势分析报告：41 条", createTime: 2 }),
        ];
      },
    };
    const handler = new SessionRecallHandler(reader);
    const out = await handler.invoke(
      { query: "态势分析" },
      {
        traceId: "tr",
        signal: new AbortController().signal,
        auth: { tenant: 42, user: { userId: "u1", scopes: [] } },
        session: { id: "sess-1", turnId: "turn-2" },
      },
    );
    expect(out.mode).toBe("full");
    expect(out.messages.some((m) => m.text.includes("41 条"))).toBe(true);
  });
});
