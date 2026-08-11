import type { DocumentEntity } from "../documents/infrastructure/orm/document.entity";
import { formatMysqlDateTimeShanghai } from "./mysql-datetime";

export type DocumentMetadataSnapshot = {
  docType: string | null;
  lang: string | null;
  tags: string[] | null;
  aclGroupIds: string[] | null;
  docCreatedAt: string | null;
  metadataJson: string | null;
};

function parseJsonStringArray(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (Array.isArray(raw)) {
    const values = raw.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
    return values.length > 0 ? values : [];
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const values = parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
    return values.length > 0 ? values : [];
  } catch {
    return null;
  }
}

function formatDocCreatedAt(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return formatMysqlDateTimeShanghai(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return null;
}

/** Snapshot document_record metadata for denormalizing onto chunks / Qdrant. */
export function documentMetadataFromEntity(
  document: Partial<Pick<DocumentEntity, "doc_type" | "lang" | "tags_json" | "acl_group_ids_json" | "metadata_json" | "create_time">>,
): DocumentMetadataSnapshot {
  return {
    aclGroupIds: parseJsonStringArray(document.acl_group_ids_json),
    docCreatedAt: formatDocCreatedAt(document.create_time),
    docType: typeof document.doc_type === "string" && document.doc_type.trim() !== "" ? document.doc_type.trim() : null,
    lang: typeof document.lang === "string" && document.lang.trim() !== "" ? document.lang.trim() : null,
    metadataJson: typeof document.metadata_json === "string" ? document.metadata_json : null,
    tags: parseJsonStringArray(document.tags_json),
  };
}

export function serializeStringArrayJson(values: string[] | null | undefined): string | null {
  if (values === null || values === undefined) {
    return null;
  }
  return JSON.stringify(values);
}
