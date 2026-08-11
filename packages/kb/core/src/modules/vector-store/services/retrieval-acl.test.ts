import { describe, expect, test } from "bun:test";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { RetrievalService } from "./retrieval.service";

/**
 * Dual-leg ACL wiring: RetrievalService must pass identity/filters to BOTH
 * Qdrant search and MySQL searchLexicalChunks (W4.1-H1 + H2 inseparable).
 */
describe("W4.1 retrieval dual-leg ACL wiring", () => {
  test("W4.1-H1+H2: search forwards identity+filters to vector and lexical legs", async () => {
    const vectorCalls: unknown[] = [];
    const lexicalCalls: unknown[] = [];

    const embeddingProvider = {
      async embed() {
        return [{ dense: [0.1, 0.2, 0.3], sparse: null }];
      },
    };
    const qdrantVectorRepository = {
      async search(params: unknown) {
        vectorCalls.push(params);
        return [];
      },
    };
    const documentChunkRepository = {
      async searchLexicalChunks(params: unknown) {
        lexicalCalls.push(params);
        return [];
      },
      async incrementChunkRecallCount() {},
    };
    const documentRepository = {
      async incrementRecallCount() {},
      async findIdsByDirectoryId() {
        return [];
      },
    };

    const service = new RetrievalService(
      makeMockAppConfig({ retrievalDefaultSimilarityThreshold: 0, retrievalScoreThreshold: 0 }),
      embeddingProvider as never,
      qdrantVectorRepository as never,
      documentRepository as never,
      documentChunkRepository as never,
    );

    await service.search({
      filters: { docType: "standard", tags: ["消防"] },
      identity: { groupIds: ["g-fire"] },
      query: "消防检查规范",
      topK: 3,
    });

    expect(vectorCalls).toHaveLength(1);
    expect(lexicalCalls).toHaveLength(1);
    expect(vectorCalls[0]).toMatchObject({
      filters: { docType: "standard", tags: ["消防"] },
      identity: { groupIds: ["g-fire"] },
    });
    expect(lexicalCalls[0]).toMatchObject({
      filters: { docType: "standard", tags: ["消防"] },
      identity: { groupIds: ["g-fire"] },
    });
  });

  test("W4.1-H3: authorized identity reaches both legs with metadata filter", async () => {
    const vectorCalls: unknown[] = [];
    const lexicalCalls: unknown[] = [];
    const embeddingProvider = {
      async embed() {
        return [{ dense: [0.1], sparse: null }];
      },
    };
    const service = new RetrievalService(
      makeMockAppConfig({ retrievalDefaultSimilarityThreshold: 0, retrievalScoreThreshold: 0 }),
      embeddingProvider as never,
      {
        async search(params: unknown) {
          vectorCalls.push(params);
          return [
            {
              id: "p1",
              payload: {
                chunkId: "d1-0",
                chunkIndex: 0,
                chunkType: "paragraph",
                documentId: "d1",
                fileName: "std.md",
                headingPath: [],
                sectionId: "s1",
                sourceType: "md",
                text: "authorized hit",
              },
              score: 0.9,
            },
          ];
        },
      } as never,
      {
        async incrementRecallCount() {},
        async findIdsByDirectoryId() {
          return ["d1"];
        },
      } as never,
      {
        async findByDocumentIdAndSectionId() {
          return [];
        },
        async incrementChunkRecallCount() {},
        async searchLexicalChunks(params: unknown) {
          lexicalCalls.push(params);
          return [];
        },
      } as never,
    );

    const result = await service.searchByDirectory({
      directoryId: "dir-1",
      filters: { docType: "standard" },
      identity: { userToken: JSON.stringify({ groupIds: ["eng"] }) },
      query: "authorized",
      similarityThreshold: 0,
      topK: 5,
    });

    expect(vectorCalls[0]).toMatchObject({
      filters: { docType: "standard" },
      identity: { userToken: JSON.stringify({ groupIds: ["eng"] }) },
    });
    expect(lexicalCalls[0]).toMatchObject({
      filters: { docType: "standard" },
      identity: { userToken: JSON.stringify({ groupIds: ["eng"] }) },
    });
    expect(result.items.some((item) => item.documentId === "d1")).toBe(true);
  });
});
