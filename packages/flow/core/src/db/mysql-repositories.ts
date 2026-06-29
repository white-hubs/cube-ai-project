import { Injectable } from "@dangao/bun-server";

import { SnowflakeUtil } from "@cube-ai/ai-center/platform/server-base";
import { currentTenantId, isGlobalAccessEnabled } from "@cube-ai/tenant-context";

import { type FlowRepository } from "./repository-contracts";
import {
  type AuditColumns,
  type CustomComponentTemplateRow,
  type FlowRow,
  type PlaygroundMessageRow,
  type PlaygroundSessionRow,
} from "./sqlite";

export interface MysqlQueryService {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] | Promise<T[]>;
}

function deletedValue(): number {
  return Date.now();
}

function formatMysqlDateTimeShanghai(date: Date = new Date()): string {
  return date.toLocaleString("sv-SE", {
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}

function normalizeDateValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value);
}

function normalizeAudit(row: Record<string, unknown>): AuditColumns {
  return {
    create_by: String(row["create_by"] ?? "system"),
    creator_id:
      row["creator_id"] === null || row["creator_id"] === undefined || row["creator_id"] === "" ? null : String(row["creator_id"]),
    creator_type:
      row["creator_type"] === null || row["creator_type"] === undefined || row["creator_type"] === "" ? null : String(row["creator_type"]),
    update_by: String(row["update_by"] ?? "system"),
    updater_id:
      row["updater_id"] === null || row["updater_id"] === undefined || row["updater_id"] === "" ? null : String(row["updater_id"]),
    updater_type:
      row["updater_type"] === null || row["updater_type"] === undefined || row["updater_type"] === "" ? null : String(row["updater_type"]),
  };
}

function normalizeFlowRow(row: Record<string, unknown>): FlowRow {
  return {
    ...normalizeAudit(row),
    binding_status: String(row["binding_status"] ?? "pending"),
    create_time: normalizeDateValue(row["create_time"]) ?? "",
    cube_revision: Number(row["cube_revision"] ?? 0),
    description: String(row["description"] ?? ""),
    id: String(row["id"]),
    langflow_flow_id: row["langflow_flow_id"] === null || row["langflow_flow_id"] === undefined ? null : String(row["langflow_flow_id"]),
    lf_snapshot_json: row["lf_snapshot_json"] === null || row["lf_snapshot_json"] === undefined ? null : String(row["lf_snapshot_json"]),
    name: String(row["name"]),
    tenant_id: String(row["tenant_id"] ?? ""),
    update_time: normalizeDateValue(row["update_time"]) ?? "",
  };
}

function normalizePlaygroundSessionRow(row: Record<string, unknown>): PlaygroundSessionRow {
  return {
    ...normalizeAudit(row),
    chat_history: row["chat_history"] === null || row["chat_history"] === undefined ? null : String(row["chat_history"]),
    create_time: normalizeDateValue(row["create_time"]) ?? "",
    flow_id: String(row["flow_id"]),
    id: String(row["id"]),
    is_default: Number(row["is_default"] ?? 0),
    last_message: row["last_message"] === null || row["last_message"] === undefined ? null : String(row["last_message"]),
    title: row["title"] === null || row["title"] === undefined ? null : String(row["title"]),
    update_time: normalizeDateValue(row["update_time"]) ?? "",
    user_id: row["user_id"] === null || row["user_id"] === undefined ? null : String(row["user_id"]),
  };
}

function normalizePlaygroundMessageRow(row: Record<string, unknown>): PlaygroundMessageRow {
  return {
    ...normalizeAudit(row),
    content: String(row["content"]),
    create_time: normalizeDateValue(row["create_time"]) ?? "",
    id: String(row["id"]),
    role: String(row["role"]),
    seq: Number(row["seq"]),
    session_id: String(row["session_id"]),
    update_time: normalizeDateValue(row["update_time"]) ?? "",
  };
}

function normalizeTemplateRow(row: Record<string, unknown>): CustomComponentTemplateRow {
  return {
    ...normalizeAudit(row),
    create_time: normalizeDateValue(row["create_time"]) ?? "",
    display_name: String(row["display_name"]),
    dsl_json: String(row["dsl_json"]),
    id: String(row["id"]),
    tenant_id: String(row["tenant_id"] ?? ""),
    update_time: normalizeDateValue(row["update_time"]) ?? "",
  };
}

class MysqlRepositoryBase {
  constructor(protected readonly databaseService: MysqlQueryService) {}

  protected async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = this.databaseService.query<T>(sql, params);
    const rows = result instanceof Promise ? await result : result;
    return Array.isArray(rows) ? rows : [];
  }

  protected async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.q<T>(sql, params);
    return rows[0] ?? null;
  }

  protected async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.q(sql, params);
  }

  protected projectScopeColumn(alias = ""): { sql: string; params: unknown[] } {
    if (isGlobalAccessEnabled()) {
      return { sql: "", params: [] };
    }
    const pid = currentTenantId()?.trim();
    if (!pid) {
      return { sql: "", params: [] };
    }
    const prefix = alias ? `${alias}.` : "";
    return { params: [pid], sql: `${prefix}tenant_id = ?` };
  }
}

@Injectable()
export class MysqlFlowRepository extends MysqlRepositoryBase implements FlowRepository {
  public async createFlow(
    tenantId: string,
    row: Omit<FlowRow, "lf_snapshot_json" | "tenant_id"> & { lf_snapshot_json?: string | null },
    graphJson: string,
  ): Promise<void> {
    const now = formatMysqlDateTimeShanghai();
    await this.exec(
      `INSERT INTO flows
      (id, tenant_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, name, description, langflow_flow_id, binding_status, cube_revision, lf_snapshot_json)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        tenantId,
        now,
        now,
        row.name,
        row.description,
        row.langflow_flow_id,
        row.binding_status,
        row.cube_revision,
        row.lf_snapshot_json ?? null,
      ],
    );
    await this.exec(
      `INSERT INTO flow_graphs
      (flow_id, tenant_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, graph_json)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?)`,
      [row.id, tenantId, now, now, graphJson],
    );
  }

  public async updateFlowMeta(
    tenantId: string,
    id: string,
    patch: Partial<Pick<FlowRow, "name" | "description" | "langflow_flow_id" | "binding_status">>,
    bumpRevision: boolean,
  ): Promise<void> {
    const row = await this.getFlow(id, tenantId);
    if (!row) {
      return;
    }
    const rev = bumpRevision ? row.cube_revision + 1 : row.cube_revision;
    await this.exec(
      `UPDATE flows
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           langflow_flow_id = COALESCE(?, langflow_flow_id),
           binding_status = COALESCE(?, binding_status),
           cube_revision = ?,
           update_time = ?
       WHERE id = ? AND tenant_id = ? AND deleted = 0`,
      [
        patch.name ?? null,
        patch.description ?? null,
        patch.langflow_flow_id ?? null,
        patch.binding_status ?? null,
        rev,
        formatMysqlDateTimeShanghai(),
        id,
        tenantId,
      ],
    );
  }

  public async setLfSnapshot(tenantId: string, id: string, json: string | null): Promise<void> {
    await this.exec("UPDATE flows SET lf_snapshot_json = ?, update_time = ? WHERE id = ? AND tenant_id = ? AND deleted = 0", [
      json,
      formatMysqlDateTimeShanghai(),
      id,
      tenantId,
    ]);
  }

  public async updateGraph(tenantId: string, id: string, graphJson: string): Promise<void> {
    const now = formatMysqlDateTimeShanghai();
    await this.exec("UPDATE flow_graphs SET graph_json = ?, update_time = ? WHERE flow_id = ? AND tenant_id = ? AND deleted = 0", [
      graphJson,
      now,
      id,
      tenantId,
    ]);
    await this.exec("UPDATE flows SET cube_revision = cube_revision + 1, update_time = ? WHERE id = ? AND tenant_id = ? AND deleted = 0", [
      now,
      id,
      tenantId,
    ]);
  }

  public async deleteFlow(tenantId: string, id: string): Promise<void> {
    const del = deletedValue();
    const now = formatMysqlDateTimeShanghai();
    await this.exec("UPDATE flows SET deleted = ?, update_time = ? WHERE id = ? AND tenant_id = ? AND deleted = 0", [
      del,
      now,
      id,
      tenantId,
    ]);
    await this.exec("UPDATE flow_graphs SET deleted = ?, update_time = ? WHERE flow_id = ? AND tenant_id = ? AND deleted = 0", [
      del,
      now,
      id,
      tenantId,
    ]);
    await this.exec("UPDATE playground_sessions SET deleted = ?, update_time = ? WHERE flow_id = ? AND tenant_id = ? AND deleted = 0", [
      del,
      now,
      id,
      tenantId,
    ]);
    await this.exec(
      "UPDATE playground_messages SET deleted = ?, update_time = ? WHERE session_id IN (SELECT id FROM playground_sessions WHERE flow_id = ? AND tenant_id = ?) AND deleted = 0",
      [del, now, id, tenantId],
    );
  }

  public async listFlows(tenantId?: string | null): Promise<FlowRow[]> {
    const params: unknown[] = [];
    let sql = "SELECT * FROM flows WHERE deleted = 0";
    if (tenantId && tenantId.trim() !== "") {
      sql += " AND tenant_id = ?";
      params.push(tenantId);
    }
    sql += " ORDER BY update_time DESC";
    return (await this.q<Record<string, unknown>>(sql, params)).map((value) => normalizeFlowRow(value));
  }

  public async getFlow(id: string, tenantId?: string | null): Promise<FlowRow | null> {
    const params: unknown[] = [id];
    let sql = "SELECT * FROM flows WHERE id = ? AND deleted = 0";
    if (tenantId && tenantId.trim() !== "") {
      sql += " AND tenant_id = ?";
      params.push(tenantId);
    }
    const row = await this.one<Record<string, unknown>>(sql, params);
    return row ? normalizeFlowRow(row) : null;
  }

  public async getFlowInProject(id: string, tenantId: string): Promise<FlowRow | null> {
    return this.getFlow(id, tenantId);
  }

  public async countFlowsInProject(tenantId: string): Promise<number> {
    const row = await this.one<{ n: number }>("SELECT COUNT(1) AS n FROM flows WHERE tenant_id = ? AND deleted = 0", [tenantId]);
    return row?.n ?? 0;
  }

  public async countCustomTemplatesInProject(tenantId: string): Promise<number> {
    const row = await this.one<{ n: number }>("SELECT COUNT(1) AS n FROM custom_component_templates WHERE tenant_id = ? AND deleted = 0", [
      tenantId,
    ]);
    return row?.n ?? 0;
  }

  public async getGraphJson(flowId: string): Promise<string | null> {
    const row = await this.one<{ graph_json: string }>("SELECT graph_json FROM flow_graphs WHERE flow_id = ? AND deleted = 0", [flowId]);
    return row?.graph_json ?? null;
  }

  public async getPlaygroundSession(flowId: string, sessionId: string): Promise<PlaygroundSessionRow | null> {
    const row = await this.one<Record<string, unknown>>("SELECT * FROM playground_sessions WHERE id = ? AND flow_id = ? AND deleted = 0", [
      sessionId,
      flowId,
    ]);
    return row ? normalizePlaygroundSessionRow(row) : null;
  }

  public async listPlaygroundSessions(flowId: string): Promise<PlaygroundSessionRow[]> {
    return (
      await this.q<Record<string, unknown>>(
        "SELECT * FROM playground_sessions WHERE flow_id = ? AND deleted = 0 ORDER BY is_default DESC, update_time DESC",
        [flowId],
      )
    ).map((value) => normalizePlaygroundSessionRow(value));
  }

  public async ensurePlaygroundDefaultSession(flowId: string): Promise<string> {
    const row = await this.one<{ id: string }>(
      "SELECT id FROM playground_sessions WHERE flow_id = ? AND is_default = 1 AND deleted = 0 LIMIT 1",
      [flowId],
    );
    if (row?.id) {
      return row.id;
    }
    const created = await this.createPlaygroundSession(flowId, { asDefault: true, title: null });
    return created;
  }

  public async createPlaygroundSession(
    flowId: string,
    opts: { title?: string | null; asDefault: boolean; userId?: string | null },
  ): Promise<string> {
    const flow = await this.getFlow(flowId, null);
    if (!flow) {
      throw new Error(`flow not found: ${flowId}`);
    }
    const id = SnowflakeUtil.nextId();
    const now = formatMysqlDateTimeShanghai();
    if (opts.asDefault) {
      await this.exec("UPDATE playground_sessions SET is_default = 0, update_time = ? WHERE flow_id = ? AND deleted = 0", [now, flowId]);
    }
    await this.exec(
      `INSERT INTO playground_sessions
      (id, tenant_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, flow_id, title, user_id, is_default, chat_history, last_message)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [id, flow.tenant_id, now, now, flowId, opts.title ?? null, opts.userId ?? null, opts.asDefault ? 1 : 0, null, null],
    );
    return id;
  }

  public async updatePlaygroundSession(
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
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if ("title" in patch) {
      sets.push("title = ?");
      params.push(patch.title ?? null);
    }
    if ("is_default" in patch) {
      sets.push("is_default = ?");
      params.push(patch.is_default ?? 0);
    }
    if ("user_id" in patch) {
      sets.push("user_id = ?");
      params.push(patch.user_id ?? null);
    }
    if ("chat_history" in patch) {
      sets.push("chat_history = ?");
      params.push(patch.chat_history ?? null);
    }
    if ("last_message" in patch) {
      sets.push("last_message = ?");
      params.push(patch.last_message ?? null);
    }
    sets.push("update_time = ?");
    params.push(formatMysqlDateTimeShanghai());
    if (sets.length === 1) {
      return;
    }
    await this.exec(`UPDATE playground_sessions SET ${sets.join(", ")} WHERE id = ? AND flow_id = ? AND deleted = 0`, [
      ...params,
      sessionId,
      flowId,
    ]);
  }

  public async deletePlaygroundSession(flowId: string, sessionId: string): Promise<void> {
    const del = deletedValue();
    const now = formatMysqlDateTimeShanghai();
    await this.exec("UPDATE playground_sessions SET deleted = ?, update_time = ? WHERE id = ? AND flow_id = ? AND deleted = 0", [
      del,
      now,
      sessionId,
      flowId,
    ]);
    await this.exec("UPDATE playground_messages SET deleted = ?, update_time = ? WHERE session_id = ? AND deleted = 0", [
      del,
      now,
      sessionId,
    ]);
  }

  public async countPlaygroundMessages(sessionId: string): Promise<number> {
    const row = await this.one<{ n: number }>("SELECT COUNT(1) AS n FROM playground_messages WHERE session_id = ? AND deleted = 0", [
      sessionId,
    ]);
    return row?.n ?? 0;
  }

  public async appendPlaygroundMessage(sessionId: string, role: "user" | "bot", content: string): Promise<void> {
    const session = await this.one<Record<string, unknown>>("SELECT tenant_id FROM playground_sessions WHERE id = ? AND deleted = 0", [
      sessionId,
    ]);
    const tenantId = session ? String(session["tenant_id"]) : "";
    const now = formatMysqlDateTimeShanghai();
    const seqRow = await this.one<{ m: number }>(
      "SELECT COALESCE(MAX(seq), -1) AS m FROM playground_messages WHERE session_id = ? AND deleted = 0",
      [sessionId],
    );
    const seq = (seqRow?.m ?? -1) + 1;
    const msgId = SnowflakeUtil.nextId();
    await this.exec(
      `INSERT INTO playground_messages
      (id, tenant_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, session_id, role, content, seq)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?, ?, ?)`,
      [msgId, tenantId, now, now, sessionId, role, content, seq],
    );
    await this.exec("UPDATE playground_sessions SET last_message = ?, update_time = ? WHERE id = ? AND deleted = 0", [
      content,
      now,
      sessionId,
    ]);
  }

  public async listPlaygroundMessages(sessionId: string): Promise<PlaygroundMessageRow[]> {
    return (
      await this.q<Record<string, unknown>>(
        "SELECT id, session_id, role, content, seq, create_time FROM playground_messages WHERE session_id = ? AND deleted = 0 ORDER BY seq ASC",
        [sessionId],
      )
    ).map((value) => normalizePlaygroundMessageRow(value));
  }

  public async archiveDefaultPlaygroundSession(flowId: string, demotedTitle: string): Promise<void> {
    const def = await this.one<{ id: string }>(
      "SELECT id FROM playground_sessions WHERE flow_id = ? AND is_default = 1 AND deleted = 0 LIMIT 1",
      [flowId],
    );
    if (!def?.id) {
      await this.ensurePlaygroundDefaultSession(flowId);
      return;
    }
    const count = await this.countPlaygroundMessages(def.id);
    if (count === 0) {
      return;
    }
    const now = formatMysqlDateTimeShanghai();
    await this.exec(
      `UPDATE playground_sessions
       SET is_default = 0, title = COALESCE(NULLIF(TRIM(title), ''), ?), update_time = ?
       WHERE id = ? AND deleted = 0`,
      [demotedTitle, now, def.id],
    );
    await this.createPlaygroundSession(flowId, { asDefault: true, title: null });
  }

  public async listCustomComponentTemplates(tenantId?: string | null): Promise<CustomComponentTemplateRow[]> {
    const params: unknown[] = [];
    let sql = "SELECT id, display_name, dsl_json, create_time, update_time, tenant_id FROM custom_component_templates WHERE deleted = 0";
    if (tenantId && tenantId.trim() !== "") {
      sql += " AND tenant_id = ?";
      params.push(tenantId);
    }
    sql += " ORDER BY update_time DESC";
    return (await this.q<Record<string, unknown>>(sql, params)).map((value) => normalizeTemplateRow(value));
  }

  public async getCustomComponentTemplate(id: string, tenantId?: string | null): Promise<CustomComponentTemplateRow | null> {
    const params: unknown[] = [id];
    let sql =
      "SELECT id, display_name, dsl_json, create_time, update_time, tenant_id FROM custom_component_templates WHERE id = ? AND deleted = 0";
    if (tenantId && tenantId.trim() !== "") {
      sql += " AND tenant_id = ?";
      params.push(tenantId);
    }
    const row = await this.one<Record<string, unknown>>(sql, params);
    return row ? normalizeTemplateRow(row) : null;
  }

  public async insertCustomComponentTemplate(
    tenantId: string,
    row: Omit<CustomComponentTemplateRow, "create_time" | "update_time" | "tenant_id" | keyof AuditColumns>,
  ): Promise<void> {
    const now = formatMysqlDateTimeShanghai();
    await this.exec(
      `INSERT INTO custom_component_templates
      (id, tenant_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, display_name, dsl_json)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?)`,
      [row.id, tenantId, now, now, row.display_name, row.dsl_json],
    );
  }

  public async updateCustomComponentTemplate(
    tenantId: string,
    id: string,
    patch: Partial<Pick<CustomComponentTemplateRow, "display_name" | "dsl_json">>,
  ): Promise<void> {
    const row = await this.getCustomComponentTemplate(id, tenantId);
    if (!row) {
      return;
    }
    const now = formatMysqlDateTimeShanghai();
    await this.exec(
      `UPDATE custom_component_templates
       SET display_name = ?, dsl_json = ?, update_time = ?
       WHERE id = ? AND tenant_id = ? AND deleted = 0`,
      [patch.display_name ?? row.display_name, patch.dsl_json ?? row.dsl_json, now, id, tenantId],
    );
  }

  public async deleteCustomComponentTemplate(tenantId: string, id: string): Promise<void> {
    await this.exec("UPDATE custom_component_templates SET deleted = ?, update_time = ? WHERE id = ? AND tenant_id = ? AND deleted = 0", [
      deletedValue(),
      formatMysqlDateTimeShanghai(),
      id,
      tenantId,
    ]);
  }

  public async insertWebhookInvocation(row: {
    id: string;
    flow_id: string;
    tenant_id: string;
    source: string | null;
    payload_json: string;
    status: string;
    create_time: string;
  }): Promise<void> {
    const now = formatMysqlDateTimeShanghai(new Date(row.create_time));
    await this.exec(
      `INSERT INTO webhook_invocations
      (id, tenant_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, flow_id, source, payload_json, status)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?, ?, ?)`,
      [row.id, row.tenant_id, now, now, row.flow_id, row.source, row.payload_json, row.status],
    );
  }

  public async getKv(key: string): Promise<string | null> {
    const row = await this.one<{ value_json: string }>("SELECT value_json FROM app_kv WHERE kv_key = ? AND deleted = 0", [key]);
    return row?.value_json ?? null;
  }

  public async setKv(key: string, value: unknown): Promise<void> {
    const now = formatMysqlDateTimeShanghai();
    await this.exec(
      `INSERT INTO app_kv
      (kv_key, tenant_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, value_json)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?)
      ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), update_time = VALUES(update_time), deleted = 0`,
      [key, currentTenantId() ?? null, now, now, JSON.stringify(value)],
    );
  }

  public async deleteKv(key: string): Promise<void> {
    await this.exec("UPDATE app_kv SET deleted = ?, update_time = ? WHERE kv_key = ? AND deleted = 0", [
      deletedValue(),
      formatMysqlDateTimeShanghai(),
      key,
    ]);
  }

  public async listKvByPrefix(prefix: string): Promise<{ key: string; value_json: string }[]> {
    return (
      await this.q<Record<string, unknown>>("SELECT kv_key, value_json FROM app_kv WHERE kv_key LIKE ? AND deleted = 0 ORDER BY kv_key", [
        `${prefix}%`,
      ])
    ).map((row) => ({ key: String(row["kv_key"]), value_json: String(row["value_json"]) }));
  }
}
