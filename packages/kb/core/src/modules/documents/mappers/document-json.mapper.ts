import type { ChunkingOptions, DocumentStatus, IndexStatus, ParseStatus } from "../../common/document-types";
import type { DocumentEntity } from "../infrastructure/orm/document.entity";

/**
 * HTTP 层文档对象：小驼峰，不直接暴露 ORM 实体字段名。
 */
export interface DocumentJson {
  id: string;
  tenantId: string | null;
  /** 软删除标记（序列化为字符串以兼容大整数） */
  deleted: string | null;
  createBy: string;
  creatorId: string | null;
  creatorType: string | null;
  createTime: Date;
  updateBy: string;
  updaterId: string | null;
  updaterType: string | null;
  updateTime: Date;
  name: string;
  mimeType: string;
  extension: string;
  size: number;
  storageBucket: string;
  storageKey: string;
  directoryId: string | null;
  status: DocumentStatus;
  parseStatus: ParseStatus;
  indexStatus: IndexStatus;
  errorMessage: string | null;
  /** 文档召回次数（累计） */
  recallCount: number;
  /** 正文总字符数（各分段正文长度之和） */
  charCount: number;
  /** 分段参数快照（上传/重建索引时记录） */
  chunkingOptions: {
    separator: string | null;
    chunkSize: number | null;
    chunkOverlap: number | null;
    tableChunkMode: ChunkingOptions["tableChunkMode"] | null;
    textChunkMode: ChunkingOptions["textChunkMode"] | null;
  };
}

export function documentEntityToJson(entity: DocumentEntity): DocumentJson {
  const deleted = entity.deleted;
  return {
    charCount: typeof entity.char_count === "number" ? entity.char_count : Number(entity.char_count ?? 0),
    chunkingOptions: {
      chunkOverlap:
        typeof entity.chunk_overlap === "number"
          ? entity.chunk_overlap
          : entity.chunk_overlap === null || entity.chunk_overlap === undefined
            ? null
            : Number(entity.chunk_overlap),
      chunkSize:
        typeof entity.chunk_size === "number"
          ? entity.chunk_size
          : entity.chunk_size === null || entity.chunk_size === undefined
            ? null
            : Number(entity.chunk_size),
      separator: entity.chunk_separator ?? null,
      tableChunkMode: (entity.table_chunk_mode ?? null) as ChunkingOptions["tableChunkMode"] | null,
      textChunkMode: (entity.text_chunk_mode ?? null) as ChunkingOptions["textChunkMode"] | null,
    },
    createBy: entity.create_by,
    createTime: entity.create_time,
    creatorId: entity.creator_id,
    creatorType: entity.creator_type,
    deleted: deleted === null || deleted === undefined ? null : String(deleted),
    directoryId: entity.directory_id === null || entity.directory_id === undefined ? null : String(entity.directory_id),
    errorMessage: entity.error_message,
    extension: entity.extension,
    id: String(entity.id),
    indexStatus: entity.index_status,
    mimeType: entity.mime_type,
    name: entity.name,
    parseStatus: entity.parse_status,
    recallCount: typeof entity.recall_count === "number" ? entity.recall_count : Number(entity.recall_count ?? 0),
    size: entity.size,
    status: entity.status,
    storageBucket: entity.storage_bucket,
    storageKey: entity.storage_key,
    tenantId: entity.tenant_id,
    updateBy: entity.update_by,
    updateTime: entity.update_time,
    updaterId: entity.updater_id,
    updaterType: entity.updater_type,
  };
}
