import { BadRequestException } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { SearchController } from "./search.controller";

class FakeRetrievalService {
  public async search(params: { query: string; topK: number; documentId?: number }) {
    return { items: [{ ...params }] };
  }

  public async searchMultiByDocuments(params: { query: string; documents: unknown[] }) {
    return { items: [{ ...params }] };
  }

  public async searchByDirectory(params: { query: string; topK: number; directoryId: number }) {
    return { items: [{ ...params }] };
  }
}

describe("SearchController", () => {
  test("rejects invalid topK and documentId for search", async () => {
    const controller = new SearchController(new FakeRetrievalService() as never);

    await expect(controller.search({ query: "hello", topK: Number.NaN })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.search({ documentId: "0", query: "hello" })).rejects.toBeInstanceOf(BadRequestException);
  });

  test("rejects invalid topK for directory search", async () => {
    const controller = new SearchController(new FakeRetrievalService() as never);

    await expect(controller.searchByDirectory({ directoryId: "1", query: "hello", topK: -1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  test("rejects invalid similarityThreshold", async () => {
    const controller = new SearchController(new FakeRetrievalService() as never);

    await expect(controller.search({ query: "hello", similarityThreshold: 1.01 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.search({ query: "hello", similarityThreshold: -0.01 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.searchByDirectory({ directoryId: "1", query: "hello", similarityThreshold: Number.NaN }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test("rejects invalid documents payload for searchByDocuments", async () => {
    const controller = new SearchController(new FakeRetrievalService() as never);

    await expect(controller.searchByDocuments({ query: "hello" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.searchByDocuments({ documents: [], query: "hello" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.searchByDocuments({
        documents: [{ documentId: "a" }, { documentId: "a" }],
        query: "hello",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.searchByDocuments({ documents: [{ documentId: "0" }], query: "hello" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.searchByDocuments({ documents: [{ documentId: "x", topK: 0 }], query: "hello" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
