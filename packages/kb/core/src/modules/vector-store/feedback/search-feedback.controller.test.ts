import { UnauthorizedException } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { tenantContextAls } from "@cube-ai/tenant-context";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { InMemorySearchFeedbackRepository } from "./in-memory-search-feedback.repository";
import { SearchFeedbackMetricsQuery } from "./search-feedback-metrics";
import { SearchFeedbackController } from "./search-feedback.controller";
import { SearchFeedbackService } from "./search-feedback.service";

function createController() {
  const repo = new InMemorySearchFeedbackRepository();
  const metrics = new SearchFeedbackMetricsQuery(
    async (tenantId) => repo.all().filter((row) => row.tenantId === tenantId),
    async () => new Map([["c1", 5]]),
  );
  const service = new SearchFeedbackService(makeMockAppConfig({ searchFeedbackEnabled: true }), repo, metrics);
  return new SearchFeedbackController(service);
}

function fakeCtx(headers: Record<string, string>) {
  return {
    request: {
      headers: {
        get(name: string) {
          const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
          return key ? headers[key]! : null;
        },
      },
    },
  };
}

describe("SearchFeedbackController (W4.2-H1/H2)", () => {
  test("W4.2-H2: anonymous write rejected", async () => {
    const controller = createController();
    await tenantContextAls.run({ tenantId: "42" }, async () => {
      await expect(controller.submit({ query: "q", traceId: "t1", type: "thumbs_up" }, fakeCtx({}) as never)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  test("raw Authorization/API-key header shapes cannot authenticate a write or read", async () => {
    const controller = createController();
    await tenantContextAls.run({ tenantId: "42" }, async () => {
      await expect(
        controller.submit(
          { hitChunkIds: ["c1"], query: "消防", traceId: "trace-http-1", type: "missed_source" },
          fakeCtx({ authorization: "Bearer test-token" }) as never,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(controller.listByTrace("trace-http-1", fakeCtx({ "x-api-key": "sk_test" }) as never)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  test("metrics endpoint remains inaccessible until a trusted principal is wired", async () => {
    const controller = createController();
    await tenantContextAls.run({ tenantId: "42" }, async () => {
      await expect(controller.metrics(undefined, undefined, fakeCtx({ authorization: "Bearer x" }) as never)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
