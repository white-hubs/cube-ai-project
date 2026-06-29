import { describe, expect, test } from "bun:test";

import { type SearchItem } from "../modules/common/document-types";
import { type RetrievalService } from "../modules/vector-store/services/retrieval.service";
import {
  KnowledgeQueryPortImpl,
  mapKbIdsToDirectoryIds,
  mapSearchItemToKnowledgeHit,
  mapTenantToProjectId,
} from "./knowledge-query.port-impl";

describe("KnowledgeQueryPort mapping", () => {
  test("maps tenant to tenantId string", () => {
    expect(mapTenantToProjectId(9)).toBe("9");
  });

  test("maps kbIds to unique directory ids", () => {
    expect(mapKbIdsToDirectoryIds(["kb-a", "kb-b", "kb-a"])).toEqual(["kb-a", "kb-b"]);
  });

  test("maps SearchItem to KnowledgeHit using text and rankScore", () => {
    const item: SearchItem = {
      chunkId: "doc-1-0",
      chunkIndex: 0,
      chunkType: "paragraph",
      documentId: "doc-1",
      fileName: "guide.pdf",
      headingPath: ["Intro"],
      pageNo: 1,
      rankScore: 0.82,
      score: 0.5,
      sectionId: "s1",
      sourceType: "pdf",
      text: "aggregated snippet text",
      vectorScore: 0.4,
    };

    expect(mapSearchItemToKnowledgeHit(item, "dir-1")).toEqual({
      docId: "doc-1",
      kbId: "dir-1",
      link: undefined,
      score: 0.82,
      snippet: "aggregated snippet text",
      title: "guide.pdf",
    });
  });

  test("query delegates to retrievalService.searchByDirectory per kbId", async () => {
    const calls: { directoryId: string; similarityThreshold: number }[] = [];
    const retrievalService = {
      searchByDirectory: async (params: { query: string; topK: number; directoryId: string; similarityThreshold?: number }) => {
        calls.push({
          directoryId: params.directoryId,
          similarityThreshold: params.similarityThreshold ?? 0,
        });
        return {
          items: [
            {
              chunkId: `${params.directoryId}-0`,
              chunkIndex: 0,
              chunkType: "paragraph",
              documentId: "doc-1",
              fileName: "f.pdf",
              headingPath: [],
              orderInSection: 0,
              pageNo: null,
              rankScore: 0.91,
              score: 0.9,
              sectionId: "s",
              sourceType: "pdf",
              text: "body",
              vectorScore: 0.9,
            },
          ],
        };
      },
    } as unknown as RetrievalService;

    const port = new KnowledgeQueryPortImpl(retrievalService);
    const resp = await port.query(
      {
        kbIds: ["dir-a", "dir-b"],
        query: "hello world",
        scoreThreshold: 0.3,
        tenant: 42,
        topK: 3,
        traceId: "tr",
      },
      new AbortController().signal,
    );

    expect(calls).toEqual([
      { directoryId: "dir-a", similarityThreshold: 0.3 },
      { directoryId: "dir-b", similarityThreshold: 0.3 },
    ]);
    expect(resp.hits).toHaveLength(2);
    expect(resp.hits[0]?.kbId).toBe("dir-a");
  });
});
