export {
  AiKbModule,
  DocumentModule,
  IngestionModule,
  ObjectStorageModule,
  VectorStoreModule,
} from './modules';
export {
  PLATFORM_KB_SOURCE_PORT_TOKEN,
  type PlatformKbSourcePort,
  type PlatformKbSourceDoc,
} from './port/platform-source.port';
export {
  DOCUMENT_PLATFORM_SYNC_PORT_TOKEN,
  type DocumentPlatformSyncPort,
  type PlatformDocumentSyncContext,
  parsePlatformDocumentSyncContext,
} from './port/document-platform-sync.port';
export {
  KnowledgeQueryPortImpl,
  mapKbIdsToDirectoryIds,
  mapSearchItemToKnowledgeHit,
  mapTenantToProjectId,
} from './port/knowledge-query.port-impl';
export { APP_CONFIG_TOKEN, loadAppConfig, loadAppConfigSync, _resetAppConfigCache, type AppConfig } from './config/app.config';
export { KbDatabaseBootstrap } from './infrastructure/orm/kb-database.bootstrap';
export { KB_MYSQL_SCHEMA } from './infrastructure/orm/kb-mysql-schema';
export {
  KbMysqlDatabaseService,
  buildKbMysqlConfigFromEnv,
  createKbMysqlDatabaseServiceFromEnv,
  hasKbMysqlConfigFromEnv,
  type KbMysqlConfig,
} from './infrastructure/orm/kb-mysql-database.service';
export { RetrievalService } from './modules/vector-store/services/retrieval.service';
export { createKbTenantContextMiddleware } from './infrastructure/kb-tenant-context.middleware';
