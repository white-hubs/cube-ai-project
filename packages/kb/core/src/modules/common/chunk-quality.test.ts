import { describe, expect, test } from "bun:test";

import { assessChunkQuality, createChunkQualityPolicy, isIndexableChunk, isLowQualityChunkText, isRetrievableChunk } from "./chunk-quality";

describe("chunk-quality policy", () => {
  test("rejects unknown placeholders and empty text as non-indexable noise", () => {
    expect(isLowQualityChunkText("")).toBe(true);
    expect(isLowQualityChunkText("<unknown>")).toBe(true);
    expect(isIndexableChunk({ text: "<unknown>", embeddingText: "标题路径: 封面\n正文: <unknown>" })).toBe(false);

    const unknown = assessChunkQuality({ text: "<unknown>", pageNo: 1 });
    expect(unknown).toMatchObject({
      indexable: false,
      qualityScore: 0,
      reasons: ["placeholder_unknown"],
      retrievableByDefault: false,
      role: "noise",
    });
  });

  test("rejects TOC leader dots as noise", () => {
    const tocDots = assessChunkQuality({
      headingPath: ["目次"],
      text: "…………………………………………………………………………………………………… 1 4",
    });
    expect(tocDots.indexable).toBe(false);
    expect(tocDots.reasons).toContain("toc_leader");
    expect(tocDots.role).toBe("noise");
  });

  test("marks cover/toc roles soft-non-retrievable while keeping substantive body retrievable", () => {
    const body = assessChunkQuality({
      headingPath: ["规范性引用文件"],
      text: "下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。",
    });
    expect(body).toMatchObject({
      indexable: true,
      retrievableByDefault: true,
      role: "body",
    });
    expect(body.qualityScore).toBeGreaterThanOrEqual(0.9);

    const cover = assessChunkQuality({
      pageNo: 1,
      text: "冷库安全规程",
    });
    expect(cover.role).toBe("cover");
    expect(cover.indexable).toBe(true);
    expect(cover.retrievableByDefault).toBe(false);
    expect(cover.reasons).toContain("cover_page");

    const tocSection = assessChunkQuality({
      headingPath: ["目 次"],
      text: "1 范围\n2 规范性引用文件\n3 术语和定义",
    });
    expect(tocSection.role).toBe("toc");
    expect(tocSection.indexable).toBe(true);
    expect(tocSection.retrievableByDefault).toBe(false);
  });

  test("policy thresholds are configurable", () => {
    const strict = createChunkQualityPolicy({ minMeaningfulChars: 20 });
    const shortText = "短文本条款内容";
    expect(isIndexableChunk({ text: shortText })).toBe(true);
    expect(isIndexableChunk({ text: shortText }, strict)).toBe(false);

    const cover = assessChunkQuality({ pageNo: 1, text: "冷库安全规程" });
    expect(cover.indexable).toBe(true);
    expect(isRetrievableChunk(cover)).toBe(false);
  });

  test("prefers persisted retrievableByDefault when present", () => {
    expect(
      isRetrievableChunk({
        retrievableByDefault: false,
        text: "下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。",
      }),
    ).toBe(false);
    expect(
      isRetrievableChunk({
        qualityScore: 0.9,
        retrievableByDefault: true,
        text: "条款",
      }),
    ).toBe(true);
  });
});
