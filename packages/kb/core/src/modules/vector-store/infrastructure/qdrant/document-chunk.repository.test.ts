import { type Logger } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { type TextChunkRecord } from "../../../common/document-types";
import { DocumentChunkRepositoryOrm } from "./document-chunk.repository";

class FakeDatabaseService {
  public readonly calls: { sql: string; params?: unknown[] }[] = [];
  public nextResult: unknown[] = [];

  public query<T = unknown>(sql: string, params?: unknown[]): T[] {
    this.calls.push({ params, sql });

    for (const value of params ?? []) {
      if (value === null) {
        continue;
      }
      if (value instanceof Date) {
        continue;
      }
      if (Array.isArray(value)) {
        throw new TypeError(`array parameter is not SQL-safe: ${JSON.stringify(value)}`);
      }
      if (typeof value === "bigint") {
        throw new TypeError(`bigint parameter is not SQL-safe: ${String(value)}`);
      }
      if (value === undefined) {
        throw new TypeError("undefined parameter is not SQL-safe");
      }
      if (typeof value === "object") {
        throw new TypeError(`object parameter is not SQL-safe: ${JSON.stringify(value)}`);
      }
    }

    return this.nextResult as T[];
  }
}

const fakeLogger: Logger = {
  debug() {},
  error() {},
  info() {},
  log() {},
  trace() {},
  warn() {},
} as unknown as Logger;

describe("DocumentChunkRepositoryOrm", () => {
  test("normalizes insert params to SQL-safe scalar values", async () => {
    const databaseService = new FakeDatabaseService();
    const repository = new DocumentChunkRepositoryOrm(databaseService as never, fakeLogger);

    const chunks: TextChunkRecord[] = [
      {
        captionText: null,
        chunkId: "12-0",
        chunkIndex: 0,
        chunkType: "paragraph",
        cueIndex: null,
        documentId: "12",
        embeddingText: "embedding text",
        endTime: null,
        fileName: "demo.pdf",
        headers: ["Title"],
        headingPath: ["Title"],
        keywords: ["Title", "display"],
        orderInSection: 0,
        pageNo: 1,
        pictureDescription: { detail: "object should be normalized" } as never,
        propertyNamespace: null,
        rowEnd: 1,
        rowStart: 1,
        sectionId: "section-1",
        sheetName: "SheetA",
        sourceType: "pdf",
        startTime: null,
        tableId: "table-0",
        tenantId: null,
        text: "display text",
      },
    ];

    await repository.replaceDocumentChunks("12", chunks);

    const insertCall = databaseService.calls.find((call) => call.sql.startsWith("INSERT INTO document_chunk"));
    expect(insertCall).toBeDefined();
    expect(insertCall?.params).toBeArray();
    expect(insertCall?.sql).toContain("sheet_name");
    expect(insertCall?.params?.some((value) => typeof value === "bigint")).toBe(false);
    expect(insertCall?.params?.some((value) => value === undefined)).toBe(false);
    expect(insertCall?.params?.some((value) => typeof value === "object" && value !== null && !(value instanceof Date))).toBe(false);
  });

  test("replaces existing chunks without duplicate chunk_id conflicts", async () => {
    const databaseService = new FakeDatabaseService();
    const repository = new DocumentChunkRepositoryOrm(databaseService as never, fakeLogger);

    const chunks: TextChunkRecord[] = [
      {
        captionText: null,
        chunkId: "12-0",
        chunkIndex: 0,
        chunkType: "paragraph",
        cueIndex: null,
        documentId: "12",
        embeddingText: "embedding text",
        endTime: null,
        fileName: "demo.pdf",
        headers: undefined,
        headingPath: ["Title"],
        keywords: undefined,
        orderInSection: 0,
        pageNo: 1,
        pictureDescription: null,
        propertyNamespace: null,
        rowEnd: null,
        rowStart: null,
        sectionId: "section-1",
        sheetName: null,
        sourceType: "pdf",
        startTime: null,
        tableId: null,
        tenantId: null,
        text: "display text",
      },
    ];

    await repository.replaceDocumentChunks("12", chunks);
    await repository.replaceDocumentChunks("12", chunks);

    const deleteCalls = databaseService.calls.filter((call) => call.sql.startsWith("DELETE FROM document_chunk"));
    const insertCalls = databaseService.calls.filter((call) => call.sql.startsWith("INSERT INTO document_chunk"));
    expect(deleteCalls).toHaveLength(2);
    expect(insertCalls).toHaveLength(2);
    expect(databaseService.calls.some((call) => call.sql.startsWith("UPDATE document_chunk SET deleted = ?"))).toBe(false);
  });

  test("finds chunks by document id and updates a single chunk safely", async () => {
    const databaseService = new FakeDatabaseService();
    databaseService.nextResult = [
      {
        caption_text: null,
        chunk_id: "12-0",
        chunk_index: 0,
        chunk_type: "paragraph",
        document_id: "12",
        embedding_text: "heading\ntext",
        heading_path: '["heading"]',
        order_in_section: 0,
        page_no: 1,
        picture_description: null,
        section_id: "section-1",
        text_content: "text",
      },
    ];
    const repository = new DocumentChunkRepositoryOrm(databaseService as never, fakeLogger);

    const rows = await repository.findByDocumentId("12");
    await repository.updateDocumentChunk({
      captionText: null,
      chunkId: "12-0",
      chunkIndex: 0,
      chunkType: "paragraph",
      cueIndex: null,
      documentId: "12",
      embeddingText: "heading\nedited",
      endTime: null,
      fileName: "demo.pdf",
      headers: undefined,
      headingPath: ["heading"],
      keywords: undefined,
      orderInSection: 0,
      pageNo: 1,
      pictureDescription: null,
      propertyNamespace: null,
      rowEnd: null,
      rowStart: null,
      sectionId: "section-1",
      sheetName: null,
      sourceType: "pdf",
      startTime: null,
      tableId: null,
      tenantId: null,
      text: "edited",
    });

    expect(rows).toHaveLength(1);
    expect(databaseService.calls.some((call) => call.sql.includes("WHERE document_id = ?"))).toBe(true);
    expect(databaseService.calls.some((call) => call.sql.startsWith("UPDATE document_chunk SET text_content = ?"))).toBe(true);
  });
});
