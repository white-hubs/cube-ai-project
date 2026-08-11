import { describe, expect, test } from "bun:test";

import type { RerankPort, RerankRequest, RerankResultItem } from "@cube-ai/contracts/platform";

import {
  allocateMultiDocumentRerankBudget,
  clampRerankScore,
  modelRerankOnce,
  normalizeStandardIdentifiers,
  rerankDisplayText,
} from "./model-rerank";

describe("modelRerankOnce (W2.2-H6)", () => {
  test("reranks by port scores without full search path", async () => {
    let calls = 0;
    const port: RerankPort = {
      async rerank(req: RerankRequest): Promise<RerankResultItem[]> {
        calls += 1;
        expect(req.documents).toEqual(["[content]\nlow", "[content]\nhigh"]);
        return [
          { index: 1, relevanceScore: 0.95 },
          { index: 0, relevanceScore: 0.1 },
        ];
      },
    };

    const ranked = await modelRerankOnce({
      candidates: [
        { payload: { text: "low" }, rankScore: 0.9, score: 0.9 },
        { payload: { text: "high" }, rankScore: 0.2, score: 0.2 },
      ],
      inputTopN: 50,
      modelCode: "qwen3-rerank",
      query: "q",
      rerankPort: port,
      tenant: 1,
    });

    expect(calls).toBe(1);
    expect(ranked.map((item) => item.payload.text)).toEqual(["high", "low"]);
    expect(ranked[0]?.rankScore).toBe(0.95);
    expect(ranked[0]?.modelRerankScore).toBe(0.95);
    expect(ranked[0]?.score).toBe(0.2);
    expect(ranked[1]?.rankScore).toBe(0.1);
  });

  test("truncates to inputTopN before calling port", async () => {
    const seen: string[] = [];
    const port: RerankPort = {
      async rerank(req: RerankRequest): Promise<RerankResultItem[]> {
        seen.push(...req.documents);
        return req.documents.map((_, index) => ({ index, relevanceScore: 1 - index * 0.1 }));
      },
    };

    await modelRerankOnce({
      candidates: [
        { payload: { text: "a" }, rankScore: 0.9, score: 0.9 },
        { payload: { text: "b" }, rankScore: 0.8, score: 0.8 },
        { payload: { text: "c" }, rankScore: 0.7, score: 0.7 },
      ],
      inputTopN: 2,
      modelCode: "qwen3-rerank",
      query: "q",
      rerankPort: port,
      tenant: 1,
    });

    expect(seen).toEqual(["[content]\na", "[content]\nb"]);
  });

  test("allocates at least one candidate per document when budget permits", () => {
    const allocated = allocateMultiDocumentRerankBudget(
      [
        [
          { payload: { text: "doc-a-1" }, rankScore: 0.99, score: 0.99 },
          { payload: { text: "doc-a-2" }, rankScore: 0.98, score: 0.98 },
          { payload: { text: "doc-a-3" }, rankScore: 0.97, score: 0.97 },
        ],
        [{ payload: { text: "doc-b-1" }, rankScore: 0.4, score: 0.4 }],
        [{ payload: { text: "doc-c-1" }, rankScore: 0.3, score: 0.3 }],
      ],
      3,
    );

    expect(allocated.map((item) => item.payload.text)).toEqual(["doc-a-1", "doc-b-1", "doc-c-1"]);
  });

  test("builds structured input and table-row-window prefers embeddingText", () => {
    expect(
      rerankDisplayText({
        chunkType: "table-row-window",
        embeddingText: "设备编码=A-1",
        fileName: "资产.xlsx",
        headingPath: ["设备清单"],
        headers: ["设备编码", "设备名称"],
        keywords: ["A-1"],
        text: "行范围: 1-1",
      }),
    ).toBe("[file] 资产.xlsx\n[section] 设备清单\n[headers] 设备编码 | 设备名称\n[keywords] A-1\n[content]\n设备编码=A-1");
    expect(rerankDisplayText({ chunkType: "paragraph", text: "body" })).toBe("[content]\nbody");
  });

  test("normalizes only recognized OCR-split GB/DL identifiers", () => {
    expect(normalizeStandardIdentifiers("GB / T1 3 8 6 9 用电安全导则")).toBe("GB/T 13869 用电安全导则");
    expect(normalizeStandardIdentifiers("DL / T1 4 7 6 工器具")).toBe("DL/T 1476 工器具");
    expect(normalizeStandardIdentifiers("GB5 0 0 1 6 防火规范")).toBe("GB 50016 防火规范");
    expect(normalizeStandardIdentifiers("供用 电合同保持原样")).toBe("供用 电合同保持原样");
  });

  test("marks missing model result as rerank score zero", async () => {
    const port: RerankPort = {
      async rerank(): Promise<RerankResultItem[]> {
        return [{ index: 0, relevanceScore: 0.9 }];
      },
    };
    const ranked = await modelRerankOnce({
      candidates: [
        { payload: { text: "returned" }, rankScore: 0.8, score: 0.8 },
        { payload: { text: "missing" }, rankScore: 0.7, score: 0.7 },
      ],
      inputTopN: 2,
      modelCode: "qwen3-rerank",
      query: "q",
      rerankPort: port,
      tenant: 1,
    });

    expect(ranked[1]?.payload.text).toBe("missing");
    expect(ranked[1]?.modelRerankScore).toBe(0);
    expect(ranked[1]?.rankScore).toBe(0);
  });

  test("clampRerankScore keeps scores in [0,1]", () => {
    expect(clampRerankScore(-1)).toBe(0);
    expect(clampRerankScore(1.5)).toBe(1);
    expect(clampRerankScore(0.1234567)).toBe(0.123457);
  });
});
