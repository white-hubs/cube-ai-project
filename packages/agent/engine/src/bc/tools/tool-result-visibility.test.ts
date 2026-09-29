import { describe, expect, test } from "bun:test";

import { projectToolResultForModel } from "./tool-result-visibility";

describe("tool-result-visibility", () => {
  test("projects ask_business_data structuredContent and removes diagnostics/_meta/sql/tool args/raw ids", () => {
    const projected = projectToolResultForModel("mcp.biz-ontology.ask_business_data", {
      structuredContent: {
        status: "answered",
        answer: {
          summary: "查询到 1 条风险单元。",
          columns: [
            { key: "risk_name", label: "风险名称" },
            { key: "risk_id", label: "风险ID" },
          ],
          rows: [
            {
              risk_name: "配电房积水",
              risk_id: "123",
              tenant_id: 1,
              deleted: 0,
            },
          ],
        },
        diagnostics: {
          routing_trace: { selected_domain: "risk_control" },
          sql: "SELECT * FROM ai_sm_risk_unit",
        },
      },
      _meta: {
        arguments: { sql: "SELECT * FROM ai_sm_risk_unit" },
        traceId: "trace-1",
      },
    });

    expect(JSON.stringify(projected)).toContain("配电房积水");
    expect(JSON.stringify(projected)).not.toContain("SELECT");
    expect(JSON.stringify(projected)).not.toContain("routing_trace");
    expect(JSON.stringify(projected)).not.toContain("tenant_id");
    expect(JSON.stringify(projected)).not.toContain("risk_id");
    expect(JSON.stringify(projected)).not.toContain("trace-1");
  });

  test("redacts dangerous strings in generic tool results without dropping safe summary", () => {
    const projected = projectToolResultForModel("mcp.other.tool", {
      summary: "ok",
      raw: { sql: "SELECT * FROM t" },
      text: "mcp://mcp.biz-ontology.query_database:{}",
      rows: [{ name: "safe" }],
    });

    expect(projected).toEqual({
      summary: "ok",
      text: "[redacted]",
      rows: [{ name: "safe" }],
    });
  });

  test("keeps only opaque clarification confirmation tokens", () => {
    const projected = projectToolResultForModel("mcp.biz-ontology.ask_business_data", {
      structuredContent: {
        status: "needs_clarification",
        clarification: {
          question: "请选择处理人",
          question_id: "question-1",
          slot: "dimension_value",
          options: [
            { id: "name-abc123", label: "超级管理员3", asset_id: "handler-secret" },
            { option_id: "graph-option-2", label: "超级管理员2" },
          ],
        },
        diagnostics: { tenant_id: "hidden" },
      },
    });

    expect(projected).toMatchObject({
      status: "needs_clarification",
      clarification: {
        question_id: "question-1",
        slot: "dimension_value",
        options: [
          { option_id: "name-abc123", label: "超级管理员3" },
          { option_id: "graph-option-2", label: "超级管理员2" },
        ],
      },
    });
    expect(JSON.stringify(projected)).not.toContain("handler-secret");
    expect(JSON.stringify(projected)).not.toContain("tenant_id");
  });
});
