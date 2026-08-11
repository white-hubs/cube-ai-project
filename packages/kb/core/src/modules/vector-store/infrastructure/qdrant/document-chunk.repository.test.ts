import { type Logger } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { tenantContextAls } from "@cube-ai/tenant-context";

import { makeMockAppConfig } from "../../../../test-helpers/mock-app-config";
import { type TextChunkRecord } from "../../../common/document-types";
import {
  buildLexicalPreScoreSql,
  DocumentChunkRepositoryOrm,
  LEXICAL_FIELD_WEIGHTS,
  LEXICAL_SCORE_FIELDS,
} from "./document-chunk.repository";

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

/**
 * 模拟 MySQL：按 SQL 中的 ORDER BY / LIMIT 截断候选集。
 * 若误用旧的 ORDER BY chunk_index，高 chunk_index 高分行会在 LIMIT 外被丢掉。
 */
class LexicalOrderingFakeDatabaseService {
  public readonly calls: { sql: string; params?: unknown[] }[] = [];
  public rows: Record<string, unknown>[] = [];

  public query<T = unknown>(sql: string, params?: unknown[]): T[] {
    this.calls.push({ params, sql });
    const limit = typeof params?.at(-1) === "number" ? (params.at(-1) as number) : this.rows.length;
    const ordered = [...this.rows];
    if (sql.includes("ORDER BY ft_raw_score DESC")) {
      ordered.sort(
        (left, right) =>
          Number(right.ft_raw_score ?? 0) - Number(left.ft_raw_score ?? 0) ||
          Number(left.chunk_index ?? 0) - Number(right.chunk_index ?? 0),
      );
    } else if (sql.includes("ORDER BY lexical_pre_score DESC")) {
      ordered.sort(
        (left, right) =>
          Number(right.lexical_pre_score ?? 0) - Number(left.lexical_pre_score ?? 0) ||
          Number(left.chunk_index ?? 0) - Number(right.chunk_index ?? 0),
      );
    } else {
      ordered.sort((left, right) => Number(left.chunk_index ?? 0) - Number(right.chunk_index ?? 0));
    }
    return ordered.slice(0, limit) as T[];
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

function createRepository(
  databaseService: FakeDatabaseService | LexicalOrderingFakeDatabaseService,
  configOverrides: Parameters<typeof makeMockAppConfig>[0] = {},
): DocumentChunkRepositoryOrm {
  return new DocumentChunkRepositoryOrm(databaseService as never, fakeLogger, makeMockAppConfig(configOverrides));
}

function baseChunkRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    caption_text: null,
    chunk_type: "paragraph",
    document_id: "doc-1",
    embedding_text: "",
    end_time: null,
    headers_text: null,
    heading_path: "[]",
    keywords_text: null,
    order_in_section: 0,
    page_no: 1,
    picture_description: null,
    property_namespace: null,
    section_id: "section-1",
    sheet_name: null,
    start_time: null,
    text_content: "filler text",
    ...overrides,
  };
}

describe("DocumentChunkRepositoryOrm", () => {
  test("normalizes insert params to SQL-safe scalar values", async () => {
    const databaseService = new FakeDatabaseService();
    const repository = createRepository(databaseService);

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
    const repository = createRepository(databaseService);

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

  test("finds active-generation chunks by document id", async () => {
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
    const repository = createRepository(databaseService);

    const rows = await repository.findByDocumentId("12");
    expect(rows).toHaveLength(1);
    expect(databaseService.calls.some((call) => call.sql.includes("WHERE document_id = ?"))).toBe(true);
    expect(databaseService.calls[0]?.sql).toContain("active_generation_id");
  });

  test("findByChunkId requires and applies an explicit tenant scope", async () => {
    const databaseService = new FakeDatabaseService();
    databaseService.nextResult = [{ chunk_id: "12-0", tenant_id: "tenant-a" }];
    const repository = createRepository(databaseService);

    expect(await repository.findByChunkId("12-0")).toBeNull();
    expect(databaseService.calls).toHaveLength(0);

    const row = await tenantContextAls.run({ tenantId: "tenant-a" }, () => repository.findByChunkId("12-0"));
    expect(row?.chunk_id).toBe("12-0");
    expect(databaseService.calls.at(-1)?.sql).toContain("chunk_id = ? AND tenant_id = ?");
    expect(databaseService.calls.at(-1)?.params).toEqual(["12-0", "tenant-a"]);
  });

  test("buildLexicalPreScoreSql uses LEXICAL_FIELD_WEIGHTS as sole weight source", () => {
    const { sql, params } = buildLexicalPreScoreSql("exact-hit", ["term-a"]);
    expect(sql).toContain("CASE WHEN");
    expect(sql).not.toContain("AS lexical_pre_score");
    for (const field of LEXICAL_SCORE_FIELDS) {
      expect(sql).toContain(field);
      expect(sql).toContain(String(LEXICAL_FIELD_WEIGHTS[field].exact));
      expect(sql).toContain(String(LEXICAL_FIELD_WEIGHTS[field].term));
    }
    expect(params).toContain("%exact-hit%");
    expect(params).toContain("%term-a%");
  });

  test("W1.1-H2: high chunk_index + keywords exact hit ranks top1", async () => {
    const databaseService = new LexicalOrderingFakeDatabaseService();
    const query = "unique-keyword-phrase";
    databaseService.rows = [
      baseChunkRow({
        chunk_id: "low-0",
        chunk_index: 0,
        lexical_pre_score: 0.8,
        text_content: `mentions ${query} weakly in body`,
      }),
      baseChunkRow({
        chunk_id: "low-1",
        chunk_index: 1,
        lexical_pre_score: 0.8,
        text_content: `also ${query} in body`,
      }),
      baseChunkRow({
        chunk_id: "high-99",
        chunk_index: 99,
        keywords_text: JSON.stringify([query]),
        lexical_pre_score: LEXICAL_FIELD_WEIGHTS.keywords_text.exact,
        text_content: "unrelated filler",
      }),
    ];
    const repository = createRepository(databaseService, { lexicalCandidateLimit: 10 });

    const results = await repository.searchLexicalChunks({
      query,
      terms: [query],
      topK: 1,
    });

    const selectCall = databaseService.calls.find((call) => call.sql.includes("lexical_pre_score"));
    expect(selectCall?.sql).toContain("ORDER BY lexical_pre_score DESC");
    expect(selectCall?.sql).toContain("AS lexical_pre_score");
    expect(results).toHaveLength(1);
    expect(results[0]?.chunk_id).toBe("high-99");
    expect(results[0]?.lexical_score).toBeGreaterThan(0);
  });

  test("W1.1-H3: candidate count > limit still recalls highest-score largest chunk_index", async () => {
    const candidateLimit = 5;
    const databaseService = new LexicalOrderingFakeDatabaseService();
    const query = "needle-term-xyz";
    const fillerCount = candidateLimit + 3;
    databaseService.rows = Array.from({ length: fillerCount }, (_, index) =>
      baseChunkRow({
        chunk_id: `filler-${index}`,
        chunk_index: index,
        lexical_pre_score: 0.6,
        text_content: `filler ${query} body ${index}`,
      }),
    );
    const highIndex = fillerCount;
    databaseService.rows.push(
      baseChunkRow({
        chunk_id: "winner-tail",
        chunk_index: highIndex,
        keywords_text: JSON.stringify([query]),
        lexical_pre_score: LEXICAL_FIELD_WEIGHTS.keywords_text.exact,
        text_content: "no body match needed",
      }),
    );

    // 对照：若仍按 chunk_index ASC LIMIT，winner 会落在窗口外
    const byIndex = databaseService.rows.toSorted((left, right) => Number(left.chunk_index) - Number(right.chunk_index));
    expect(byIndex.slice(0, candidateLimit).some((row) => row.chunk_id === "winner-tail")).toBe(false);

    const repository = createRepository(databaseService, { lexicalCandidateLimit: candidateLimit });
    const results = await repository.searchLexicalChunks({
      query,
      terms: [query],
      topK: 1,
    });

    const selectCall = databaseService.calls.at(-1);
    expect(selectCall?.sql).toContain("ORDER BY lexical_pre_score DESC, chunk_index ASC LIMIT ?");
    expect(selectCall?.params?.at(-1)).toBe(candidateLimit);
    expect(results).toHaveLength(1);
    expect(results[0]?.chunk_id).toBe("winner-tail");
    expect(results[0]?.chunk_index).toBe(highIndex);
  });

  test("W1.1-H4: LIMIT uses max(topK, lexicalCandidateLimit); JS slices topK", async () => {
    const databaseService = new LexicalOrderingFakeDatabaseService();
    const query = "slice-check";
    databaseService.rows = Array.from({ length: 8 }, (_, index) =>
      baseChunkRow({
        chunk_id: `c-${index}`,
        chunk_index: index,
        keywords_text: index === 7 ? JSON.stringify([query]) : null,
        lexical_pre_score: index === 7 ? LEXICAL_FIELD_WEIGHTS.keywords_text.exact : 0.5,
        text_content: `body ${query} ${index}`,
      }),
    );
    const repository = createRepository(databaseService, { lexicalCandidateLimit: 3 });

    const results = await repository.searchLexicalChunks({
      query,
      terms: [],
      topK: 2,
    });

    const selectCall = databaseService.calls.at(-1);
    expect(selectCall?.params?.at(-1)).toBe(3);
    expect(results).toHaveLength(2);
    expect(results[0]?.chunk_id).toBe("c-7");
  });

  test("empty query and terms returns empty without SQL", async () => {
    const databaseService = new FakeDatabaseService();
    const repository = createRepository(databaseService);
    const results = await repository.searchLexicalChunks({ query: "   ", terms: [], topK: 5 });
    expect(results).toEqual([]);
    expect(databaseService.calls).toHaveLength(0);
  });

  test("documentId filter is applied in SQL", async () => {
    const databaseService = new FakeDatabaseService();
    databaseService.nextResult = [];
    const repository = createRepository(databaseService);
    await repository.searchLexicalChunks({
      documentId: "doc-only",
      query: "hello",
      terms: ["hello"],
      topK: 3,
    });
    const selectCall = databaseService.calls.at(-1);
    expect(selectCall?.sql).toContain("AND document_id = ?");
    expect(selectCall?.params).toContain("doc-only");
  });

  test("W4.1-H2: lexical search SQL always applies ACL + optional metadata filters", async () => {
    const databaseService = new FakeDatabaseService();
    databaseService.nextResult = [];
    const repository = createRepository(databaseService);
    await repository.searchLexicalChunks({
      filters: { docType: "standard", tags: ["消防"] },
      identity: { groupIds: ["g-fire"] },
      query: "secret-keyword-only-lexical",
      terms: ["secret-keyword-only-lexical"],
      topK: 5,
    });
    const selectCall = databaseService.calls.at(-1);
    expect(selectCall?.sql).toContain("JSON_OVERLAPS");
    expect(selectCall?.sql).toContain("acl_group_ids_json IS NULL");
    expect(selectCall?.sql).toContain("doc_type = ?");
    expect(selectCall?.sql).toContain("JSON_CONTAINS");
    expect(selectCall?.params).toContain(JSON.stringify(["g-fire"]));
    expect(selectCall?.params).toContain("standard");
    expect(selectCall?.params).toContain(JSON.stringify("消防"));
  });

  test("W4.1-H2: unauthorized ACL-tagged lexical-only hit is filtered by SQL (not post-merge)", async () => {
    const databaseService = new FakeDatabaseService();
    // Repository returns whatever SQL would return; with ACL in WHERE, unauthorized rows never appear.
    databaseService.nextResult = [];
    const repository = createRepository(databaseService);
    const results = await repository.searchLexicalChunks({
      identity: { groupIds: ["other-team"] },
      query: "unique-acl-secret-phrase",
      terms: ["unique-acl-secret-phrase"],
      topK: 10,
    });
    const selectCall = databaseService.calls.at(-1);
    expect(selectCall?.sql).toContain("JSON_OVERLAPS(acl_group_ids_json, CAST(? AS JSON))");
    expect(selectCall?.params).toContain(JSON.stringify(["other-team"]));
    expect(results).toEqual([]);
  });

  test("W3.4 flag off keeps LIKE path (no MATCH)", async () => {
    const databaseService = new FakeDatabaseService();
    databaseService.nextResult = [];
    const repository = createRepository(databaseService, { lexicalFulltextEnabled: false });
    await repository.searchLexicalChunks({ query: "hello", terms: ["hello"], topK: 3 });
    const selectCall = databaseService.calls.at(-1);
    expect(selectCall?.sql).toContain("lexical_pre_score");
    expect(selectCall?.sql).not.toContain("MATCH(");
    expect(selectCall?.sql).not.toContain("ft_raw_score");
  });

  test("W3.4-H1: FULLTEXT path uses MATCH + normalized lexical_score (not raw)", async () => {
    const databaseService = new LexicalOrderingFakeDatabaseService();
    const query = "fulltext-needle";
    databaseService.rows = [
      baseChunkRow({
        chunk_id: "low-ft",
        chunk_index: 0,
        ft_raw_score: 1,
        text_content: query,
      }),
      baseChunkRow({
        chunk_id: "mid-ft",
        chunk_index: 1,
        ft_raw_score: 10,
        text_content: query,
      }),
      baseChunkRow({
        chunk_id: "high-ft",
        chunk_index: 2,
        ft_raw_score: 100,
        keywords_text: JSON.stringify([query]),
        text_content: query,
      }),
    ];
    const repository = createRepository(databaseService, {
      lexicalCandidateLimit: 10,
      lexicalFulltextEnabled: true,
    });

    const results = await repository.searchLexicalChunks({ query, terms: [query], topK: 3 });
    const selectCall = databaseService.calls.at(-1);
    expect(selectCall?.sql).toContain("MATCH(text_content, embedding_text, heading_path, keywords_text, headers_text)");
    expect(selectCall?.sql).toContain("AGAINST (? IN BOOLEAN MODE)");
    expect(selectCall?.sql).toContain("AS ft_raw_score");
    expect(selectCall?.sql).toContain("ORDER BY ft_raw_score DESC");
    expect(selectCall?.sql).toContain("start_time");
    // min-max 会把窗口最低 raw 压到 0，随后被 lexical_score>0 过滤
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]?.chunk_id).toBe("high-ft");
    expect(results[0]?.lexical_score).not.toBe(100);
    expect(results[0]!.lexical_score).toBeGreaterThan(results[1]!.lexical_score);
    expect(results[0]!.lexical_score).toBeCloseTo(4 + 3.5 + 3.2 + 2.8 + 2.2, 10);
  });

  test("W3.4 short-field LIKE bonus still ranks when ft_raw is 0", async () => {
    const databaseService = new LexicalOrderingFakeDatabaseService();
    const query = "cue-mark-zz";
    databaseService.rows = [
      baseChunkRow({
        chunk_id: "time-hit",
        chunk_index: 0,
        ft_raw_score: 0,
        start_time: query,
        text_content: "unrelated",
      }),
    ];
    const repository = createRepository(databaseService, { lexicalFulltextEnabled: true });
    const results = await repository.searchLexicalChunks({
      query,
      terms: [],
      topK: 1,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.chunk_id).toBe("time-hit");
    // structured term expansion may add term weights; exact hit is always present
    expect(results[0]!.lexical_score).toBeGreaterThanOrEqual(LEXICAL_FIELD_WEIGHTS.start_time.exact);
  });
});
