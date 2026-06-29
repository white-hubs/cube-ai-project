import { describe, expect, test } from "bun:test";

import { OverlapTextChunker } from "./overlap-text.chunker";

describe("OverlapTextChunker", () => {
  test("packs adjacent paragraphs with preferred separators before length fallback", async () => {
    const chunker = new OverlapTextChunker({
      chunkOverlap: 4,
      chunkSize: 12,
    });

    const chunks = await chunker.chunkDocument({
      documentId: "3",
      fileName: "paragraphs.md",
      sourceType: "md",
      tenantId: "1",
      text: "alpha\n\nbeta\n\ngamma",
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toBe("alpha\n\nbeta");
    expect(chunks[1]?.text).toBe("gamma");
  });

  test("cleans whitespace and removes urls and emails before splitting", async () => {
    const chunker = new OverlapTextChunker({
      chunkOverlap: 10,
      chunkSize: 100,
    });

    const chunks = await chunker.chunkDocument({
      documentId: "4",
      fileName: "clean.txt",
      sourceType: "txt",
      tenantId: "2",
      text: "  Hello   world  \n\nvisit https://example.com or mail me@example.com  \n\n next\tline ",
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("Hello world\n\nvisit or mail\n\nnext line");
  });

  test("uses line separators before overlap fallback inside oversized paragraphs", async () => {
    const chunker = new OverlapTextChunker({
      chunkOverlap: 4,
      chunkSize: 12,
    });

    const chunks = await chunker.chunkDocument({
      documentId: "5",
      fileName: "lines.txt",
      sourceType: "txt",
      tenantId: "3",
      text: "line-one\nline-two\nline-three",
    });

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.text)).toEqual(["line-one", "line-two", "line-three"]);
  });

  test("supports custom separator passed by user", async () => {
    const chunker = new OverlapTextChunker({
      chunkOverlap: 0,
      chunkSize: 8,
    });

    const chunks = await chunker.chunkDocument({
      chunkingOptions: {
        separator: "###",
      } as never,
      documentId: 6,
      fileName: "custom-separator.txt",
      sourceType: "txt",
      tenantId: "3",
      text: "alpha###beta###gamma",
    } as never);

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.text)).toEqual(["alpha", "beta", "gamma"]);
  });

  test("keeps heading blocks intact in block mode", async () => {
    const chunker = new OverlapTextChunker({
      chunkOverlap: 20,
      chunkSize: 256,
    });

    const chunks = await chunker.chunkDocument({
      chunkingOptions: {
        textChunkMode: "block",
      } as never,
      documentId: "8",
      fileName: "sdk.txt",
      sourceType: "txt",
      tenantId: "1",
      text: [
        "### 指令 1",
        "",
        `切换模型时间 { action: 'changeModelTime' params: { value: 'day' } }`,
        "",
        "### 指令 2",
        "",
        `切换模型天气 { action: 'changeModelWeather' params: { value: 'Sunny' } }`,
      ].join("\n"),
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toContain("### 指令 1");
    expect(chunks[0]?.text).toContain("changeModelTime");
    expect(chunks[1]?.text).toContain("### 指令 2");
    expect(chunks[1]?.text).toContain("changeModelWeather");
  });

  test("auto-detects block mode for structured instruction lists", async () => {
    const chunker = new OverlapTextChunker({
      chunkOverlap: 20,
      chunkSize: 256,
    });

    const chunks = await chunker.chunkDocument({
      chunkingOptions: {
        textChunkMode: "auto",
      } as never,
      documentId: "9",
      fileName: "sdk.txt",
      sourceType: "txt",
      tenantId: "1",
      text: [
        "### 指令 1",
        "",
        `切换模型时间 { action: 'changeModelTime' params: { value: 'day' } }`,
        "",
        "### 指令 2",
        "",
        `切换模型天气 { action: 'changeModelWeather' params: { value: 'Sunny' } }`,
      ].join("\n"),
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toContain("### 指令 1");
    expect(chunks[1]?.text).toContain("### 指令 2");
  });

  test("merge mode can still combine short structured paragraphs", async () => {
    const chunker = new OverlapTextChunker({
      chunkOverlap: 20,
      chunkSize: 256,
    });

    const chunks = await chunker.chunkDocument({
      chunkingOptions: {
        textChunkMode: "merge",
      } as never,
      documentId: "10",
      fileName: "list.txt",
      sourceType: "txt",
      tenantId: "1",
      text: "- line one\n\n- line two",
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("- line one\n\n- line two");
  });

  test("splits long text with overlap and preserves order", async () => {
    const chunker = new OverlapTextChunker({
      chunkOverlap: 4,
      chunkSize: 12,
    });

    const chunks = await chunker.chunkDocument({
      documentId: "7",
      fileName: "demo.txt",
      sourceType: "txt",
      tenantId: "9",
      text: "abcdefghijklmnopqrstuvwx",
    });

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
    expect(chunks[0]?.text).toBe("abcdefghijkl");
    expect(chunks[1]?.text).toBe("ijklmnopqrst");
    expect(chunks[2]?.text).toBe("qrstuvwx");
    expect(chunks[1]?.documentId).toBe("7");
    expect(chunks[1]?.tenantId).toBe("9");
  });

  test("returns one chunk for short text", async () => {
    const chunker = new OverlapTextChunker({
      chunkOverlap: 10,
      chunkSize: 50,
    });

    const chunks = await chunker.chunkDocument({
      documentId: "1",
      fileName: "note.md",
      sourceType: "md",
      tenantId: null,
      text: "short text",
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("short text");
  });
});
