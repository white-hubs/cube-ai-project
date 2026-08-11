import { describe, expect, it } from "bun:test";

import {
  type KnowledgeFeedbackPort,
  KnowledgeFeedbackListByTraceResponseSchema,
  KnowledgeFeedbackRecordSchema,
  KnowledgeFeedbackSubmitRequestSchema,
  KnowledgeFeedbackTypeSchema,
} from "./knowledge-feedback";

describe("KnowledgeFeedbackPort contracts (W4.2)", () => {
  it("accepts all feedback types", () => {
    for (const type of ["thumbs_up", "thumbs_down", "wrong_citation", "missed_source"] as const) {
      expect(KnowledgeFeedbackTypeSchema.parse(type)).toBe(type);
    }
  });

  it("Request: requires traceId + query + type", () => {
    const ok = KnowledgeFeedbackSubmitRequestSchema.parse({
      hitChunkIds: ["c1"],
      query: "消防验收",
      traceId: "trace-abc",
      type: "thumbs_down",
    });
    expect(ok.traceId).toBe("trace-abc");
    expect(ok.hitChunkIds).toEqual(["c1"]);
  });

  it("Request: rejects empty traceId", () => {
    expect(() =>
      KnowledgeFeedbackSubmitRequestSchema.parse({
        query: "q",
        traceId: "",
        type: "thumbs_up",
      }),
    ).toThrow();
  });

  it("Request: rejects unknown type", () => {
    expect(() =>
      KnowledgeFeedbackSubmitRequestSchema.parse({
        query: "q",
        traceId: "t1",
        type: "auto_weight",
      }),
    ).toThrow();
  });

  it("Record: parses round-trip fields including traceId", () => {
    const ok = KnowledgeFeedbackRecordSchema.parse({
      createdAt: "2026-08-07T08:00:00+08:00",
      hitChunkIds: ["chunk-1"],
      id: "1",
      query: "条款",
      tenantId: "42",
      traceId: "trace-1",
      type: "wrong_citation",
    });
    expect(ok.traceId).toBe("trace-1");
    expect(ok.type).toBe("wrong_citation");
  });

  it("ListByTrace: defaults empty hitChunkIds on records", () => {
    const ok = KnowledgeFeedbackListByTraceResponseSchema.parse({
      items: [
        {
          createdAt: "2026-08-07T08:00:00+08:00",
          id: "1",
          query: "q",
          tenantId: "1",
          traceId: "t",
          type: "missed_source",
        },
      ],
    });
    expect(ok.items[0]?.hitChunkIds).toEqual([]);
  });

  it("exports KnowledgeFeedbackPort shape", () => {
    const fake: KnowledgeFeedbackPort = {
      listByTraceId: async () => [],
      submit: async () => ({
        createdAt: "t",
        hitChunkIds: [],
        id: "1",
        query: "q",
        tenantId: "1",
        traceId: "tr",
        type: "thumbs_up",
      }),
    };
    expect(typeof fake.submit).toBe("function");
    expect(typeof fake.listByTraceId).toBe("function");
  });
});
