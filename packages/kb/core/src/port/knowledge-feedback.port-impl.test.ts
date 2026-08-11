import { describe, expect, test } from "bun:test";

import { InMemorySearchFeedbackRepository } from "../modules/vector-store/feedback/in-memory-search-feedback.repository";
import { SearchFeedbackMetricsQuery } from "../modules/vector-store/feedback/search-feedback-metrics";
import { SearchFeedbackService } from "../modules/vector-store/feedback/search-feedback.service";
import { makeMockAppConfig } from "../test-helpers/mock-app-config";
import { KnowledgeFeedbackPortImpl } from "./knowledge-feedback.port-impl";

describe("KnowledgeFeedbackPortImpl (W4.2 agent bypass shares repository)", () => {
  test("port submit + listByTraceId use the same store as HTTP service", async () => {
    const repo = new InMemorySearchFeedbackRepository();
    const metrics = new SearchFeedbackMetricsQuery(
      async (tenantId) => repo.all().filter((row) => row.tenantId === tenantId),
      async () => new Map(),
    );
    const service = new SearchFeedbackService(makeMockAppConfig({ searchFeedbackEnabled: true }), repo, metrics);
    const port = new KnowledgeFeedbackPortImpl(service);

    await port.submit(
      { query: "agent-q", traceId: "agent-trace", type: "thumbs_up" },
      { authenticated: true, subjectId: "agent-1", tenantId: "7" },
    );

    // HTTP-shaped service read sees the same row (shared repository).
    const viaService = await service.listByTraceId("agent-trace", { authenticated: true, tenantId: "7" });
    expect(viaService).toHaveLength(1);
    expect(viaService[0]?.query).toBe("agent-q");

    const viaPort = await port.listByTraceId("agent-trace", { authenticated: true, tenantId: "7" });
    expect(viaPort[0]?.id).toBe(viaService[0]?.id);
  });
});
