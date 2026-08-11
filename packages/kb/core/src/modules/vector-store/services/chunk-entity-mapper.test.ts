import { describe, expect, test } from "bun:test";

import { type DocumentChunkEntity } from "../infrastructure/qdrant/document-chunk.entity";
import { documentChunkEntityToRecord } from "./chunk-entity-mapper";

describe("documentChunkEntityToRecord", () => {
  test("preserves denormalized ACL and metadata during reconcile", () => {
    const entity = {
      acl_group_ids_json: '["engineering","support"]',
      caption_text: null,
      chunk_id: "chunk-1",
      chunk_index: 0,
      chunk_type: "paragraph",
      cue_index: null,
      doc_created_at: new Date("2026-08-10T00:00:00.000Z"),
      doc_type: "manual",
      document_id: "doc-1",
      embedding_fingerprint: "fingerprint",
      embedding_text: "heading\ntext",
      end_time: null,
      file_name: "manual.md",
      generation_id: "generation-1",
      headers_text: null,
      heading_path: '["heading"]',
      keywords_text: null,
      lang: "zh-CN",
      order_in_section: 0,
      page_no: 1,
      picture_description: null,
      property_namespace: null,
      row_end: null,
      row_start: null,
      section_id: "section-1",
      sheet_name: null,
      source_type: "md",
      start_time: null,
      table_id: null,
      tags_json: '["product"]',
      tenant_id: "tenant-1",
      text_content: "text",
    } as DocumentChunkEntity;

    const record = documentChunkEntityToRecord(entity);

    expect(record.aclGroupIds).toEqual(["engineering", "support"]);
    expect(record.docCreatedAt).toBe("2026-08-10T00:00:00.000Z");
    expect(record.docType).toBe("manual");
    expect(record.generationId).toBe("generation-1");
    expect(record.lang).toBe("zh-CN");
    expect(record.tags).toEqual(["product"]);
  });
});
