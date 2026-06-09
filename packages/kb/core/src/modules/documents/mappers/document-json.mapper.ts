import type { ChunkingOptions, DocumentStatus, IndexStatus, ParseStatus } from '../../common/document-types'
import type { DocumentEntity } from '../infrastructure/orm/document.entity'

/**
 * HTTP 层文档对象：小驼峰，不直接暴露 ORM 实体字段名。
 */
export interface DocumentJson {
  id: string
  tenantId: string | null
  /** 软删除标记（序列化为字符串以兼容大整数） */
  deleted: string | null
  createBy: string
  creatorId: string | null
  creatorType: string | null
  createTime: Date
  updateBy: string
  updaterId: string | null
  updaterType: string | null
  updateTime: Date
  name: string
  mimeType: string
  extension: string
  size: number
  storageBucket: string
  storageKey: string
  directoryId: string | null
  status: DocumentStatus
  parseStatus: ParseStatus
  indexStatus: IndexStatus
  errorMessage: string | null
  /** 文档召回次数（累计） */
  recallCount: number
  /** 正文总字符数（各分段正文长度之和） */
  charCount: number
  /** 分段参数快照（上传/重建索引时记录） */
  chunkingOptions: {
    separator: string | null
    chunkSize: number | null
    chunkOverlap: number | null
    tableChunkMode: ChunkingOptions['tableChunkMode'] | null
    textChunkMode: ChunkingOptions['textChunkMode'] | null
  }
}

export function documentEntityToJson(entity: DocumentEntity): DocumentJson {
  const deleted = entity.deleted
  return {
    id: String(entity.id),
    tenantId: entity.project_id,
    deleted: deleted === null || deleted === undefined ? null : String(deleted),
    createBy: entity.create_by,
    creatorId: entity.creator_id,
    creatorType: entity.creator_type,
    createTime: entity.create_time,
    updateBy: entity.update_by,
    updaterId: entity.updater_id,
    updaterType: entity.updater_type,
    updateTime: entity.update_time,
    name: entity.name,
    mimeType: entity.mime_type,
    extension: entity.extension,
    size: entity.size,
    storageBucket: entity.storage_bucket,
    storageKey: entity.storage_key,
    directoryId: entity.directory_id === null || entity.directory_id === undefined ? null : String(entity.directory_id),
    status: entity.status,
    parseStatus: entity.parse_status,
    indexStatus: entity.index_status,
    errorMessage: entity.error_message,
    recallCount: typeof entity.recall_count === 'number' ? entity.recall_count : Number(entity.recall_count ?? 0),
    charCount: typeof entity.char_count === 'number' ? entity.char_count : Number(entity.char_count ?? 0),
    chunkingOptions: {
      separator: entity.chunk_separator ?? null,
      chunkSize: typeof entity.chunk_size === 'number' ? entity.chunk_size : entity.chunk_size === null || entity.chunk_size === undefined ? null : Number(entity.chunk_size),
      chunkOverlap: typeof entity.chunk_overlap === 'number' ? entity.chunk_overlap : entity.chunk_overlap === null || entity.chunk_overlap === undefined ? null : Number(entity.chunk_overlap),
      tableChunkMode: (entity.table_chunk_mode ?? null) as ChunkingOptions['tableChunkMode'] | null,
      textChunkMode: (entity.text_chunk_mode ?? null) as ChunkingOptions['textChunkMode'] | null,
    },
  }
}
