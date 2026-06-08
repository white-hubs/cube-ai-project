import { loadAppConfig, type AppConfig } from '@cube-ai/server-base'
import { type DatabaseModuleOptions, DatabaseService } from '@dangao/bun-server'
import {
  FlowRepository as SqliteFlowRepository,
  ProjectRepository as SqliteProjectRepository,
  type FlowRepositorySeedConfig,
} from './sqlite'
import {
  FLOW_REPOSITORY_TOKEN,
  PROJECT_REPOSITORY_TOKEN,
  type FlowRepository,
  type FlowRepositoryBundle,
  type ProjectRepository,
} from './repository-contracts'
import { MysqlFlowRepository, MysqlProjectRepository } from './mysql-repositories'

type SharedRepositoriesState = {
  mode: 'sqlite' | 'mysql'
  flowRepo: FlowRepository
  projectRepo: ProjectRepository
}

let _sharedRepositories: SharedRepositoriesState | null = null
let _sharedRepositoriesPromise: Promise<FlowRepositoryBundle> | null = null

function buildDatabaseOptions(config: AppConfig): DatabaseModuleOptions {
  if (config.localDev) {
    return {
      database: {
        type: 'sqlite',
        config: { path: config.paths.sqlitePath },
      },
      enableHealthCheck: false,
    }
  }
  return {
    database: {
      type: 'mysql',
      config: {
        host: config.mysqlHost,
        port: config.mysqlPort,
        database: config.mysqlDatabase,
        user: config.mysqlUsername,
        password: config.mysqlPassword,
      },
    },
    pool: {
      maxConnections: 10,
      connectionTimeout: 30000,
      retryCount: 3,
      retryDelay: 1000,
    },
    enableHealthCheck: true,
  }
}

export class MysqlFlowRepositoryPlaceholder implements FlowRepository {
  constructor(private readonly db: DatabaseService) {
    void this.db
  }

  private unsupported(method: string): never {
    throw new Error(`MysqlFlowRepository is not implemented yet: ${method}`)
  }

  createFlow(): void { this.unsupported('createFlow') }
  updateFlowMeta(): void { this.unsupported('updateFlowMeta') }
  setLfSnapshot(): void { this.unsupported('setLfSnapshot') }
  updateGraph(): void { this.unsupported('updateGraph') }
  deleteFlow(): void { this.unsupported('deleteFlow') }
  listFlows() { return this.unsupported('listFlows') }
  getFlow() { return this.unsupported('getFlow') }
  getFlowInProject() { return this.unsupported('getFlowInProject') }
  countFlowsInProject() { return this.unsupported('countFlowsInProject') }
  countApiKeysInProject() { return this.unsupported('countApiKeysInProject') }
  countCustomTemplatesInProject() { return this.unsupported('countCustomTemplatesInProject') }
  getGraphJson() { return this.unsupported('getGraphJson') }
  getPlaygroundSession() { return this.unsupported('getPlaygroundSession') }
  listPlaygroundSessions() { return this.unsupported('listPlaygroundSessions') }
  ensurePlaygroundDefaultSession() { return this.unsupported('ensurePlaygroundDefaultSession') }
  createPlaygroundSession() { return this.unsupported('createPlaygroundSession') }
  updatePlaygroundSession(): void { this.unsupported('updatePlaygroundSession') }
  deletePlaygroundSession(): void { this.unsupported('deletePlaygroundSession') }
  countPlaygroundMessages() { return this.unsupported('countPlaygroundMessages') }
  appendPlaygroundMessage(): void { this.unsupported('appendPlaygroundMessage') }
  listPlaygroundMessages() { return this.unsupported('listPlaygroundMessages') }
  archiveDefaultPlaygroundSession(): void { this.unsupported('archiveDefaultPlaygroundSession') }
  listCustomComponentTemplates() { return this.unsupported('listCustomComponentTemplates') }
  getCustomComponentTemplate() { return this.unsupported('getCustomComponentTemplate') }
  insertCustomComponentTemplate(): void { this.unsupported('insertCustomComponentTemplate') }
  updateCustomComponentTemplate(): void { this.unsupported('updateCustomComponentTemplate') }
  deleteCustomComponentTemplate(): void { this.unsupported('deleteCustomComponentTemplate') }
  insertApiKey(): void { this.unsupported('insertApiKey') }
  listApiKeys() { return this.unsupported('listApiKeys') }
  getApiKeyById() { return this.unsupported('getApiKeyById') }
  revokeApiKey(): void { this.unsupported('revokeApiKey') }
  touchApiKeyUsage(): void { this.unsupported('touchApiKeyUsage') }
  verifyApiKeyRaw() { return this.unsupported('verifyApiKeyRaw') }
  listAuthUsers() { return this.unsupported('listAuthUsers') }
  createAuthUser(): void { this.unsupported('createAuthUser') }
  updateAuthUser(): void { this.unsupported('updateAuthUser') }
  updateAuthUserPassword(): void { this.unsupported('updateAuthUserPassword') }
  deleteAuthUser(): void { this.unsupported('deleteAuthUser') }
  getAuthUserByUsername() { return this.unsupported('getAuthUserByUsername') }
  getAuthUserById() { return this.unsupported('getAuthUserById') }
  createAccessToken(): void { this.unsupported('createAccessToken') }
  createRefreshToken(): void { this.unsupported('createRefreshToken') }
  verifyAccessToken() { return this.unsupported('verifyAccessToken') }
  verifyRefreshToken() { return this.unsupported('verifyRefreshToken') }
  revokeAccessToken(): void { this.unsupported('revokeAccessToken') }
  revokeRefreshToken(): void { this.unsupported('revokeRefreshToken') }
  insertWebhookInvocation(): void { this.unsupported('insertWebhookInvocation') }
  getKv() { return this.unsupported('getKv') }
  setKv(): void { this.unsupported('setKv') }
  deleteKv(): void { this.unsupported('deleteKv') }
  listKvByPrefix() { return this.unsupported('listKvByPrefix') }
}

export class MysqlProjectRepositoryPlaceholder implements ProjectRepository {
  constructor(private readonly db: DatabaseService) {
    void this.db
  }

  private unsupported(method: string): never {
    throw new Error(`MysqlProjectRepository is not implemented yet: ${method}`)
  }

  listProjects() { return this.unsupported('listProjects') }
  getProject() { return this.unsupported('getProject') }
  allocateUniqueTenantProjectId() { return this.unsupported('allocateUniqueTenantProjectId') }
  insertProject(): void { this.unsupported('insertProject') }
  updateProject(): void { this.unsupported('updateProject') }
  deleteProject(): void { this.unsupported('deleteProject') }
  countProjects() { return this.unsupported('countProjects') }
}

export async function initSharedRepositories(
  config: AppConfig,
  seedConfig?: FlowRepositorySeedConfig,
): Promise<FlowRepositoryBundle> {
  if (_sharedRepositories) {
    return {
      flowRepo: _sharedRepositories.flowRepo,
      projectRepo: _sharedRepositories.projectRepo,
    }
  }
  if (_sharedRepositoriesPromise) return _sharedRepositoriesPromise

  _sharedRepositoriesPromise = (async () => {
    if (config.localDev) {
      const sqliteRepoRaw = SqliteFlowRepository.open(config.paths.sqlitePath, seedConfig)
      const sqliteRepo = sqliteRepoRaw as unknown as FlowRepository
      const projectRepo = new SqliteProjectRepository(sqliteRepoRaw.db)
      _sharedRepositories = { mode: 'sqlite', flowRepo: sqliteRepo, projectRepo }
    } else {
      const db = new DatabaseService(buildDatabaseOptions(config))
      await db.initialize()
      const flowRepo = new MysqlFlowRepository(db)
      await flowRepo.ensureBootstrapData(seedConfig)
      const projectRepo = new MysqlProjectRepository(db)
      _sharedRepositories = { mode: 'mysql', flowRepo, projectRepo }
    }

    const shared = _sharedRepositories
    return {
      flowRepo: shared.flowRepo,
      projectRepo: shared.projectRepo,
    }
  })()

  try {
    return await _sharedRepositoriesPromise
  } finally {
    _sharedRepositoriesPromise = null
  }
}

export async function getSharedRepositories(): Promise<FlowRepositoryBundle> {
  if (_sharedRepositories) {
    return {
      flowRepo: _sharedRepositories.flowRepo,
      projectRepo: _sharedRepositories.projectRepo,
    }
  }
  if (_sharedRepositoriesPromise) return _sharedRepositoriesPromise
  const config = await loadAppConfig()
  _sharedRepositoriesPromise = initSharedRepositories(config, {
    superAdminUsername: config.superAdminUsername,
    superAdminPassword: config.superAdminPassword,
    builtinSystemApiKey: config.builtinSystemApiKey,
  })
  const result = await _sharedRepositoriesPromise
  _sharedRepositoriesPromise = null
  return result
}

export function peekSharedRepositories(): FlowRepositoryBundle | null {
  if (!_sharedRepositories) return null
  return {
    flowRepo: _sharedRepositories.flowRepo,
    projectRepo: _sharedRepositories.projectRepo,
  }
}

export { FLOW_REPOSITORY_TOKEN, PROJECT_REPOSITORY_TOKEN }
