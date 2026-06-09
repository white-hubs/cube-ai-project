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
}

export const PLATFORM_KB_SOURCE_PORT_TOKEN = Symbol.for('kb.platform.source-port')
