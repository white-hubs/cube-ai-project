import { Module } from '@dangao/bun-server'
import { DocumentRepositoryOrm } from '../../modules/documents/infrastructure/orm/document.repository'
import { DocumentDirectoryRepositoryOrm } from '../../modules/documents/infrastructure/orm/document-directory.repository'
import { ImportJobRepositoryOrm } from '../../modules/ingestion/infrastructure/orm/import-job.repository'
import { DocumentChunkRepositoryOrm } from '../../modules/vector-store/infrastructure/qdrant/document-chunk.repository'

@Module({
  providers: [
    DocumentRepositoryOrm,
    DocumentDirectoryRepositoryOrm,
    ImportJobRepositoryOrm,
    DocumentChunkRepositoryOrm,
  ],
  exports: [
    DocumentRepositoryOrm,
    DocumentDirectoryRepositoryOrm,
    ImportJobRepositoryOrm,
    DocumentChunkRepositoryOrm,
  ],
})
export class OrmDatabaseModule {}
