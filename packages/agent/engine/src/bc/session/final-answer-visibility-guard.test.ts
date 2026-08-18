import { describe, expect, test } from "bun:test";
import type { EngineOutput } from "@tachu/core";

import { guardFinalAnswerEngineOutput } from "./final-answer-visibility-guard";

function output(content: string): EngineOutput {
  return {
    content,
    metadata: {
      tokenUsage: { input: 1, output: 1, total: 2 },
    },
  } as EngineOutput;
}

describe("final-answer-visibility-guard", () => {
  test("blocks SQL/MCP leakage after sensitive business-data tool use", () => {
    const guarded = guardFinalAnswerEngineOutput(output('SQL 是 SELECT * FROM ai_risk WHERE tenant_id = 1，工具 mcp://x'), {
      sensitiveToolUsed: true,
    });

    expect(guarded.blocked).toBe(true);
    expect(guarded.reasons).toContain("mcp_uri");
    expect(JSON.stringify(guarded.output)).not.toContain("SELECT");
    expect(JSON.stringify(guarded.output)).not.toContain("tenant_id");
    expect(JSON.stringify(guarded.output)).toContain("系统已阻止直接展示");
  });

  test("does not block the same text when no sensitive business-data tool was used", () => {
    const raw = output("示例 SQL：SELECT * FROM users");
    const guarded = guardFinalAnswerEngineOutput(raw, { sensitiveToolUsed: false });

    expect(guarded.blocked).toBe(false);
    expect(guarded.output).toBe(raw);
  });

  test("allows safe business answer with warnings", () => {
    const guarded = guardFinalAnswerEngineOutput(output("查询到 3 条记录，其中 1 个字段缺少枚举映射，已按原始值展示。"), {
      sensitiveToolUsed: true,
    });

    expect(guarded.blocked).toBe(false);
  });
});
