import { describe, expect, test } from "bun:test";

import { extractTraceIdHeader, normalizeRetrievalTraceId, resolveRetrievalTraceId } from "./retrieval-trace";

describe("retrieval-trace (W4.2-H3)", () => {
  test("normalizes non-empty traceId aligned with KnowledgeQueryRequest.traceId", () => {
    expect(normalizeRetrievalTraceId("  trace-1  ")).toBe("trace-1");
    expect(normalizeRetrievalTraceId("")).toBeUndefined();
    expect(normalizeRetrievalTraceId(null)).toBeUndefined();
    expect(normalizeRetrievalTraceId("x".repeat(129))).toBeUndefined();
  });

  test("resolve prefers body over header", () => {
    expect(
      resolveRetrievalTraceId({
        bodyTraceId: "body-trace",
        headerTraceId: "header-trace",
      }),
    ).toBe("body-trace");
    expect(resolveRetrievalTraceId({ headerTraceId: "header-trace" })).toBe("header-trace");
  });

  test("extractTraceIdHeader reads X-Trace-Id", () => {
    const headers = new Headers({ "X-Trace-Id": "from-header" });
    expect(extractTraceIdHeader(headers)).toBe("from-header");
  });
});
