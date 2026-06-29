import { describe, expect, it } from "bun:test";

import { type FlowCatalogListRequest } from "@cube-ai/contracts";

import { GhcloudPlatformError } from "../errors";
import { GhcloudFlowCatalogAdapter } from "./flow-catalog.adapter";

function mockFetch(handler: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    calls.push(req);
    return handler(req);
  };
  return { calls, fn: fn as unknown as typeof fetch };
}

const baseListReq: FlowCatalogListRequest = {
  tenant: 9,
  traceId: "trace-list-1",
};

describe("GhcloudFlowCatalogAdapter", () => {
  it("GETs /ai/flows with tenant + trace headers", async () => {
    const m = mockFetch(() =>
      Response.json([{ description: null, enabled: true, id: "7", name: "Seven" }], {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const adapter = new GhcloudFlowCatalogAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => "svc",
    });
    const out = await adapter.list(baseListReq, new AbortController().signal);
    expect(m.calls).toHaveLength(1);
    const req = m.calls[0]!;
    expect(req.method).toBe("GET");
    expect(req.url.startsWith("http://aias.test/ai/flows")).toBe(true);
    expect(req.headers.get("authorization")).toBe("Bearer svc");
    expect(req.headers.get("tenant")).toBe("9");
    expect(req.headers.get("x-trace-id")).toBe("trace-list-1");
    expect(out.flows).toEqual([{ description: null, enabled: true, flowId: "7", name: "Seven" }]);
    expect(out.pagination).toBeUndefined();
  });

  it("maps paged { records } and forwards keyword query", async () => {
    const m = mockFetch(() =>
      Response.json(
        {
          currentPage: 1,
          pageSize: 10,
          pages: 1,
          records: [{ id: "a", name: "A", compileStatus: "OK" }],
          total: 2,
        },
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const adapter = new GhcloudFlowCatalogAdapter({
      baseUrl: "http://aias.test/",
      fetchImpl: m.fn,
      tokenProvider: async () => "t",
    });
    const out = await adapter.list({ ...baseListReq, keyword: "  x  ", pageNumber: 1, pageSize: 10 }, new AbortController().signal);
    expect(out.flows[0]!.flowId).toBe("a");
    expect(out.pagination?.total).toBe(2);
    const u = new URL(m.calls[0]!.url);
    expect(u.searchParams.get("keyword")).toBe("x");
    expect(u.searchParams.get("pageNumber")).toBe("1");
    expect(u.searchParams.get("pageSize")).toBe("10");
  });

  it("uses userToken when provided", async () => {
    const m = mockFetch(() =>
      Response.json([], {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    let n = 0;
    const adapter = new GhcloudFlowCatalogAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => {
        n += 1;
        return "svc";
      },
    });
    await adapter.list({ ...baseListReq, userToken: "obo" }, new AbortController().signal);
    expect(m.calls[0]!.headers.get("authorization")).toBe("Bearer obo");
    expect(n).toBe(0);
  });

  it("maps 401 to UPSTREAM_AUTH_FAILED", async () => {
    const m = mockFetch(() => new Response("nope", { status: 401 }));
    const adapter = new GhcloudFlowCatalogAdapter({
      baseUrl: "http://aias.test",
      fetchImpl: m.fn,
      tokenProvider: async () => "t",
    });
    let caught: unknown;
    try {
      await adapter.list(baseListReq, new AbortController().signal);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GhcloudPlatformError);
    expect((caught as GhcloudPlatformError).code).toBe("UPSTREAM_AUTH_FAILED");
  });
});
