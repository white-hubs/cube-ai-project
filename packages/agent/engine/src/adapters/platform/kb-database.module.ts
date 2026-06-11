import {
  DATABASE_SERVICE_TOKEN,
  DatabaseService,
  Global,
  Inject,
  Injectable,
  Module,
  type Container,
  type OnModuleInit,
} from '@dangao/bun-server';
import {
  KB_MYSQL_SCHEMA,
  PLATFORM_KB_SOURCE_PORT_TOKEN,
  createKbMysqlDatabaseServiceFromEnv,
  hasKbMysqlConfigFromEnv,
  type PlatformKbSourceDoc,
  type PlatformKbSourcePort,
} from '@cube-ai/kb-core';

/**
 * Engine 独立进程缺少 ai-center 的 `AiCenterKbHttpModule`（@Global 提供
 * `DATABASE_SERVICE_TOKEN` 与 `PLATFORM_KB_SOURCE_PORT_TOKEN`），导致 kb
 * 仓储/同步链（KbPlatformModule → VectorStoreModule → *RepositoryOrm /
 * DocumentPlatformSyncService）在 standalone 模式解析失败。
 * 本模块为 engine 进程补齐同一组全局 token；无 MySQL 配置时跳过初始化，
 * 保持离线 boot 可用（首次真正查询时由仓储报"未初始化"）。
 */
export class NoopPlatformKbSourcePort implements PlatformKbSourcePort {
  private fail(): never {
    throw Object.assign(
      new Error('Platform KB source is not wired in engine standalone (ai-center only)'),
      { name: 'AgenticPlatformNotConnectedError', code: 'PLATFORM_KB_SOURCE_NOT_CONNECTED' },
    );
  }
  async listSourceDocs(): Promise<PlatformKbSourceDoc[]> {
    this.fail();
  }
  async getSourceDocByExternalId(): Promise<PlatformKbSourceDoc | null> {
    this.fail();
  }
  async getSourceDocByFileId(): Promise<PlatformKbSourceDoc | null> {
    this.fail();
  }
  async getSourceDocByKnowledgeBaseId(): Promise<PlatformKbSourceDoc | null> {
    this.fail();
  }
}

@Injectable()
export class EngineKbDatabaseBootstrap implements OnModuleInit {
  public constructor(
    @Inject(DATABASE_SERVICE_TOKEN) private readonly databaseService: DatabaseService,
  ) {}

  public async onModuleInit(): Promise<void> {
    if (!hasKbMysqlConfigFromEnv()) return;
    await this.databaseService.initialize();
    for (const sql of KB_MYSQL_SCHEMA.split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0)) {
      await this.databaseService.query(sql);
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_SERVICE_TOKEN,
      useFactory: () => createKbMysqlDatabaseServiceFromEnv(),
    },
    {
      provide: DatabaseService,
      useFactory: (container: Container) =>
        container.resolve(DATABASE_SERVICE_TOKEN) as DatabaseService,
    },
    EngineKbDatabaseBootstrap,
    {
      provide: PLATFORM_KB_SOURCE_PORT_TOKEN,
      useFactory: () => new NoopPlatformKbSourcePort(),
    },
  ],
  exports: [DATABASE_SERVICE_TOKEN, DatabaseService, PLATFORM_KB_SOURCE_PORT_TOKEN],
})
export class KbDatabaseModule {}
