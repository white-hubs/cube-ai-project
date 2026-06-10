import { Module, ModuleRegistry, type Container } from '@dangao/bun-server'
import { OrmDatabaseModule } from '../../infrastructure/orm/orm-database.module'
import {
  DOCUMENT_PLATFORM_SYNC_PORT_TOKEN,
  DOCUMENT_UPLOAD_PORT_TOKEN,
  type DocumentUploadPort,
} from '../../port/document-platform-sync.port'
import { DocumentService } from './services/document.service'
import { DocumentPlatformSyncService } from './services/document-platform-sync.service'

function resolveDocumentServiceFromRegistry(): DocumentService {
  const registry = ModuleRegistry.getInstance() as unknown as {
    moduleRefs?: Map<unknown, { container: Container }>
  }
  for (const moduleRef of registry.moduleRefs?.values() ?? []) {
    if (moduleRef.container.isRegistered(DocumentService)) {
      return moduleRef.container.resolve(DocumentService) as DocumentService
    }
  }
  throw new Error('DocumentService is not registered — cannot upload synced platform document')
}

function createLazyDocumentUploadPort(): DocumentUploadPort {
  return {
    uploadDocument: (file, directoryId, chunkingOptions, presetDocumentId) =>
      resolveDocumentServiceFromRegistry().uploadDocument(
        file,
        directoryId,
        chunkingOptions,
        presetDocumentId,
      ),
  }
}

@Module({
  imports: [OrmDatabaseModule],
  providers: [
    DocumentPlatformSyncService,
    {
      provide: DOCUMENT_PLATFORM_SYNC_PORT_TOKEN,
      useExisting: DocumentPlatformSyncService,
    },
    {
      provide: DOCUMENT_UPLOAD_PORT_TOKEN,
      useFactory: () => createLazyDocumentUploadPort(),
    },
  ],
  exports: [DocumentPlatformSyncService, DOCUMENT_PLATFORM_SYNC_PORT_TOKEN, DOCUMENT_UPLOAD_PORT_TOKEN],
})
export class PlatformDocumentSyncModule {}
