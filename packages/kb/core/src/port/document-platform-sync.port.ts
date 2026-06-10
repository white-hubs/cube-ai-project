import type { ChunkingOptions } from '../modules/common/document-types'

/** 本地缺失文档时，从平台拉取并摄入所需的上下文。 */
export interface PlatformDocumentSyncContext {
  /** cube2 知识库 id（numeric string） */
  platformKbId?: string
  /** 本地目录 id；未传时回退为 platformKbId，再回退为 documentId */
  directoryId?: string
  chunkingOptions?: ChunkingOptions
}

export interface DocumentPlatformSyncPort {
  ensureDocumentAvailable(documentId: string, syncContext?: PlatformDocumentSyncContext): Promise<void>
}

/** Lazy upload seam — breaks DocumentService ↔ DocumentPlatformSyncService circular DI. */
export interface DocumentUploadPort {
  uploadDocument(
    file: File,
    directoryId: string,
    chunkingOptions?: ChunkingOptions,
    presetDocumentId?: string,
  ): Promise<{ documentId: string }>
}

export const DOCUMENT_PLATFORM_SYNC_PORT_TOKEN = Symbol.for('kb.document.platform-sync-port')
export const DOCUMENT_UPLOAD_PORT_TOKEN = Symbol.for('kb.document.upload-port')

export function parsePlatformDocumentSyncContext(
  payload: Record<string, unknown>,
  chunkingOptions?: ChunkingOptions,
): PlatformDocumentSyncContext | undefined {
  const platformKbId = typeof payload.platformKbId === 'string' ? payload.platformKbId.trim() : ''
  const directoryId = typeof payload.directoryId === 'string' ? payload.directoryId.trim() : ''
  const hasChunking = chunkingOptions !== undefined
  if (!platformKbId && !directoryId && !hasChunking) {
    return undefined
  }
  return {
    ...(platformKbId ? { platformKbId } : {}),
    ...(directoryId ? { directoryId } : {}),
    ...(hasChunking ? { chunkingOptions } : {}),
  }
}
