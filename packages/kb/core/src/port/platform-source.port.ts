/**
 * Seam between the kb-core ingestion pipeline and the external platform KB
 * source. Implemented by the platform-adapter layer (ai-center assembly root);
 * consumed only by PlatformSourceImportService inside kb-core.
 */

export interface PlatformKbSourceDoc {
  /** External identifier (e.g. cube2 KnowledgeBase id as string) */
  externalId: string
  fileName: string
  bytes: Uint8Array
  mimeType?: string
}

export interface PlatformKbSourcePort {
  listSourceDocs(platformKbId: string, signal?: AbortSignal): Promise<PlatformKbSourceDoc[]>
  /** 在指定平台知识库中按 file externalId 查找单个源文档。 */
  getSourceDocByExternalId(
    platformKbId: string,
    externalId: string,
    signal?: AbortSignal,
  ): Promise<PlatformKbSourceDoc | null>
  /** 仅按 cube2 file id 拉取源文档（不依赖知识库 id）。 */
  getSourceDocByFileId(externalId: string, signal?: AbortSignal): Promise<PlatformKbSourceDoc | null>
  /**
   * 将 documentId 视为 cube2 KnowledgeBase id（与 ghcloud knowledge-document-source 一致），
   * 取知识库详情中首个源文件。
   */
  getSourceDocByKnowledgeBaseId(knowledgeBaseId: string, signal?: AbortSignal): Promise<PlatformKbSourceDoc | null>
}

export const PLATFORM_KB_SOURCE_PORT_TOKEN = Symbol.for('kb.platform.source-port')
