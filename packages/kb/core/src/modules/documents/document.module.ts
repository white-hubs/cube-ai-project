import { Module } from '@dangao/bun-server'
import { OrmDatabaseModule } from '../../infrastructure/orm/orm-database.module'
import { IngestionModule } from '../ingestion/ingestion.module'
import { ObjectStorageModule } from '../object-storage/object-storage.module'
import { VectorStoreModule } from '../vector-store/vector-store.module'
import { DocumentController } from './controllers/document.controller'
import { DocumentDirectoryController } from './controllers/document-directory.controller'
import { DocumentService } from './services/document.service'
import { DocumentDirectoryService } from './services/document-directory.service'

@Module({
  imports: [OrmDatabaseModule, ObjectStorageModule, IngestionModule, VectorStoreModule],
  controllers: [DocumentController, DocumentDirectoryController],
  providers: [DocumentService, DocumentDirectoryService],
  exports: [DocumentService],
})
export class DocumentModule {}
