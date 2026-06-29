import { describe, expect, test } from "bun:test";

import { resolveChunkRetrievalProfile, resolveQueryRetrievalProfile } from "./retrieval-profile";

describe("resolveQueryRetrievalProfile", () => {
  test("classifies entity lookup queries", () => {
    expect(resolveQueryRetrievalProfile("研发中心3号265CBRS")).toBe("entity-lookup");
    expect(resolveQueryRetrievalProfile("LYY-12F-JK-006_D")).toBe("entity-lookup");
  });

  test("classifies navigation queries", () => {
    expect(resolveQueryRetrievalProfile("第3章 系统架构")).toBe("navigation");
    expect(resolveQueryRetrievalProfile("目录")).toBe("navigation");
  });

  test("classifies timeline queries", () => {
    expect(resolveQueryRetrievalProfile("00:02:10")).toBe("timeline");
  });

  test("defaults to semantic qa for natural language questions", () => {
    expect(resolveQueryRetrievalProfile("系统如何处理告警误报")).toBe("semantic-qa");
  });
});

describe("resolveChunkRetrievalProfile", () => {
  test("classifies structured chunks by chunkType", () => {
    expect(
      resolveChunkRetrievalProfile({
        chunkType: "table-row-window",
        sourceType: "xlsx",
        text: "第1行: 设备名称=广播",
      }),
    ).toBe("entity-lookup");

    expect(
      resolveChunkRetrievalProfile({
        chunkType: "properties-group",
        sourceType: "properties",
        text: "db.url=jdbc:mysql://localhost/app",
      }),
    ).toBe("entity-lookup");

    expect(
      resolveChunkRetrievalProfile({
        chunkType: "vtt-cue-window",
        sourceType: "vtt",
        text: "[00:00:00.000 --> 00:00:02.000] Hello team",
      }),
    ).toBe("timeline");
  });

  test("classifies short heading-centric markdown chunks as navigation", () => {
    expect(
      resolveChunkRetrievalProfile({
        chunkType: "paragraph",
        headingPath: ["总体设计", "部署架构"],
        sourceType: "md",
        text: "部署架构概览",
      }),
    ).toBe("navigation");
  });

  test("defaults regular paragraphs to semantic qa", () => {
    expect(
      resolveChunkRetrievalProfile({
        chunkType: "paragraph",
        headingPath: ["总体设计"],
        sourceType: "pdf",
        text: "系统通过规则引擎与模型协同降低误报并提升复核效率。",
      }),
    ).toBe("semantic-qa");
  });
});
