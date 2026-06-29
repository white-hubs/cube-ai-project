import { BadRequestException } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { DocumentDirectoryController } from "./document-directory.controller";

describe("DocumentDirectoryController", () => {
  test("list directories supports pagination/keyword/period", async () => {
    const directoryService = {
      searchDirectories: async (params: unknown) => {
        expect(params).toMatchObject({
          keyword: "abc",
          pageNumber: 2,
          pageSize: 10,
        });
        // period 应该被解析成 Date
        expect((params as any).period.start).toBeInstanceOf(Date);
        expect((params as any).period.end).toBeInstanceOf(Date);
        return {
          items: [
            {
              id: "1",
              name: "d1",
              description: null,
              icon: null,
              documentCount: 0,
              totalSizeBytes: 0,
              updateTime: new Date("2024-01-01T00:00:00.000Z"),
            },
          ],
          pages: 1,
          total: 1,
        };
      },
    };

    const documentService = {
      searchDocumentsByDirectory: async () => ({ items: [], pages: 0, total: 0 }),
    };

    const controller = new DocumentDirectoryController(directoryService as never, documentService as never);

    const res = await controller.list({
      keyword: "abc",
      pageNumber: 2,
      pageSize: 10,
      period: {
        endTime: "2024-01-02 00:00:00",
        startTime: "2024-01-01 00:00:00",
      },
    });

    expect(res.total).toBe(1);
    const item = res.items.at(0);
    if (!item) {
      throw new Error("missing directory item");
    }
    expect(item.id).toBe("1");
  });

  test("list directories throws on invalid pageSize", async () => {
    const controller = new DocumentDirectoryController(
      { searchDirectories: async () => ({ items: [], pages: 0, total: 0 }) } as never,
      { searchDocumentsByDirectory: async () => ({ items: [], pages: 0, total: 0 }) } as never,
    );

    await expect(
      controller.list({
        keyword: null,
        pageNumber: 1,
        pageSize: 9999,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test("list documents by directory supports pagination/keyword/period", async () => {
    const directoryService = {
      searchDirectories: async () => ({ items: [], pages: 0, total: 0 }),
    };

    const documentService = {
      searchDocumentsByDirectory: async (params: unknown) => {
        expect(params).toMatchObject({
          directoryId: "123",
          keyword: "note",
          pageNumber: 1,
          pageSize: 20,
        });
        expect((params as any).period.start).toBeInstanceOf(Date);
        expect((params as any).period.end).toBeInstanceOf(Date);
        return { items: [{ id: "1" }], pages: 1, total: 1 };
      },
    };

    const controller = new DocumentDirectoryController(directoryService as never, documentService as never);

    const res = await controller.listDocuments("123", {
      keyword: "note",
      pageNumber: 1,
      pageSize: 20,
      period: {
        endTime: "2024-01-02 00:00:00",
        startTime: "2024-01-01 00:00:00",
      },
    });

    expect(res.total).toBe(1);
    expect(res.items.at(0)?.id).toBe("1");
  });

  test("update directory delegates to directoryService (PUT and POST)", async () => {
    const updated = {
      description: null,
      documentCount: 0,
      icon: null,
      id: "7",
      name: "n",
      totalSizeBytes: 0,
      updateTime: new Date(),
    };
    const calls: unknown[][] = [];
    const directoryService = {
      updateDirectory: async (...args: unknown[]) => {
        calls.push(args);
        return updated;
      },
    };
    const documentService = {
      searchDocumentsByDirectory: async () => ({ items: [], pages: 0, total: 0 }),
    };
    const controller = new DocumentDirectoryController(directoryService as never, documentService as never);

    const putOut = await controller.update("7", { name: "new" });
    const postOut = await controller.updateByPost("7", { description: "x" });
    expect(putOut).toBe(updated);
    expect(postOut).toBe(updated);
    expect(calls).toEqual([
      ["7", { name: "new" }],
      ["7", { description: "x" }],
    ]);
  });
});
