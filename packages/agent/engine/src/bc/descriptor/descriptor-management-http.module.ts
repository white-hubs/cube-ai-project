/**
 * DescriptorManagementHttpModule —— agent 管理面 HTTP 装配（ADR-0016 §8）。
 *
 * 复用 engine 同一 MySQL pool（`MYSQL_POOL_TOKEN` = `agentic.infra.mysql`，与 session/turn 同库）。
 * 无 MySQL 连接时仍可构造（repository 延迟到方法调用才校验 pool），不阻塞无库的 dev 启动。
 *
 * 「核」的装配单源在 {@link descriptorManagementServiceProvider}（`./descriptor-management.provider`）——
 * HTTP 面 / MCP 门面 / 进程内 Tool Handler 三处共用同一 factory + 候选源（ADR-0027 §8，不重复实现）。
 */
import { Module } from '@dangao/bun-server';
import { descriptorManagementServiceProvider } from './descriptor-management.provider';
import {
  libraryServiceProvider,
  listingServiceProvider,
  pluginCatalogServiceProvider,
  shelfServiceProvider,
} from './listing.provider';
import { DescriptorManagementService } from './descriptor-management.service';
import {
  DescriptorManagementController,
  DescriptorManagementLegacyController,
} from './descriptor-management.controller';
import { LibraryController, ListingController } from './listing.controller';
import { MyShelfController } from './shelf.controller';
import { PluginCatalogController } from './plugin-catalog.controller';
import { LibraryService, ListingService } from './listing.service';
import { PluginCatalogService } from './plugin-catalog.service';
import { ShelfService } from './shelf.service';

@Module({
  controllers: [
    DescriptorManagementController,
    DescriptorManagementLegacyController,
    ListingController,
    LibraryController,
    MyShelfController,
    PluginCatalogController,
  ],
  providers: [
    listingServiceProvider,
    shelfServiceProvider,
    descriptorManagementServiceProvider,
    libraryServiceProvider,
    pluginCatalogServiceProvider,
  ],
  exports: [
    DescriptorManagementService,
    ListingService,
    LibraryService,
    ShelfService,
    PluginCatalogService,
  ],
})
export class DescriptorManagementHttpModule {}
