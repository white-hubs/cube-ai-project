import { describe, expect, test } from "bun:test";

import { normalizeEmbeddingText } from "./embedding-text-normalizer";

describe("normalizeEmbeddingText", () => {
  test("normalizes semantic qa chunks with heading path labels", () => {
    const text = normalizeEmbeddingText({
      chunkType: "paragraph",
      displayText: "系统通过规则引擎降低误报并提升复核效率。",
      embeddingText: "Doc title\n系统通过规则引擎降低误报并提升复核效率。",
      headingPath: ["Doc title", "方案说明"],
      sourceType: "pdf",
    });

    expect(text).toBe("标题路径: Doc title > 方案说明\n正文: 系统通过规则引擎降低误报并提升复核效率。");
  });

  test("keeps specialized table chunks intact", () => {
    const original = "第1行: 设备编码=5d10--35; 设备名称=研发中心6号265VBRS";
    const text = normalizeEmbeddingText({
      chunkType: "table-row-window",
      displayText: original,
      embeddingText: original,
      headingPath: ["可靠性分析"],
      sourceType: "xlsx",
    });

    expect(text).toBe(original);
  });
});
