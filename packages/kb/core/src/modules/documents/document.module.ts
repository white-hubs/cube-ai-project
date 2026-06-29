import { Module } from "@dangao/bun-server";

import { OrmDatabaseModule } from "../../infrastructure/orm/orm-database.module";
import { IngestionModule } from "../ingestion/ingestion.module";
import { PlatformSourceImportService } from "../ingestion/platform-source-import.service";
import { ObjectStorageModule } from "../object-storage/object-storage.module";
import { VectorStoreModule } from "../vector-store/vector-store.module";
import { DocumentDirectoryController } from "./controllers/document-directory.controller";
import { DocumentController } from "./controllers/document.controller";
import { PlatformDocumentSyncModule } from "./platform-document-sync.module";
import { DocumentDirectoryService } from "./services/document-directory.service";
import { DocumentService } from "./services/document.service";

@Module({
  controllers: [DocumentController, DocumentDirectoryController],
  exports: [DocumentService, PlatformSourceImportService],
  imports: [OrmDatabaseModule, ObjectStorageModule, IngestionModule, VectorStoreModule, PlatformDocumentSyncModule],
  providers: [DocumentService, DocumentDirectoryService, PlatformSourceImportService],
})
export class DocumentModule {}
