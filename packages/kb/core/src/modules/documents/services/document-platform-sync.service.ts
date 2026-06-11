import { HttpException, Inject, Injectable, LOGGER_TOKEN, NotFoundException, type Logger } from '@dangao/bun-server'
import type {
  PlatformDocumentSyncContext,
  DocumentPlatformSyncPort,
  DocumentUploadPort,
} from '../../../port/document-platform-sync.port'
import { DOCUMENT_UPLOAD_PORT_TOKEN } from '../../../port/document-platform-sync.port'
import type { PlatformKbSourceDoc } from '../../../port/platform-source.port'
import type { PlatformKbSourcePort } from '../../../port/platform-source.port'
import { PLATFORM_KB_SOURCE_PORT_TOKEN } from '../../../port/platform-source.port'
import { DocumentRepositoryOrm } from '../infrastructure/orm/document.repository'
function resolveDirectoryId(documentId: string, syncContext?: PlatformDocumentSyncContext): string {
  const directoryId = syncContext?.directoryId?.trim()
  if (directoryId) {
    return directoryId
  }
  const platformKbId = syncContext?.platformKbId?.trim()
  if (platformKbId) {
    return platformKbId
  }
  return documentId
}

function toPlatformSyncHttpException(err: unknown): HttpException | null {
  if (err instanceof HttpException || err instanceof NotFoundException) {
    return null
  }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'ConnectError') {
    return new HttpException(
      401,
      `platform document sync failed: ${message}. Configure CUBE2_INTERNAL_INVOKE_SECRET_KEY (16 bytes), forward tenant/authorization on the inbound request, or OUAA client_credentials (CUBE2_OUAA_* / OUAA_REGISTRATION_*).`,
    )
  }
  if (/not authenticated/i.test(message)) {
    return new HttpException(
      401,
      `platform document sync auth failed: ${message}. Configure CUBE2_INTERNAL_INVOKE_SECRET_KEY, forward tenant/authorization, or OUAA client_credentials.`,
    )
  }
  if (/cube2-(file|content)-client:/.test(message)) {
    return new HttpException(
      503,
      `${message}. Platform document sync requires cube2 gRPC endpoint env (NACOS_ADDRESS or CUBE2_*_SERVICE_BASE_URL).`,
    )
  }
  if (/Provider not found for token:/.test(message)) {
    return new HttpException(
      503,
      `document platform sync DI misconfiguration: ${message}. Ensure DocumentModule registers DOCUMENT_UPLOAD_PORT_TOKEN.`,
    )
  }
  return null
}

@Injectable()
export class DocumentPlatformSyncService implements DocumentPlatformSyncPort {
  public constructor(
    private readonly documentRepository: DocumentRepositoryOrm,
    @Inject(PLATFORM_KB_SOURCE_PORT_TOKEN) private readonly platformKbSourcePort: PlatformKbSourcePort,
    @Inject(DOCUMENT_UPLOAD_PORT_TOKEN) private readonly documentUploadPort: DocumentUploadPort,
    @Inject(LOGGER_TOKEN) private readonly logger: Logger,
  ) {}

  public async ensureDocumentAvailable(
    documentId: string,
    syncContext?: PlatformDocumentSyncContext,
  ): Promise<void> {
    const normalizedDocumentId = documentId.trim()
    if (!normalizedDocumentId) {
      throw new NotFoundException('document not found: empty id')
    }

    const existing = await this.documentRepository.findById(normalizedDocumentId)
    if (existing) {
      return
    }

    let sourceDoc: PlatformKbSourceDoc | null
    try {
      sourceDoc = await this.fetchSourceDoc(normalizedDocumentId, syncContext)
    } catch (err: unknown) {
      this.logger.error(
        'platform document sync failed while fetching source document',
        {
          documentId: normalizedDocumentId,
          syncContext,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : { thrown: String(err) },
        },
      )
      const mapped = toPlatformSyncHttpException(err)
      if (mapped) {
        throw mapped
      }
      throw err
    }
    if (!sourceDoc) {
      throw new NotFoundException(`document not found: ${normalizedDocumentId}`)
    }

    const directoryId = resolveDirectoryId(normalizedDocumentId, syncContext)
    const file = new File(
      [sourceDoc.bytes],
      sourceDoc.fileName,
      { type: sourceDoc.mimeType ?? 'application/octet-stream' },
    )
    await this.documentUploadPort.uploadDocument(
      file,
      directoryId,
      syncContext?.chunkingOptions,
      normalizedDocumentId,
    )
  }

  private async fetchSourceDoc(
    documentId: string,
    syncContext?: PlatformDocumentSyncContext,
  ): Promise<PlatformKbSourceDoc | null> {
    const platformKbId = syncContext?.platformKbId?.trim()
    if (platformKbId) {
      const fromKbFile = await this.platformKbSourcePort.getSourceDocByExternalId(platformKbId, documentId)
      if (fromKbFile) {
        return fromKbFile
      }
    }

    const fromKnowledgeBase = await this.platformKbSourcePort.getSourceDocByKnowledgeBaseId(documentId)
    if (fromKnowledgeBase) {
      return fromKnowledgeBase
    }

    return this.platformKbSourcePort.getSourceDocByFileId(documentId)
  }
}
