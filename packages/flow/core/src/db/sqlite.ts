import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { SnowflakeUtil } from "@cube-ai/ai-center/platform/server-base";
type MergeSources<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer R) => void ? R : never;

function mergeObject<T extends object, S extends readonly object[]>(target: T, ...sources: S): T & MergeSources<S[number]> {
  const clone = { ...target } as T & MergeSources<S[number]>;
  return Object.assign(clone, ...sources);
}

/** 与 MySQL 审计列一致；INSERT 可使用 DEFAULT，通过 `Omit<..., keyof AuditColumns>` 不要求调用方传入 */
export interface AuditColumns {
  create_by: string;
  creator_id: string | null;
  creator_type: string | null;
  update_by: string;
  updater_id: string | null;
  updater_type: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  langflow_flow_id TEXT,
  binding_status TEXT NOT NULL DEFAULT 'pending',
  cube_revision INTEGER NOT NULL DEFAULT 0,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  lf_snapshot_json TEXT,
  tenant_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS flow_graphs (
  flow_id TEXT PRIMARY KEY,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playground_sessions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  title TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  user_id TEXT,
  chat_history TEXT,
  last_message TEXT,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playground_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  seq INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES playground_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playground_messages_session ON playground_messages(session_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_playground_one_default_per_flow ON playground_sessions(flow_id) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS custom_component_templates (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  dsl_json TEXT NOT NULL,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS webhook_invocations (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  source TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_webhook_invocations_flow ON webhook_invocations(flow_id, create_time);

CREATE TABLE IF NOT EXISTS app_kv (
  key TEXT PRIMARY KEY,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  value_json TEXT NOT NULL
);
`;

export type FlowRow = AuditColumns & {
  id: string;
  name: string;
  description: string;
  langflow_flow_id: string | null;
  binding_status: string;
  cube_revision: number;
  create_time: string;
  update_time: string;
  lf_snapshot_json: string | null;
  tenant_id: string;
};

export type PlaygroundSessionRow = AuditColumns & {
  id: string;
  flow_id: string;
  title: string | null;
  is_default: number;
  user_id?: string | null;
  chat_history?: string | null;
  last_message?: string | null;
  create_time: string;
  update_time: string;
};

export type PlaygroundMessageRow = AuditColumns & {
  id: string;
  session_id: string;
  role: string;
  content: string;
  seq: number;
  create_time: string;
  update_time: string;
};

export type CustomComponentTemplateRow = AuditColumns & {
  id: string;
  display_name: string;
  dsl_json: string;
  create_time: string;
  update_time: string;
  tenant_id: string;
};

export class FlowRepository {
  constructor(public readonly db: Database) {
    this.db.run(SCHEMA);
    this.migrateLegacyTimestampColumns();
    this.migrateRevokedAtToDeleted();
    this.migrateAuditColumns();
    this.migrateTenantIdColumns();
    this.migratePlaygroundSessionColumns();
  }

  /** 通过路径打开（或创建）SQLite 数据库并初始化仓储。 */
  static open(dbPath: string): FlowRepository {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath, { create: true });
    db.run("PRAGMA journal_mode=WAL");
    db.run("PRAGMA foreign_keys=ON");
    return new FlowRepository(db);
  }

  /**
   * 存量 SQLite 库升级：将 tenant_id 列重命名为 tenant_id（ADR-0012 addendum）。
   * 新建库直接使用 SCHEMA 中的 tenant_id，此方法仅用于存量库平滑升级。
   */
  private migrateTenantIdColumns(): void {
    const tryRun = (sql: string) => {
      try {
        this.db.run(sql);
      } catch {
        /* ignore */
      }
    };
    const renamePidToTid = (table: string) => {
      const cols = this.tableColumnNames(table);
      if (cols.has("tenant_id") && !cols.has("tenant_id")) {
        tryRun(`ALTER TABLE ${table} RENAME COLUMN tenant_id TO tenant_id`);
      } else if (!cols.has("tenant_id") && cols.size > 0) {
        tryRun(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''`);
      }
    };
    for (const t of ["flows", "custom_component_templates", "webhook_invocations"]) {
      renamePidToTid(t);
    }
    const flowsCols = this.tableColumnNames("flows");
    if (flowsCols.has("tenant_id")) {
      tryRun(`CREATE INDEX IF NOT EXISTS idx_flows_tenant ON flows(tenant_id)`);
    }
  }

  /** 旧库 `revoked_at` → `deleted`（毫秒时间戳），并补齐 `update_time`。 */
  private migrateRevokedAtToDeleted(): void {
    const tryAdd = (sql: string) => {
      try {
        this.db.run(sql);
      } catch {
        /* ignore */
      }
    };
    const tryDropRevoked = (table: string) => {
      if (!this.tableColumnNames(table).has("revoked_at")) {
        return;
      }
      try {
        this.db.run(`ALTER TABLE ${table} DROP COLUMN revoked_at`);
      } catch {
        /* ignore */
      }
    };
    const migrateTable = (table: string) => {
      let cols = this.tableColumnNames(table);
      if (!cols.has("deleted")) {
        tryAdd(`ALTER TABLE ${table} ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cols.has("update_time")) {
        tryAdd(`ALTER TABLE ${table} ADD COLUMN update_time TEXT NOT NULL DEFAULT ''`);
      }
      this.db.run(`UPDATE ${table} SET update_time = create_time WHERE update_time = '' OR update_time IS NULL`);
      cols = this.tableColumnNames(table);
      if (!cols.has("revoked_at")) {
        return;
      }
      const rows = this.db.query(`SELECT id, revoked_at FROM ${table} WHERE revoked_at IS NOT NULL`).all() as {
        id: string;
        revoked_at: string;
      }[];
      for (const r of rows) {
        const ms = Date.parse(r.revoked_at);
        const del = Number.isFinite(ms) ? ms : Date.now();
        this.db.run(`UPDATE ${table} SET deleted = ? WHERE id = ?`, [del, r.id]);
      }
      tryDropRevoked(table);
    };
    for (const table of ["flows", "playground_sessions", "playground_messages", "custom_component_templates", "webhook_invocations"]) {
      migrateTable(table);
    }
  }

  /** 存量库补齐与 MySQL 一致的审计列，以及 flow_graphs / messages 等表的 `create_time`/`update_time`。 */
  private migrateAuditColumns(): void {
    const tryAdd = (sql: string) => {
      try {
        this.db.run(sql);
      } catch {
        /* ignore */
      }
    };
    const addAudit = (table: string) => {
      if (this.tableColumnNames(table).size === 0) {
        return;
      }
      const c = this.tableColumnNames(table);
      if (!c.has("create_by")) {
        tryAdd(`ALTER TABLE ${table} ADD COLUMN create_by TEXT NOT NULL DEFAULT 'system'`);
      }
      if (!c.has("creator_id")) {
        tryAdd(`ALTER TABLE ${table} ADD COLUMN creator_id TEXT`);
      }
      if (!c.has("creator_type")) {
        tryAdd(`ALTER TABLE ${table} ADD COLUMN creator_type TEXT`);
      }
      if (!c.has("update_by")) {
        tryAdd(`ALTER TABLE ${table} ADD COLUMN update_by TEXT NOT NULL DEFAULT 'system'`);
      }
      if (!c.has("updater_id")) {
        tryAdd(`ALTER TABLE ${table} ADD COLUMN updater_id TEXT`);
      }
      if (!c.has("updater_type")) {
        tryAdd(`ALTER TABLE ${table} ADD COLUMN updater_type TEXT`);
      }
    };
    for (const t of [
      "flows",
      "flow_graphs",
      "playground_sessions",
      "playground_messages",
      "custom_component_templates",
      "webhook_invocations",
      "app_kv",
    ]) {
      addAudit(t);
    }

    const fg = this.tableColumnNames("flow_graphs");
    if (fg.size > 0) {
      if (!fg.has("create_time")) {
        tryAdd(`ALTER TABLE flow_graphs ADD COLUMN create_time TEXT NOT NULL DEFAULT ''`);
      }
      if (!fg.has("update_time")) {
        tryAdd(`ALTER TABLE flow_graphs ADD COLUMN update_time TEXT NOT NULL DEFAULT ''`);
      }
      this.db.run(`UPDATE flow_graphs SET create_time = datetime('now') WHERE create_time = '' OR create_time IS NULL`);
      this.db.run(`UPDATE flow_graphs SET update_time = create_time WHERE update_time = '' OR update_time IS NULL`);
    }

    const pm = this.tableColumnNames("playground_messages");
    if (pm.size > 0 && !pm.has("update_time")) {
      tryAdd(`ALTER TABLE playground_messages ADD COLUMN update_time TEXT NOT NULL DEFAULT ''`);
      this.db.run(`UPDATE playground_messages SET update_time = create_time WHERE update_time = '' OR update_time IS NULL`);
    }

    const akv = this.tableColumnNames("app_kv");
    if (akv.size > 0 && !akv.has("create_time")) {
      tryAdd(`ALTER TABLE app_kv ADD COLUMN create_time TEXT NOT NULL DEFAULT ''`);
      this.db.run(`UPDATE app_kv SET create_time = update_time WHERE create_time = '' OR create_time IS NULL`);
    }
  }

  private tableColumnNames(table: string): Set<string> {
    try {
      const rows = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
      return new Set(rows.map((r) => r.name));
    } catch {
      return new Set();
    }
  }

  /** 存量库：`created_at`/`updated_at` 重命名为 `create_time`/`update_time`；`flows` 补 `create_time`。 */
  private migrateLegacyTimestampColumns(): void {
    const tryRename = (table: string, from: string, to: string) => {
      const cols = this.tableColumnNames(table);
      if (!cols.has(from) || cols.has(to)) {
        return;
      }
      try {
        this.db.run(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
      } catch {
        /* ignore */
      }
    };
    const tables = ["flows", "playground_sessions", "playground_messages", "custom_component_templates", "webhook_invocations", "app_kv"];
    for (const t of tables) {
      tryRename(t, "created_at", "create_time");
      tryRename(t, "updated_at", "update_time");
    }
    const fc = this.tableColumnNames("flows");
    if (fc.has("update_time") && !fc.has("create_time")) {
      try {
        this.db.run(`ALTER TABLE flows ADD COLUMN create_time TEXT NOT NULL DEFAULT ''`);
        this.db.run(`UPDATE flows SET create_time = update_time WHERE create_time = '' OR create_time IS NULL`);
      } catch {
        /* ignore */
      }
    }
  }

  private migratePlaygroundSessionColumns(): void {
    const tryAdd = (sql: string) => {
      try {
        this.db.run(sql);
      } catch {
        /* ignore */
      }
    };
    const cols = this.tableColumnNames("playground_sessions");
    if (!cols.has("user_id")) {
      tryAdd(`ALTER TABLE playground_sessions ADD COLUMN user_id TEXT`);
    }
    if (!cols.has("chat_history")) {
      tryAdd(`ALTER TABLE playground_sessions ADD COLUMN chat_history TEXT`);
    }
    if (!cols.has("last_message")) {
      tryAdd(`ALTER TABLE playground_sessions ADD COLUMN last_message TEXT`);
    }
  }

  createFlow(
    tenantId: string,
    row: Omit<FlowRow, "lf_snapshot_json" | "tenant_id"> & { lf_snapshot_json?: string | null },
    graphJson: string,
  ): void {
    const tx = this.db.transaction(() => {
      this.db.run(
        `INSERT INTO flows (id, name, description, langflow_flow_id, binding_status, cube_revision, create_time, update_time, lf_snapshot_json, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.name,
          row.description,
          row.langflow_flow_id,
          row.binding_status,
          row.cube_revision,
          row.create_time,
          row.update_time,
          row.lf_snapshot_json ?? null,
          tenantId,
        ],
      );
      this.db.run(`INSERT INTO flow_graphs (flow_id, graph_json, create_time, update_time) VALUES (?, ?, ?, ?)`, [
        row.id,
        graphJson,
        row.create_time,
        row.update_time,
      ]);
    });
    tx();
  }

  updateFlowMeta(
    tenantId: string,
    id: string,
    patch: Partial<Pick<FlowRow, "name" | "description" | "langflow_flow_id" | "binding_status">>,
    bumpRevision: boolean,
  ): void {
    const now = new Date().toISOString();
    const row = this.getFlow(id, tenantId);
    if (!row) {
      return;
    }
    const rev = bumpRevision ? row.cube_revision + 1 : row.cube_revision;
    this.db.run(
      `UPDATE flows SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        langflow_flow_id = COALESCE(?, langflow_flow_id),
        binding_status = COALESCE(?, binding_status),
        cube_revision = ?,
        update_time = ?,
        update_by = 'system'
      WHERE id = ? AND tenant_id = ?`,
      [patch.name ?? null, patch.description ?? null, patch.langflow_flow_id ?? null, patch.binding_status ?? null, rev, now, id, tenantId],
    );
  }

  setLfSnapshot(tenantId: string, id: string, json: string | null): void {
    const now = new Date().toISOString();
    this.db.run(`UPDATE flows SET lf_snapshot_json = ?, update_time = ?, update_by = 'system' WHERE id = ? AND tenant_id = ?`, [
      json,
      now,
      id,
      tenantId,
    ]);
  }

  updateGraph(tenantId: string, id: string, graphJson: string): void {
    const now = new Date().toISOString();
    this.db.run(`UPDATE flow_graphs SET graph_json = ?, update_time = ?, update_by = 'system' WHERE flow_id = ?`, [graphJson, now, id]);
    this.db.run(
      `UPDATE flows SET update_time = ?, cube_revision = cube_revision + 1, update_by = 'system' WHERE id = ? AND tenant_id = ?`,
      [now, id, tenantId],
    );
  }

  deleteFlow(tenantId: string, id: string): void {
    this.db.run(`DELETE FROM flows WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  }

  listFlows(tenantId?: string | null): FlowRow[] {
    if (!tenantId || tenantId.trim() === "") {
      return this.db.query("SELECT * FROM flows ORDER BY update_time DESC").all() as FlowRow[];
    }
    return this.db.query("SELECT * FROM flows WHERE tenant_id = ? ORDER BY update_time DESC").all(tenantId) as FlowRow[];
  }

  getFlow(id: string, tenantId?: string | null): FlowRow | null {
    if (!tenantId || tenantId.trim() === "") {
      const r = this.db.query("SELECT * FROM flows WHERE id = ?").get(id) as FlowRow | undefined;
      return r ?? null;
    }
    const r = this.db.query("SELECT * FROM flows WHERE id = ? AND tenant_id = ?").get(id, tenantId) as FlowRow | undefined;
    return r ?? null;
  }

  /** 执行面：按 id 解析 flow，并校验属于给定 project（用于 API Key / webhook）。 */
  getFlowInProject(id: string, tenantId: string): FlowRow | null {
    return this.getFlow(id, tenantId);
  }

  countFlowsInProject(tenantId: string): number {
    const r = this.db.query(`SELECT COUNT(1) as n FROM flows WHERE tenant_id = ?`).get(tenantId) as { n: number } | undefined;
    return r?.n ?? 0;
  }

  countCustomTemplatesInProject(tenantId: string): number {
    const r = this.db.query(`SELECT COUNT(1) as n FROM custom_component_templates WHERE tenant_id = ?`).get(tenantId) as
      | { n: number }
      | undefined;
    return r?.n ?? 0;
  }

  getGraphJson(flowId: string): string | null {
    const r = this.db.query("SELECT graph_json FROM flow_graphs WHERE flow_id = ?").get(flowId) as { graph_json: string } | undefined;
    return r?.graph_json ?? null;
  }

  // --- Playground sessions (Cube-managed; not Langflow history) ---

  getPlaygroundSession(flowId: string, sessionId: string): PlaygroundSessionRow | null {
    const r = this.db.query(`SELECT * FROM playground_sessions WHERE id = ? AND flow_id = ?`).get(sessionId, flowId) as
      | PlaygroundSessionRow
      | undefined;
    return r ?? null;
  }

  listPlaygroundSessions(flowId: string): PlaygroundSessionRow[] {
    return this.db
      .query(`SELECT * FROM playground_sessions WHERE flow_id = ? ORDER BY is_default DESC, update_time DESC`)
      .all(flowId) as PlaygroundSessionRow[];
  }

  /** Ensure one default session per flow; returns its id. */
  ensurePlaygroundDefaultSession(flowId: string): string {
    const row = this.db.query(`SELECT id FROM playground_sessions WHERE flow_id = ? AND is_default = 1`).get(flowId) as
      | { id: string }
      | undefined;
    if (row) {
      return row.id;
    }
    const id = SnowflakeUtil.nextId();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO playground_sessions (id, flow_id, title, is_default, create_time, update_time)
       VALUES (?, ?, NULL, 1, ?, ?)`,
      [id, flowId, now, now],
    );
    return id;
  }

  createPlaygroundSession(flowId: string, opts: { title?: string | null; asDefault: boolean; userId?: string | null }): string {
    const id = SnowflakeUtil.nextId();
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      if (opts.asDefault) {
        this.db.run(`UPDATE playground_sessions SET is_default = 0 WHERE flow_id = ?`, [flowId]);
      }
      this.db.run(
        `INSERT INTO playground_sessions (id, flow_id, title, is_default, user_id, chat_history, last_message, create_time, update_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, flowId, opts.title ?? null, opts.asDefault ? 1 : 0, opts.userId ?? null, null, null, now, now],
      );
    });
    tx();
    return id;
  }

  updatePlaygroundSession(
    flowId: string,
    sessionId: string,
    patch: Partial<{
      title: string | null;
      is_default: number;
      user_id: string | null;
      chat_history: string | null;
      last_message: string | null;
      update_time: string;
    }>,
  ): void {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) {
      return;
    }
    const values = keys.map((key) => patch[key] ?? null);
    const setSql = keys.map((key) => `${key} = ?`).join(", ");
    this.db.run(`UPDATE playground_sessions SET ${setSql} WHERE id = ? AND flow_id = ?`, [...values, sessionId, flowId]);
  }

  deletePlaygroundSession(flowId: string, sessionId: string): void {
    this.db.run(`DELETE FROM playground_sessions WHERE id = ? AND flow_id = ?`, [sessionId, flowId]);
  }

  countPlaygroundMessages(sessionId: string): number {
    const r = this.db.query(`SELECT COUNT(1) as n FROM playground_messages WHERE session_id = ?`).get(sessionId) as
      | { n: number }
      | undefined;
    return r?.n ?? 0;
  }

  appendPlaygroundMessage(sessionId: string, role: "user" | "bot", content: string): void {
    const now = new Date().toISOString();
    const r = this.db.query(`SELECT COALESCE(MAX(seq), -1) as m FROM playground_messages WHERE session_id = ?`).get(sessionId) as
      | { m: number }
      | undefined;
    const seq = (r?.m ?? -1) + 1;
    this.db.run(`INSERT INTO playground_messages (session_id, role, content, seq, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?)`, [
      sessionId,
      role,
      content,
      seq,
      now,
      now,
    ]);
    this.db.run(`UPDATE playground_sessions SET update_time = ?, last_message = ?, update_by = 'system' WHERE id = ?`, [
      now,
      content,
      sessionId,
    ]);
  }

  listPlaygroundMessages(sessionId: string): PlaygroundMessageRow[] {
    const raw = this.db.query(`SELECT * FROM playground_messages WHERE session_id = ? ORDER BY seq ASC`).all(sessionId) as (Omit<
      PlaygroundMessageRow,
      "id"
    > & { id: number | string })[];
    return raw.map((r) => mergeObject({}, r, { id: String(r.id) }));
  }

  /**
   * After graph persist: if default session has messages, demote it and create a new empty default.
   */
  archiveDefaultPlaygroundSession(flowId: string, demotedTitle: string): void {
    const def = this.db.query(`SELECT id FROM playground_sessions WHERE flow_id = ? AND is_default = 1`).get(flowId) as
      | { id: string }
      | undefined;
    if (!def) {
      this.ensurePlaygroundDefaultSession(flowId);
      return;
    }
    const n = this.countPlaygroundMessages(def.id);
    if (n === 0) {
      return;
    }
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db.run(
        `UPDATE playground_sessions SET is_default = 0, title = COALESCE(NULLIF(TRIM(title), ''), ?), update_time = ?, update_by = 'system'
         WHERE id = ?`,
        [demotedTitle, now, def.id],
      );
      const nid = SnowflakeUtil.nextId();
      this.db.run(
        `INSERT INTO playground_sessions (id, flow_id, title, is_default, create_time, update_time)
         VALUES (?, ?, NULL, 1, ?, ?)`,
        [nid, flowId, now, now],
      );
    });
    tx();
  }

  listCustomComponentTemplates(tenantId?: string | null): CustomComponentTemplateRow[] {
    if (!tenantId || tenantId.trim() === "") {
      return this.db.query(`SELECT * FROM custom_component_templates ORDER BY update_time DESC`).all() as CustomComponentTemplateRow[];
    }
    return this.db
      .query(`SELECT * FROM custom_component_templates WHERE tenant_id = ? ORDER BY update_time DESC`)
      .all(tenantId) as CustomComponentTemplateRow[];
  }

  getCustomComponentTemplate(id: string, tenantId?: string | null): CustomComponentTemplateRow | null {
    if (!tenantId || tenantId.trim() === "") {
      const r = this.db.query(`SELECT * FROM custom_component_templates WHERE id = ?`).get(id) as CustomComponentTemplateRow | undefined;
      return r ?? null;
    }
    const r = this.db.query(`SELECT * FROM custom_component_templates WHERE id = ? AND tenant_id = ?`).get(id, tenantId) as
      | CustomComponentTemplateRow
      | undefined;
    return r ?? null;
  }

  insertCustomComponentTemplate(
    tenantId: string,
    row: Omit<CustomComponentTemplateRow, "create_time" | "update_time" | "tenant_id" | keyof AuditColumns>,
  ): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO custom_component_templates (id, display_name, dsl_json, create_time, update_time, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.display_name, row.dsl_json, now, now, tenantId],
    );
  }

  updateCustomComponentTemplate(
    tenantId: string,
    id: string,
    patch: Partial<Pick<CustomComponentTemplateRow, "display_name" | "dsl_json">>,
  ): void {
    const row = this.getCustomComponentTemplate(id, tenantId);
    if (!row) {
      return;
    }
    const now = new Date().toISOString();
    const displayName = patch.display_name ?? row.display_name;
    const dsl = patch.dsl_json ?? row.dsl_json;
    this.db.run(
      `UPDATE custom_component_templates SET display_name = ?, dsl_json = ?, update_time = ?, update_by = 'system' WHERE id = ? AND tenant_id = ?`,
      [displayName, dsl, now, id, tenantId],
    );
  }

  deleteCustomComponentTemplate(tenantId: string, id: string): void {
    this.db.run(`DELETE FROM custom_component_templates WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  }

  insertWebhookInvocation(row: {
    id: string;
    flow_id: string;
    tenant_id: string;
    source: string | null;
    payload_json: string;
    status: string;
    create_time: string;
  }): void {
    const u = row.create_time;
    this.db.run(
      `INSERT INTO webhook_invocations (id, flow_id, source, payload_json, status, create_time, update_time, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.flow_id, row.source, row.payload_json, row.status, row.create_time, u, row.tenant_id],
    );
  }

  getKv(key: string): string | null {
    const row = this.db.query<{ value_json: string }, [string]>(`SELECT value_json FROM app_kv WHERE key = ?`).get(key);
    return row?.value_json ?? null;
  }

  setKv(key: string, value: unknown): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO app_kv (key, value_json, create_time, update_time) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, update_time = excluded.update_time, update_by = 'system'`,
      [key, JSON.stringify(value), now, now],
    );
  }

  deleteKv(key: string): void {
    this.db.run(`DELETE FROM app_kv WHERE key = ?`, [key]);
  }

  listKvByPrefix(prefix: string): { key: string; value_json: string }[] {
    return this.db
      .query<{ key: string; value_json: string }, [string]>(`SELECT key, value_json FROM app_kv WHERE key LIKE ? ORDER BY key`)
      .all(`${prefix}%`);
  }
}

/** @deprecated 改用 AppConfig.paths.sqlitePath，通过 DI 注入 AppConfig */
export function defaultDbPath(): string {
  const env = process.env["CUBE_AI_SQLITE_PATH"]?.trim();
  if (env) {
    return env;
  }
  return "/app/data/cube-ai.sqlite";
}

let sharedRepo: FlowRepository | null = null;

/**
 * 初始化进程级共享 FlowRepository 单例（由 FlowModule 在启动时调用一次）。
 * 已初始化时忽略重复调用，保证全进程只有一个 Database 连接。
 */
export function initSharedFlowRepository(dbPath: string): FlowRepository {
  if (!sharedRepo) {
    sharedRepo = FlowRepository.open(dbPath);
  }
  return sharedRepo;
}

/**
 * 获取共享 FlowRepository 单例。
 * 若 FlowModule 尚未初始化（如独立测试场景），则懒加载默认路径。
 */
export function getSharedFlowRepository(): FlowRepository {
  if (!sharedRepo) {
    sharedRepo = FlowRepository.open(defaultDbPath());
  }
  return sharedRepo;
}
