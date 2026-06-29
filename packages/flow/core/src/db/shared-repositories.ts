import mysql, { type Pool } from "mysql2/promise";

import { type AppConfig, loadAppConfig } from "@cube-ai/ai-center/platform/server-base";

import { MysqlFlowRepository, type MysqlQueryService } from "./mysql-repositories";
import { FLOW_REPOSITORY_TOKEN, type FlowRepository, type FlowRepositoryBundle } from "./repository-contracts";

interface SharedRepositoriesState {
  mode: "mysql";
  flowRepo: FlowRepository;
}

let sharedRepositories: SharedRepositoriesState | null = null;
let sharedRepositoriesPromise: Promise<FlowRepositoryBundle> | null = null;

class Mysql2FlowQueryService implements MysqlQueryService {
  private pool: Pool | null = null;

  public constructor(private readonly config: AppConfig) {}

  public async initialize(): Promise<void> {
    if (this.pool) {
      return;
    }
    this.pool = mysql.createPool({
      bigNumberStrings: true,
      connectionLimit: 10,
      database: this.config.mysqlDatabase,
      host: this.config.mysqlHost,
      password: this.config.mysqlPassword,
      port: this.config.mysqlPort,
      supportBigNumbers: true,
      timezone: "+08:00",
      user: this.config.mysqlUsername,
      waitForConnections: true,
    });
  }

  public async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.pool) {
      throw new Error("Flow MySQL connection is not initialized");
    }
    const [rows] = await this.pool.query(sql, params);
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
}

export class MysqlFlowRepositoryPlaceholder implements FlowRepository {
  constructor(private readonly db: MysqlQueryService) {
    void this.db;
  }

  private unsupported(method: string): never {
    throw new Error(`MysqlFlowRepository is not implemented yet: ${method}`);
  }

  createFlow(): void {
    this.unsupported("createFlow");
  }
  updateFlowMeta(): void {
    this.unsupported("updateFlowMeta");
  }
  setLfSnapshot(): void {
    this.unsupported("setLfSnapshot");
  }
  updateGraph(): void {
    this.unsupported("updateGraph");
  }
  deleteFlow(): void {
    this.unsupported("deleteFlow");
  }
  listFlows() {
    return this.unsupported("listFlows");
  }
  getFlow() {
    return this.unsupported("getFlow");
  }
  getFlowInProject() {
    return this.unsupported("getFlowInProject");
  }
  countFlowsInProject() {
    return this.unsupported("countFlowsInProject");
  }
  countCustomTemplatesInProject() {
    return this.unsupported("countCustomTemplatesInProject");
  }
  getGraphJson() {
    return this.unsupported("getGraphJson");
  }
  getPlaygroundSession() {
    return this.unsupported("getPlaygroundSession");
  }
  listPlaygroundSessions() {
    return this.unsupported("listPlaygroundSessions");
  }
  ensurePlaygroundDefaultSession() {
    return this.unsupported("ensurePlaygroundDefaultSession");
  }
  createPlaygroundSession() {
    return this.unsupported("createPlaygroundSession");
  }
  updatePlaygroundSession(): void {
    this.unsupported("updatePlaygroundSession");
  }
  deletePlaygroundSession(): void {
    this.unsupported("deletePlaygroundSession");
  }
  countPlaygroundMessages() {
    return this.unsupported("countPlaygroundMessages");
  }
  appendPlaygroundMessage(): void {
    this.unsupported("appendPlaygroundMessage");
  }
  listPlaygroundMessages() {
    return this.unsupported("listPlaygroundMessages");
  }
  archiveDefaultPlaygroundSession(): void {
    this.unsupported("archiveDefaultPlaygroundSession");
  }
  listCustomComponentTemplates() {
    return this.unsupported("listCustomComponentTemplates");
  }
  getCustomComponentTemplate() {
    return this.unsupported("getCustomComponentTemplate");
  }
  insertCustomComponentTemplate(): void {
    this.unsupported("insertCustomComponentTemplate");
  }
  updateCustomComponentTemplate(): void {
    this.unsupported("updateCustomComponentTemplate");
  }
  deleteCustomComponentTemplate(): void {
    this.unsupported("deleteCustomComponentTemplate");
  }
  insertWebhookInvocation(): void {
    this.unsupported("insertWebhookInvocation");
  }
  getKv() {
    return this.unsupported("getKv");
  }
  setKv(): void {
    this.unsupported("setKv");
  }
  deleteKv(): void {
    this.unsupported("deleteKv");
  }
  listKvByPrefix() {
    return this.unsupported("listKvByPrefix");
  }
}

export async function initSharedRepositories(config: AppConfig): Promise<FlowRepositoryBundle> {
  if (sharedRepositories) {
    return { flowRepo: sharedRepositories.flowRepo };
  }
  if (sharedRepositoriesPromise) {
    return sharedRepositoriesPromise;
  }

  sharedRepositoriesPromise = (async () => {
    const db = new Mysql2FlowQueryService(config);
    await db.initialize();
    const flowRepo = new MysqlFlowRepository(db);
    sharedRepositories = { flowRepo, mode: "mysql" };

    const shared = sharedRepositories;
    return { flowRepo: shared.flowRepo };
  })();

  try {
    return await sharedRepositoriesPromise;
  } finally {
    sharedRepositoriesPromise = null;
  }
}

export async function getSharedRepositories(): Promise<FlowRepositoryBundle> {
  if (sharedRepositories) {
    return { flowRepo: sharedRepositories.flowRepo };
  }
  if (sharedRepositoriesPromise) {
    return sharedRepositoriesPromise;
  }
  const config = await loadAppConfig();
  sharedRepositoriesPromise = initSharedRepositories(config);
  const result = await sharedRepositoriesPromise;
  sharedRepositoriesPromise = null;
  return result;
}

export function peekSharedRepositories(): FlowRepositoryBundle | null {
  if (!sharedRepositories) {
    return null;
  }
  return { flowRepo: sharedRepositories.flowRepo };
}

export { FLOW_REPOSITORY_TOKEN };
