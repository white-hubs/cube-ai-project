import { describe, expect, it } from "bun:test";

import { FlowCatalogListRequestSchema, FlowCatalogListResponseSchema } from "./flow-catalog";

describe("FlowCatalogListRequestSchema", () => {
  it("parses minimal request", () => {
    const r = FlowCatalogListRequestSchema.parse({
      tenant: 1,
      traceId: "t-1",
    });
    expect(r.tenant).toBe(1);
    expect(r.traceId).toBe("t-1");
  });

  it("accepts paging + keyword", () => {
    const r = FlowCatalogListRequestSchema.parse({
      keyword: "退款",
      pageNumber: 2,
      pageSize: 20,
      tenant: 2,
      traceId: "t-2",
    });
    expect(r.keyword).toBe("退款");
    expect(r.pageNumber).toBe(2);
    expect(r.pageSize).toBe(20);
  });
});

describe("FlowCatalogListResponseSchema", () => {
  it("parses flows array", () => {
    const r = FlowCatalogListResponseSchema.parse({
      flows: [
        {
          compileStatus: "OK",
          description: null,
          enabled: true,
          flowId: "101",
          name: "A",
        },
      ],
    });
    expect(r.flows).toHaveLength(1);
    expect(r.flows[0]!.flowId).toBe("101");
  });
});
