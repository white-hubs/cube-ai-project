import type { AuditColumns, CustomComponentTemplateRow, FlowRow, PlaygroundMessageRow, PlaygroundSessionRow } from "./sqlite";

export type Awaitable<T> = T | Promise<T>;

export const FLOW_REPOSITORY_TOKEN = Symbol("FlowRepository");

export interface FlowRepository {
  createFlow(
    tenantId: string,
    row: Omit<FlowRow, "lf_snapshot_json" | "tenant_id"> & { lf_snapshot_json?: string | null },
    graphJson: string,
  ): Awaitable<void>;
  updateFlowMeta(
    tenantId: string,
    id: string,
    patch: Partial<Pick<FlowRow, "name" | "description" | "langflow_flow_id" | "binding_status">>,
    bumpRevision: boolean,
  ): Awaitable<void>;
  setLfSnapshot(tenantId: string, id: string, json: string | null): Awaitable<void>;
  updateGraph(tenantId: string, id: string, graphJson: string): Awaitable<void>;
  deleteFlow(tenantId: string, id: string): Awaitable<void>;
  listFlows(tenantId?: string | null): Awaitable<FlowRow[]>;
  getFlow(id: string, tenantId?: string | null): Awaitable<FlowRow | null>;
  getFlowInProject(id: string, tenantId: string): Awaitable<FlowRow | null>;
  countFlowsInProject(tenantId: string): Awaitable<number>;
  countCustomTemplatesInProject(tenantId: string): Awaitable<number>;
  getGraphJson(flowId: string): Awaitable<string | null>;

  getPlaygroundSession(flowId: string, sessionId: string): Awaitable<PlaygroundSessionRow | null>;
  listPlaygroundSessions(flowId: string): Awaitable<PlaygroundSessionRow[]>;
  ensurePlaygroundDefaultSession(flowId: string): Awaitable<string>;
  createPlaygroundSession(flowId: string, opts: { title?: string | null; asDefault: boolean; userId?: string | null }): Awaitable<string>;
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
  ): Awaitable<void>;
  deletePlaygroundSession(flowId: string, sessionId: string): Awaitable<void>;
  countPlaygroundMessages(sessionId: string): Awaitable<number>;
  appendPlaygroundMessage(sessionId: string, role: "user" | "bot", content: string): Awaitable<void>;
  listPlaygroundMessages(sessionId: string): Awaitable<PlaygroundMessageRow[]>;
  archiveDefaultPlaygroundSession(flowId: string, demotedTitle: string): Awaitable<void>;

  listCustomComponentTemplates(tenantId?: string | null): Awaitable<CustomComponentTemplateRow[]>;
  getCustomComponentTemplate(id: string, tenantId?: string | null): Awaitable<CustomComponentTemplateRow | null>;
  insertCustomComponentTemplate(
    tenantId: string,
    row: Omit<CustomComponentTemplateRow, "create_time" | "update_time" | "tenant_id" | keyof AuditColumns>,
  ): Awaitable<void>;
  updateCustomComponentTemplate(
    tenantId: string,
    id: string,
    patch: Partial<Pick<CustomComponentTemplateRow, "display_name" | "dsl_json">>,
  ): Awaitable<void>;
  deleteCustomComponentTemplate(tenantId: string, id: string): Awaitable<void>;

  insertWebhookInvocation(row: {
    id: string;
    flow_id: string;
    tenant_id: string;
    source: string | null;
    payload_json: string;
    status: string;
    create_time: string;
  }): Awaitable<void>;

  getKv(key: string): Awaitable<string | null>;
  setKv(key: string, value: unknown): Awaitable<void>;
  deleteKv(key: string): Awaitable<void>;
  listKvByPrefix(prefix: string): Awaitable<{ key: string; value_json: string }[]>;
}

export interface FlowRepositoryBundle {
  flowRepo: FlowRepository;
}
