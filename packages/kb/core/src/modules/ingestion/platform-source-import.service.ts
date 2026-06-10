import { Inject, Injectable } from '@dangao/bun-server'
import type { PlatformKbSourcePort } from '../../port/platform-source.port'
import { PLATFORM_KB_SOURCE_PORT_TOKEN } from '../../port/platform-source.port'
import { DocumentService } from '../documents/services/document.service'

export interface PlatformImportResult {
  imported: number
  errors: number
  errorDetails: Array<{ externalId: string; error: string }>
}

@Injectable()
export class PlatformSourceImportService {
  public constructor(
    @Inject(PLATFORM_KB_SOURCE_PORT_TOKEN) private readonly platformKbSourcePort: PlatformKbSourcePort,
    private readonly documentService: DocumentService,
  ) {}

  /**
   * Pull all source documents from the platform KB identified by `platformKbId`
   * and ingest each into the local KB directory `directoryId`.
   *
   * Errors on individual documents are collected rather than aborting the batch.
   */
  public async importFromPlatformKb(
    platformKbId: string,
    directoryId: string,
    signal?: AbortSignal,
  ): Promise<PlatformImportResult> {
    const sourceDocs = await this.platformKbSourcePort.listSourceDocs(platformKbId, signal)

    let imported = 0
    let errors = 0
    const errorDetails: Array<{ externalId: string; error: string }> = []

    for (const doc of sourceDocs) {
      try {
        const file = new File(
          [doc.bytes],
          doc.fileName,
          { type: doc.mimeType ?? 'application/octet-stream' },
        )
        await this.documentService.uploadDocument(file, directoryId, undefined, doc.externalId)
        imported++
      } catch (err: unknown) {
        errors++
        errorDetails.push({
          externalId: doc.externalId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return { imported, errors, errorDetails }
  }
}
