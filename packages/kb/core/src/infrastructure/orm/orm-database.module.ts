import { Module } from "@dangao/bun-server";

import { DocumentDirectoryRepositoryOrm } from "../../modules/documents/infrastructure/orm/document-directory.repository";
import { DocumentRepositoryOrm } from "../../modules/documents/infrastructure/orm/document.repository";
import { ImportJobRepositoryOrm } from "../../modules/ingestion/infrastructure/orm/import-job.repository";
import { DocumentChunkRepositoryOrm } from "../../modules/vector-store/infrastructure/qdrant/document-chunk.repository";

@Module({
  exports: [DocumentRepositoryOrm, DocumentDirectoryRepositoryOrm, ImportJobRepositoryOrm, DocumentChunkRepositoryOrm],
  providers: [DocumentRepositoryOrm, DocumentDirectoryRepositoryOrm, ImportJobRepositoryOrm, DocumentChunkRepositoryOrm],
})
export class OrmDatabaseModule {}
