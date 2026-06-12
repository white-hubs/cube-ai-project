import { Injectable } from '@dangao/bun-server';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type {
  CreateSessionInput,
  SessionRow,
  SessionRowStatus,
  CreateSessionRequest as CreateSessionBody,
} from '@cube-ai/contracts';
import { SfidService } from '../../infra/sfid/sfid.service';
import type { SessionRepository } from './repository/session.repository';
import type { OutboxWriter } from '@cube-ai/bun-server-ext-outbox';
import { type TransactionContext } from '@cube-ai/bun-server-ext-outbox';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { appendEngineUtcClockBlock } from '../tools/engine-utc';
import {
  hydrateSnapshotSkills,
  type SkillRegistryResolveLike,
} from './snapshot-skill-hydration';
import {
  hydrateSnapshotRules,
  snapshotRuleTexts,
  type RuleRegistryResolveLike,
} from './snapshot-rule-hydration';

const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;

type DescriptorLoaderLike = {
  getGlobalPrompt?: () => string;
  getAgent?: (name: string) => Promise<Record<string, unknown> | null>;
  loadIndexedAgentDescriptor?: (name: string) => Promise<Record<string, unknown> | null>;
};

/** Public session shape (no `tenant` in JSON — regulation §API-4). */
export type SessionHttpView = {
  id: string;
  userId: string;
  agentId: string;
  agentVersionNo: number;
  title: string | null;
  status: SessionRowStatus;
  lastTurnId: string | null;
  lastActivityTime: number;
  contextJson: unknown | null;
  createTime: number;
  updateTime: number;
};

function toHttpView(row: SessionRow): SessionHttpView {
  return {
    id: row.id,
    userId: row.userId,
    agentId: row.agentId,
    agentVersionNo: row.agentVersionNo,
    title: row.title,
    status: row.status,
    lastTurnId: row.lastTurnId,
    lastActivityTime: row.lastActiveTime,
    contextJson: row.contextJson ?? null,
    createTime: row.createTime,
    updateTime: row.updateTime,
  };
}

async function buildSnapshots(params: {
  tenant: number;
  userId: string;
  displayName?: string;
  agentId: string;
  modelCode?: string;
  context?: Record<string, unknown>;
  descriptorLoader?: DescriptorLoaderLike;
  skillRegistry?: SkillRegistryResolveLike;
  ruleRegistry?: RuleRegistryResolveLike;
}): Promise<{ agent: Record<string, unknown>; user: Record<string, unknown> }> {
  const frozen = Date.now();
  const globalPrompt = params.descriptorLoader?.getGlobalPrompt?.()?.trim() ?? '';
  const agentDescriptor =
    (await params.descriptorLoader?.getAgent?.(params.agentId)) ??
    (await params.descriptorLoader?.loadIndexedAgentDescriptor?.(params.agentId)) ??
    null;
  if (params.descriptorLoader && agentDescriptor == null) {
    throw AgenticEngineError.fromCode(
      'RESOURCE_NOT_FOUND_DESCRIPTOR',
      `Agent descriptor not found: ${params.agentId}`,
      { agentId: params.agentId },
    );
  }
  const agentInstructions =
    (agentDescriptor && typeof agentDescriptor['instructions'] === 'string'
      ? (agentDescriptor['instructions'] as string).trim()
      : '');
  // TODO(prompt-injection): sessionSuffix is currently injected verbatim into
  // the system prompt with the same trust level as agentInstructions, but it
  // originates from caller-supplied `context.systemSuffix` and should be
  // treated as lower trust. Add length cap + structured field whitelist (or
  // move to a separate, explicitly-tagged lower-trust prompt section). CUBE.md
  // currently relies on the LLM-side "user messages = data, not instructions"
  // rule (see CUBE.md > Resisting prompt injection) to mitigate, which is
  // incomplete by itself.
  const sessionSuffix =
    (params.context && typeof params.context['systemSuffix'] === 'string'
      ? String(params.context['systemSuffix']).trim()
      : '');
  const toolRefs =
    (agentDescriptor && Array.isArray(agentDescriptor['availableTools'])
      ? (agentDescriptor['availableTools'] as unknown[]).filter(
          (x): x is string => typeof x === 'string' && x.length > 0,
        )
      : []);
  const ruleRefs =
    (agentDescriptor && Array.isArray(agentDescriptor['ruleRefs'])
      ? (agentDescriptor['ruleRefs'] as unknown[]).filter(
          (x): x is string => typeof x === 'string' && x.length > 0,
        )
      : []);
  const skillRefs =
    (agentDescriptor && Array.isArray(agentDescriptor['skillRefs'])
      ? (agentDescriptor['skillRefs'] as unknown[]).filter(
          (x): x is string => typeof x === 'string' && x.length > 0,
        )
      : []);
  const subAgentRefs =
    (agentDescriptor && Array.isArray(agentDescriptor['subAgentRefs'])
      ? (agentDescriptor['subAgentRefs'] as unknown[]).filter(
          (x): x is string => typeof x === 'string' && x.length > 0,
        )
      : []);
  const maxDepth =
    (agentDescriptor && typeof agentDescriptor['maxDepth'] === 'number'
      ? Number(agentDescriptor['maxDepth'])
      : undefined);
  const requestedModel = params.modelCode?.trim() ?? '';
  const skills =
    skillRefs.length > 0
      ? hydrateSnapshotSkills(skillRefs, params.skillRegistry)
      : [];
  // rule 水合（ADR-0016 §7）：内容冻结进 snapshot.rules，并注入 system prompt
  // （global prompt 之后、agent prompt 之前）。
  const rules =
    ruleRefs.length > 0 ? hydrateSnapshotRules(ruleRefs, params.ruleRegistry) : [];
  const promptBody = [globalPrompt, ...snapshotRuleTexts(rules), agentInstructions, sessionSuffix]
    .filter((x) => x.length > 0)
    .join('\n\n');
  // session 创建时一次性把 UTC 时钟锚点冻结进 snapshot.prompt。
  // 整个 session 复用，不再在每个 turn 重复注入；新鲜时间由 `currentDate` 工具兜底。
  const prompt = appendEngineUtcClockBlock(promptBody, frozen);
  const agentSnapshotJson: Record<string, unknown> = {
    schema: 'agent-snapshot-v1',
    agent: {
      id: params.agentId,
      versionNo: 1,
      content: {
        prompt,
        modelConfig: { provider: 'unset', model: requestedModel || 'unset', temperature: 0.7 },
        ruleRefs,
        skillRefs,
        toolRefs,
        ...(subAgentRefs.length > 0 ? { subAgentRefs } : {}),
        ...(typeof maxDepth === 'number' ? { maxDepth } : {}),
      },
    },
    rules,
    skills,
    tools: [],
    frozenTime: frozen,
  };
  const userPrincipalSnapshotJson: Record<string, unknown> = {
    schema: 'user-principal-v1',
    tenant: params.tenant,
    userId: params.userId,
    displayName: params.displayName ?? params.userId,
    scopes: [],
    createTime: frozen,
  };

  const agentJson = JSON.stringify(agentSnapshotJson);
  const userJson = JSON.stringify(userPrincipalSnapshotJson);
  const ctxJson = params.context ? JSON.stringify(params.context) : '';
  if (agentJson.length > SNAPSHOT_MAX_BYTES || userJson.length > SNAPSHOT_MAX_BYTES) {
    throw AgenticEngineError.fromCode(
      'OUT_OF_RANGE_SNAPSHOT_SIZE',
      'Snapshot JSON exceeds maximum allowed size',
      { maxBytes: SNAPSHOT_MAX_BYTES },
    );
  }
  if (ctxJson.length > 64 * 1024) {
    throw AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      'context exceeds 64 KiB',
      {},
    );
  }

  return { agent: agentSnapshotJson, user: userPrincipalSnapshotJson };
}

function requirePool(pool: Pool | null): Pool {
  if (!pool) {
    throw AgenticEngineError.fromCode(
      'INTERNAL_UNKNOWN',
      'MySQL pool is not configured — set AGENTIC_ENGINE_MYSQL_URL',
      {},
    );
  }
  return pool;
}

function epochMsFromSql(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  if (v instanceof Date) {
    return v.getTime();
  }
  if (typeof v === 'string') {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

/** 将 DB `content_json` 规范为对外 `message-content-v1`（含仅写入 blocks 数组的旧行） */
function normalizeMessageContent(contentJson: unknown): Record<string, unknown> {
  if (contentJson != null && typeof contentJson === 'object' && !Array.isArray(contentJson)) {
    const o = contentJson as Record<string, unknown>;
    if (o.schema === 'message-content-v1' && Array.isArray(o.blocks)) {
      return o as Record<string, unknown>;
    }
    if (Array.isArray(o.blocks)) {
      return { schema: 'message-content-v1', blocks: o.blocks };
    }
  }
  if (Array.isArray(contentJson)) {
    return { schema: 'message-content-v1', blocks: contentJson };
  }
  return {
    schema: 'message-content-v1',
    blocks: [{ type: 'text', text: typeof contentJson === 'string' ? contentJson : '' }],
  };
}

function mysqlTx(connection: PoolConnection): TransactionContext {
  return { _brand: 'TransactionContext', mysqlConnection: connection };
}

@Injectable()
export class SessionService {
  constructor(
    private readonly sfid: SfidService,
    private readonly repo: SessionRepository,
    private readonly pool: Pool | null,
    private readonly outbox: OutboxWriter,
    private readonly descriptorLoader?: DescriptorLoaderLike,
    private readonly skillRegistry?: SkillRegistryResolveLike,
    private readonly ruleRegistry?: RuleRegistryResolveLike,
  ) {}

  private async withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const p = requirePool(this.pool);
    const conn = await p.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  /**
   * POST /sessions — create row + session.created outbox (single transaction).
   */
  async createSession(
    tenant: number,
    userId: string,
    displayName: string | undefined,
    body: CreateSessionBody,
  ): Promise<SessionHttpView> {
    const snaps = await buildSnapshots({
      tenant,
      userId,
      displayName,
      agentId: body.agentId,
      modelCode: body.modelCode,
      context: body.context,
      descriptorLoader: this.descriptorLoader,
      skillRegistry: this.skillRegistry,
      ruleRegistry: this.ruleRegistry,
    });

    return this.withTransaction(async (conn) => {
      const sessionId = this.sfid.next();
      const input: CreateSessionInput = {
        tenant,
        userId,
        agentId: body.agentId,
        agentVersionNo: 1,
        agentSnapshotJson: snaps.agent,
        userPrincipalSnapshotJson: snaps.user,
        title: body.title ?? null,
        status: 'ACTIVE',
        lastTurnId: null,
        lastActiveTime: Date.now(),
        contextJson: body.context ?? null,
      };

      const row = await this.repo.insertWithConnection(conn, tenant, sessionId, input);

      await this.outbox.append(mysqlTx(conn), {
        tenant,
        channel: 'session_lifecycle',
        eventType: 'session.created',
        payloadJson: {
          sessionId: row.id,
          tenant,
          userId,
          occurredTime: row.createTime,
        },
        target: null,
        scheduleTime: Date.now(),
      });

      return toHttpView(row);
    });
  }

  async getSession(sessionId: string, tenant: number): Promise<SessionHttpView | null> {
    const row = await this.repo.findById(tenant, sessionId);
    return row ? toHttpView(row) : null;
  }

  /**
   * M2 — GET /sessions/:sessionId/messages
   * ref: docs/detailed-design/01-api/session.md §11
   */
  async listSessionMessages(params: {
    tenant: number;
    sessionId: string;
    userId: string;
    limit: number;
  }): Promise<{ items: unknown[]; page: { hasMore: boolean; nextCursor?: string } }> {
    const existing = await this.repo.findById(params.tenant, params.sessionId);
    if (!existing) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_SESSION',
        `Session ${params.sessionId} not found`,
        { sessionId: params.sessionId },
      );
    }
    if (existing.userId !== params.userId) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_SESSION',
        `Session ${params.sessionId} not found`,
        { sessionId: params.sessionId },
      );
    }

    const limit = Math.min(Math.max(params.limit, 1), 200);
    const fetchN = limit + 1;
    const p = requirePool(this.pool);
    const sid = BigInt(params.sessionId);
    const [rows] = await p.query<RowDataPacket[]>(
      `SELECT id, turn_id, session_id, seq, role, content_json, attachments_json, create_time
       FROM messages
       WHERE tenant = ? AND session_id = ? AND deleted = 0
       ORDER BY create_time ASC, seq ASC
       LIMIT ?`,
      [params.tenant, sid, fetchN],
    );

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const items = slice.map((r) => {
      let rawContent: unknown = r.content_json;
      let rawAttachments: unknown = (r as RowDataPacket & { attachments_json?: unknown }).attachments_json;
      if (typeof rawContent === 'string') {
        try {
          rawContent = JSON.parse(rawContent) as unknown;
        } catch {
          rawContent = null;
        }
      }
      if (typeof rawAttachments === 'string') {
        try {
          rawAttachments = JSON.parse(rawAttachments) as unknown;
        } catch {
          rawAttachments = null;
        }
      }
      return {
        id: String(r.id),
        turnId: String(r.turn_id),
        sessionId: String(r.session_id),
        seq: Number(r.seq),
        role: String(r.role),
        content: normalizeMessageContent(rawContent),
        ...(Array.isArray(rawAttachments) && rawAttachments.length > 0
          ? { attachments: rawAttachments }
          : {}),
        createTime: epochMsFromSql(r.create_time),
      };
    });

    return {
      items,
      page: { hasMore, nextCursor: undefined },
    };
  }

  async listSessions(params: {
    tenant: number;
    userId: string;
    statuses?: SessionRowStatus[];
    cursor?: string;
    limit: number;
  }): Promise<{ items: SessionHttpView[]; nextCursor?: string; hasMore: boolean }> {
    const { items, nextCursor, hasMore } = await this.repo.listByOwner(params.tenant, params.userId, {
      statuses: params.statuses,
      limit: params.limit,
      cursor: params.cursor,
    });

    return {
      items: items.map(toHttpView),
      nextCursor,
      hasMore,
    };
  }

  /**
   * PATCH — partial update + optional lifecycle outbox when closing.
   */
  async patchSession(
    tenant: number,
    sessionId: string,
    userId: string,
    patch: { title?: string | null; status?: 'ACTIVE' | 'CLOSED' },
  ): Promise<void> {
    const existing = await this.repo.findById(tenant, sessionId);
    if (!existing) {
      throw AgenticEngineError.fromCode('RESOURCE_NOT_FOUND_SESSION', `Session ${sessionId} not found`, {
        sessionId,
      });
    }

    const titlePatch = patch.title !== undefined ? { title: patch.title } : {};

    if (patch.status === undefined) {
      if (Object.keys(titlePatch).length === 0) return;
      await this.repo.updatePartial(tenant, sessionId, titlePatch, userId);
      return;
    }

    if (patch.status === 'CLOSED') {
      if (existing.status !== 'ACTIVE') {
        throw AgenticEngineError.fromCode(
          'RESOURCE_CONFLICT_STATE_TRANSITION',
          'Only ACTIVE sessions can be closed via PATCH',
          { sessionId, currentStatus: existing.status },
        );
      }
      await this.withTransaction(async (conn) => {
        await this.repo.updatePartialWithConnection(conn, tenant, sessionId, {
          ...titlePatch,
          status: 'CLOSED',
        }, userId);
        await this.outbox.append(mysqlTx(conn), {
          tenant,
          channel: 'session_lifecycle',
          eventType: 'session.closed',
          payloadJson: { sessionId, tenant, closedTime: Date.now() },
          target: null,
          scheduleTime: Date.now(),
        });
      });
      return;
    }

    if (patch.status === 'ACTIVE') {
      if (existing.status !== 'CLOSED') {
        throw AgenticEngineError.fromCode(
          'RESOURCE_CONFLICT_STATE_TRANSITION',
          'Only CLOSED sessions can be reopened via PATCH',
          { sessionId, currentStatus: existing.status },
        );
      }
      await this.repo.updatePartial(tenant, sessionId, { ...titlePatch, status: 'ACTIVE' }, userId);
      return;
    }
  }

  /** DELETE — soft-delete + session.deleted outbox (single transaction). */
  async deleteSession(tenant: number, sessionId: string, userId: string): Promise<void> {
    await this.withTransaction(async (conn) => {
      await this.repo.softDeleteWithConnection(conn, tenant, sessionId, userId);
      await this.outbox.append(mysqlTx(conn), {
        tenant,
        channel: 'session_lifecycle',
        eventType: 'session.deleted',
        payloadJson: { sessionId, tenant, deletedTime: Date.now() },
        target: null,
        scheduleTime: Date.now(),
      });
    });
  }
}
