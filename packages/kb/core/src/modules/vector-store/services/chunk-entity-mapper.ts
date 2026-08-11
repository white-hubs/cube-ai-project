import { type TextChunkRecord } from "../../common/document-types";
import { type DocumentChunkEntity } from "../infrastructure/qdrant/document-chunk.entity";

function parseJsonStringArray(raw: string | null | undefined): string[] | undefined {
  if (typeof raw !== "string" || raw.trim() === "") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return undefined;
  }
}

/** Map MySQL chunk row → TextChunkRecord for re-embed / Qdrant upsert during reconcile. */
export function documentChunkEntityToRecord(entity: DocumentChunkEntity): TextChunkRecord {
  return {
    aclGroupIds: parseJsonStringArray(entity.acl_group_ids_json),
    captionText: entity.caption_text,
    chunkId: entity.chunk_id,
    chunkIndex: entity.chunk_index,
    chunkType: entity.chunk_type as TextChunkRecord["chunkType"],
    cueIndex: entity.cue_index,
    documentId: entity.document_id,
    docCreatedAt:
      entity.doc_created_at instanceof Date
        ? entity.doc_created_at.toISOString()
        : entity.doc_created_at
          ? String(entity.doc_created_at)
          : null,
    docType: entity.doc_type,
    embeddingFingerprint: entity.embedding_fingerprint ?? undefined,
    embeddingText: entity.embedding_text,
    endTime: entity.end_time,
    fileName: entity.file_name,
    generationId: entity.generation_id,
    headers: parseJsonStringArray(entity.headers_text),
    headingPath: parseJsonStringArray(entity.heading_path) ?? [],
    keywords: parseJsonStringArray(entity.keywords_text),
    lang: entity.lang,
    orderInSection: entity.order_in_section,
    pageNo: entity.page_no,
    pictureDescription: entity.picture_description,
    propertyNamespace: entity.property_namespace,
    retrievalProfile: "semantic-qa",
    rowEnd: entity.row_end,
    rowStart: entity.row_start,
    sectionId: entity.section_id,
    sheetName: entity.sheet_name,
    sourceType: entity.source_type,
    startTime: entity.start_time,
    tableId: entity.table_id,
    tags: parseJsonStringArray(entity.tags_json),
    tenantId: entity.tenant_id,
    text: entity.text_content,
  };
}
