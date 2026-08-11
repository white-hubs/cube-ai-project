import { describe, expect, test } from "bun:test";

import {
  EMBEDDING_FINGERPRINT_ALGO_VERSION,
  computeContentChecksum,
  computeEmbeddingFingerprint,
  diffChunksByFingerprint,
} from "./embedding-fingerprint";

describe("embedding-fingerprint (W3.5)", () => {
  test("computeContentChecksum is stable sha256 hex", () => {
    const a = computeContentChecksum("hello");
    const b = computeContentChecksum(new TextEncoder().encode("hello"));
    expect(a).toHaveLength(64);
    expect(a).toBe(b);
    expect(a).not.toBe(computeContentChecksum("hello!"));
  });

  test("W3.5-H4: fingerprint includes algoVersion; bump changes hash", () => {
    const base = {
      embeddingText: "heading\nbody",
      instructionProfile: "semantic-qa",
      modelCode: "doubao-embedding-vision-251215",
    };
    const v1 = computeEmbeddingFingerprint({ ...base, algoVersion: EMBEDDING_FINGERPRINT_ALGO_VERSION });
    const v2 = computeEmbeddingFingerprint({ ...base, algoVersion: "v2" });
    expect(v1).toHaveLength(64);
    expect(v1).not.toBe(v2);
    expect(computeEmbeddingFingerprint(base)).toBe(v1);
  });

  test("fingerprint changes when modelCode or instructionProfile changes", () => {
    const base = computeEmbeddingFingerprint({
      embeddingText: "x",
      instructionProfile: "semantic-qa",
      modelCode: "model-a",
    });
    expect(
      computeEmbeddingFingerprint({
        embeddingText: "x",
        instructionProfile: "semantic-qa",
        modelCode: "model-b",
      }),
    ).not.toBe(base);
    expect(
      computeEmbeddingFingerprint({
        embeddingText: "x",
        instructionProfile: "entity-lookup",
        modelCode: "model-a",
      }),
    ).not.toBe(base);
  });

  test("diffChunksByFingerprint classifies embed / delete / unchanged", () => {
    const diff = diffChunksByFingerprint(
      [
        { chunkId: "d-0", embeddingFingerprint: "aaa" },
        { chunkId: "d-1", embeddingFingerprint: "bbb" },
        { chunkId: "d-2", embeddingFingerprint: "ccc" },
      ],
      [
        { chunkId: "d-0", embeddingFingerprint: "aaa" },
        { chunkId: "d-1", embeddingFingerprint: "bbb-changed" },
      ],
    );
    expect(diff.unchanged).toEqual(["d-0"]);
    expect(diff.toEmbed).toEqual(["d-1"]);
    expect(diff.toDelete).toEqual(["d-2"]);
  });

  test("null/missing existing fingerprint forces re-embed", () => {
    const diff = diffChunksByFingerprint(
      [{ chunkId: "d-0", embeddingFingerprint: null }],
      [{ chunkId: "d-0", embeddingFingerprint: "fp" }],
    );
    expect(diff.toEmbed).toEqual(["d-0"]);
    expect(diff.unchanged).toEqual([]);
  });
});
