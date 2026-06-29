import { BadRequestException, NotFoundException } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { DocumentDirectoryService } from "./document-directory.service";

function makeService(
  directoryRepo: Record<string, unknown>,
  documentRepo?: Record<string, unknown>,
  documentService?: Record<string, unknown>,
): DocumentDirectoryService {
  const resolvedDocumentRepo = documentRepo ?? {
    aggregateDocumentStatsByDirectoryIds: async () => new Map(),
  };
  const resolvedDocumentService = documentService ?? {
    deleteDocument: async () => {},
  };
  return new DocumentDirectoryService(directoryRepo as never, resolvedDocumentRepo as never, resolvedDocumentService as never);
}

describe("DocumentDirectoryService", () => {
  test("createDirectory validates name and trims", async () => {
    const repo = {
      createDirectory: async (payload: { name: string; description?: string | null; icon?: string | null }) => ({
        id: "123",
        ...payload,
      }),
      findAll: async () => [],
    };

    const svc = makeService(repo);

    await expect(svc.createDirectory({ name: "" })).rejects.toBeInstanceOf(BadRequestException);
    const id = await svc.createDirectory({ name: "  dir-1  " });
    expect(id).toBe("123");
  });

  test("listDirectories maps id, name, description, icon", async () => {
    const repo = {
      createDirectory: async () => ({ id: "1" }),
      findAll: async () => [
        { description: "da", icon: "i1", id: "10", name: "a" },
        { description: null, icon: null, id: "20", name: "b" },
      ],
    };

    const svc = makeService(repo);
    const list = await svc.listDirectories();
    expect(list).toEqual([
      { description: "da", icon: "i1", id: "10", name: "a" },
      { description: null, icon: null, id: "20", name: "b" },
    ]);
  });

  test("searchDirectories supports pagination, keyword and aggregates stats", async () => {
    const repo = {
      searchDirectories: async ({ pageNumber, pageSize, keyword }: { pageNumber: number; pageSize: number; keyword: string | null }) => {
        expect(pageNumber).toBe(2);
        expect(pageSize).toBe(10);
        expect(keyword).toBe("abc");
        return {
          items: [
            {
              description: "desc1",
              icon: "https://x/icon.png",
              id: "1",
              name: "d1",
              update_time: new Date("2024-06-01T00:00:00.000Z"),
            },
            {
              description: null,
              icon: null,
              id: "2",
              name: "d2",
              update_time: new Date("2024-06-02T00:00:00.000Z"),
            },
          ],
          total: 25,
        };
      },
    };

    const statsMap = new Map([
      ["1", { documentCount: 3, totalSizeBytes: 1024 }],
      ["2", { documentCount: 0, totalSizeBytes: 0 }],
    ]);

    const documentRepo = {
      aggregateDocumentStatsByDirectoryIds: async (ids: string[]) => {
        expect(ids).toEqual(["1", "2"]);
        return statsMap;
      },
    };

    const svc = makeService(repo, documentRepo);
    const result = await svc.searchDirectories({
      keyword: "abc",
      pageNumber: 2,
      pageSize: 10,
      period: undefined,
    });

    expect(result.items).toEqual([
      {
        description: "desc1",
        documentCount: 3,
        icon: "https://x/icon.png",
        id: "1",
        name: "d1",
        totalSizeBytes: 1024,
        updateTime: new Date("2024-06-01T00:00:00.000Z"),
      },
      {
        description: null,
        documentCount: 0,
        icon: null,
        id: "2",
        name: "d2",
        totalSizeBytes: 0,
        updateTime: new Date("2024-06-02T00:00:00.000Z"),
      },
    ]);
    expect(result.total).toBe(25);
    expect(result.pages).toBe(3);
  });

  test("updateDirectory requires at least one field and returns list-shaped row", async () => {
    const directoryRepo = {
      findById: async (id: string) =>
        id === "7"
          ? {
              description: null,
              icon: null,
              id: "7",
              name: "old",
              update_time: new Date("2024-01-01T00:00:00.000Z"),
            }
          : null,
      updateDirectory: async (id: string, patch: { name?: string; description?: string | null; icon?: string | null }) => {
        expect(id).toBe("7");
        expect(patch).toEqual({ name: "new" });
        return {
          description: null,
          icon: null,
          id: "7",
          name: "new",
          update_time: new Date("2024-01-02T00:00:00.000Z"),
        };
      },
    };
    const documentRepo = {
      aggregateDocumentStatsByDirectoryIds: async () => new Map([["7", { documentCount: 2, totalSizeBytes: 99 }]]),
    };
    const svc = makeService(directoryRepo, documentRepo);
    await expect(svc.updateDirectory("7", {})).rejects.toBeInstanceOf(BadRequestException);
    const row = await svc.updateDirectory("7", { name: "new" });
    expect(row).toEqual({
      description: null,
      documentCount: 2,
      icon: null,
      id: "7",
      name: "new",
      totalSizeBytes: 99,
      updateTime: new Date("2024-01-02T00:00:00.000Z"),
    });
  });

  test("deleteDirectory removes documents then soft-deletes directory", async () => {
    const deletedDocs: string[] = [];
    const directoryRepo = {
      findById: async (id: string) => (id === "9" ? { id: "9", name: "x" } : null),
      logicalDelete: async (id: string) => {
        expect(id).toBe("9");
        return true;
      },
    };
    const documentRepo = {
      aggregateDocumentStatsByDirectoryIds: async () => new Map(),
      findIdsByDirectoryId: async (dirId: string) => {
        expect(dirId).toBe("9");
        return ["101", "102"];
      },
    };
    const documentService = {
      deleteDocument: async (docId: string) => {
        deletedDocs.push(docId);
      },
    };

    const svc = makeService(directoryRepo, documentRepo, documentService);
    const out = await svc.deleteDirectory("9");
    expect(out).toEqual({ ok: true });
    expect(deletedDocs).toEqual(["101", "102"]);
  });

  test("deleteDirectory throws when directory missing", async () => {
    const directoryRepo = {
      findById: async () => null,
    };
    const svc = makeService(directoryRepo);
    await expect(svc.deleteDirectory("missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});
