/**
 * AssistantEnginePort 默认实现：把 `AgenticClient` 适配为 port 接口。
 * Ref: ADR-0008 §D4.
 */
import type {
  AgenticClient,
  SseEvent,
} from '@cube-ai/agent-sdk-client';
import type {
  AssistantEnginePort,
  GrantResponseInput,
  NormalizedSseEvent,
  PortMessageItem,
} from './port';
import type { AssistantSessionSummary, LlmOption } from './types';

export interface CreateAgenticEnginePortOptions {
  /**
   * 业务侧自定义 `listModels`（Q1：模型目录走中台，不走 engine）；缺省则 port 不暴露此方法。
   */
  listModels?: () => Promise<LlmOption[]>;
}

export function createAgenticEnginePort(
  client: AgenticClient,
  options: CreateAgenticEnginePortOptions = {},
): AssistantEnginePort {
  const sessions = client.sessions;

  const port: AssistantEnginePort = {
    startTurn: (sessionId, body, opts) =>
      sessions.startTurn(sessionId, body, opts),

    async *streamEvents(sessionId, opts) {
      for await (const ev of sessions.streamEvents(sessionId, opts)) {
        yield normalize(ev);
      }
    },

    async listMessages(sessionId, opts) {
      const r = await sessions.listMessages(sessionId, opts ?? {});
      const items: PortMessageItem[] = r.items.map((m) => {
        const raw = m as Record<string, unknown>;
        const attachments = Array.isArray(raw.attachments) ? raw.attachments : undefined;
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          createTime: m.createTime,
          turnId: m.turnId ?? null,
          ...(attachments !== undefined ? { attachments: attachments as PortMessageItem['attachments'] } : {}),
        };
      });
      return { items };
    },

    async createSession(req) {
      const created = await sessions.create({
        agentId: req.agentId,
        ...(req.title !== undefined ? { title: req.title } : {}),
        ...(req.modelCode !== undefined ? { modelCode: req.modelCode } : {}),
        ...(req.context !== undefined ? { context: req.context } : {}),
      });
      return {
        id: created.id,
        title: (created as { title?: string | null }).title ?? null,
        createTime: created.createTime,
      };
    },

    async listSessions(opts) {
      const r = await sessions.list({
        ...(opts?.limit != null ? { limit: opts.limit } : {}),
        ...(opts?.cursor != null ? { cursor: opts.cursor } : {}),
      });
      const items: AssistantSessionSummary[] = r.items.map((s) => ({
        id: s.id,
        title: s.title ?? '',
        updatedAt: s.updateTime,
      }));
      return { items, hasMore: r.page.hasMore };
    },

    async getSession(sessionId) {
      const s = await sessions.get(sessionId);
      return { id: s.id, title: s.title ?? null, updateTime: s.updateTime };
    },

    patchSession: (sessionId, patch) => sessions.patch(sessionId, patch),

    deleteSession: (sessionId) => sessions.delete(sessionId),

    cancelTurn: (sessionId, turnId) => sessions.cancelTurn(sessionId, turnId),

    respondGrant: async (input: GrantResponseInput): Promise<void> => {
      // 直走 sdk-core grants.respond → `POST /grants/responses`（与 engine
      // `@cube-ai/agentic-engine` GrantController 路径对齐，body 已 zod 校验）。
      await client.grants.respond({
        grantRequestId: input.grantRequestId,
        decision: input.decision,
        scopeChoice: input.scopeChoice,
        rememberTtlSeconds: input.rememberTtlSeconds,
        note: input.note,
      });
    },
  };

  if (options.listModels) {
    port.listModels = options.listModels;
  }

  return port;
}

/**
 * Convert sdk-core `SseEvent` into `NormalizedSseEvent`。
 * 规则（ghcloud `parseSseChunk` 对齐）：
 *   - schema 字段做 event 名（fallback 到 `event` 字段，再 fallback 到 `unknown`）。
 *   - data 字段为 schema 之外的字段 spread；若已有 `data` 字段则保留嵌套。
 */
function normalize(ev: SseEvent): NormalizedSseEvent {
  const rec = ev as unknown as Record<string, unknown>;
  const event =
    (typeof rec.schema === 'string' && rec.schema) ||
    (typeof rec.event === 'string' && rec.event) ||
    'unknown';
  // data 字段：去掉 schema 自身，其余字段都视作 data 的成员。
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === 'schema') continue;
    data[k] = v;
  }
  return { event, data, raw: ev };
}
