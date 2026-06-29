import { describe, expect, test } from "bun:test";

import { OverlapTextChunker } from "./chunkers/overlap-text.chunker";
import { createOverlapTextChunker } from "./ingestion.module";

describe("createOverlapTextChunker", () => {
  test("returns an OverlapTextChunker instance synchronously", () => {
    const chunker = createOverlapTextChunker({
      ingestionChunkOverlap: 16,
      ingestionChunkSize: 128,
    });

    expect(chunker).toBeInstanceOf(OverlapTextChunker);
  });
});
