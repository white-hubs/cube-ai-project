import { BadRequestException, UnauthorizedException } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { InMemorySearchFeedbackRepository } from "./in-memory-search-feedback.repository";
import { SearchFeedbackMetricsQuery } from "./search-feedback-metrics";
import { SearchFeedbackService } from "./search-feedback.service";

function createService(overrides?: { enabled?: boolean }) {
  const repo = new InMemorySearchFeedbackRepository();
  const metrics = new SearchFeedbackMetricsQuery(
    async (tenantId) => repo.all().filter((row) => row.tenantId === tenantId),
    async () => new Map(),
  );
  const service = new SearchFeedbackService(makeMockAppConfig({ searchFeedbackEnabled: overrides?.enabled ?? true }), repo, metrics);
  return { repo, service };
}

describe("SearchFeedbackService (W4.2-H1/H2/H3)", () => {
  test("W4.2-H1: submit then listByTraceId round-trips", async () => {
    const { service } = createService();
    const auth = { authenticated: true, tenantId: "42" };
    const created = await service.submit(
      {
        hitChunkIds: ["chunk-1", "chunk-2"],
        query: "消防验收",
        traceId: "trace-corr-1",
        type: "thumbs_down",
      },
      auth,
    );
    expect(created.traceId).toBe("trace-corr-1");
    expect(created.tenantId).toBe("42");

    const listed = await service.listByTraceId("trace-corr-1", auth);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
    expect(listed[0]?.hitChunkIds).toEqual(["chunk-1", "chunk-2"]);
  });

  test("W4.2-H2: rejects anonymous and missing tenant", async () => {
    const { service } = createService();
    await expect(
      service.submit({ query: "q", traceId: "t", type: "thumbs_up" }, { authenticated: false, tenantId: "1" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      service.submit({ query: "q", traceId: "t", type: "thumbs_up" }, { authenticated: true, tenantId: null }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  test("W4.2-H3: feedback.traceId correlates with retrieval trace field name", async () => {
    const { service } = createService();
    // Same string a KnowledgeQueryRequest.traceId / search echo would carry.
    const retrievalTraceId = "kq-trace-99";
    await service.submit(
      { query: "条款", traceId: retrievalTraceId, type: "wrong_citation", comment: "bad cite" },
      { authenticated: true, subjectId: "u1", tenantId: "9" },
    );
    const found = await service.listByTraceId(retrievalTraceId, { authenticated: true, tenantId: "9" });
    expect(found[0]?.traceId).toBe(retrievalTraceId);
    expect(found[0]?.type).toBe("wrong_citation");
  });

  test("feature flag off rejects writes", async () => {
    const { service } = createService({ enabled: false });
    await expect(
      service.submit({ query: "q", traceId: "t", type: "thumbs_up" }, { authenticated: true, tenantId: "1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test("rejects invalid payload", async () => {
    const { service } = createService();
    await expect(service.submit({ query: "q", traceId: "t", type: "nope" }, { authenticated: true, tenantId: "1" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
