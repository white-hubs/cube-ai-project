/**
 * GrantService — L1 (LRU) + L2 (Redis) + MySQL grants 表 + G-C Redis HASH。
 *
 * ref: docs/detailed-design/04-auth-and-authz/authorization-gateway.md §9
 *      docs/detailed-design/04-auth-and-authz/grant-lifecycle.md
 *      docs/technical-design/prompts/phase-3/P3-03-authz.md §3.1
 */
import { LRUCache } from 'lru-cache';
import type Redis from 'ioredis';
import { RedisKeys } from '@cube-ai/contracts';
import type {
  Grant,
  GrantScope,
  SessionGrant,
} from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { SfidService } from '../../infra/sfid/sfid.service';
import { isGrantActive } from './grant-state-machine';
import type { GrantInsert, IGrantRepository } from './grant.repository';
import { EmptyGrantRepository, MysqlGrantRepository } from './grant.repository';

const L1_TTL_MS = 120_000;
const L1_MAX = 1000;
const L2_TTL_SEC = 300;

export type SessionGrantWithId = SessionGrant & { grantId: string };

export type GrantRequestEventV1 = {
  type: 'grant-request-v1';
  grantRequestId: string;
  tenant: number;
  userId: string;
  toolName: string;
  sessionId?: string;
  turnId?: string;
  toolCallId?: string;
  scopeHint?: 'ONCE' | 'PERSISTENT';
};

export type GrantServiceDeps = {
  repository: IGrantRepository;
  /** ioredis — 使用 lazyConnect；首包业务命令时连接（R24） */
  redis: Redis | null;
  sfid: SfidService;
  /** 可选：grant.request SSE / 总线 */
  onGrantRequest?: (evt: GrantRequestEventV1) => void;
  /** 订阅 grant 失效 — 若提供 duplicate() + subscribe */
  enableInvalidationSubscriber?: boolean;
};

type WaitForGrantResolutionInput = {
  grantRequestId: string;
  tenant: number;
  userId: string;
  toolName: string;
  timeoutMs?: number;
  pollMs?: number;
};

type L1ListKey = `user:${number}:${string}` | `admin:${number}` | `id:${string}`;

export class GrantService {
  private readonly repository: IGrantRepository;
  private readonly redis: Redis | null;
  private readonly sfid: SfidService;
  private readonly onGrantRequest?: (evt: GrantRequestEventV1) => void;

  private readonly l1Lists = new LRUCache<string, Grant[]>({
    max: L1_MAX,
    ttl: L1_TTL_MS,
  });

  /** 仅缓存正命中；不缓存「无授权」避免 LRU 泛型与 null 冲突 */
  private readonly l1ActiveTool = new LRUCache<string, Grant>({
    max: L1_MAX,
    ttl: L1_TTL_MS,
  });

  constructor(deps: GrantServiceDeps) {
    this.repository = deps.repository;
    this.redis = deps.redis;
    this.sfid = deps.sfid;
    this.onGrantRequest = deps.onGrantRequest;
    if (deps.enableInvalidationSubscriber && deps.redis) {
      this.attachInvalidationSubscriber(deps.redis);
    }
  }

  private attachInvalidationSubscriber(redis: Redis): void {
    try {
      const sub = redis.duplicate();
      void sub.subscribe(RedisKeys.pubsubGrantInvalidate(), err => {
        if (err) console.error('[GrantService] pubsub subscribe', err);
      });
      sub.on('message', (_ch, message) => {
        try {
          const p = JSON.parse(message) as {
            tenant?: number;
            userId?: string;
            sessionId?: string;
            reason?: string;
          };
          if (p.tenant == null) return;
          this.evictL1ForPayload(p);
        } catch {
          this.l1Lists.clear();
          this.l1ActiveTool.clear();
        }
      });
    } catch {
      // duplicate/subscribe 不可用时仅本地失效
    }
  }

  private evictL1ForPayload(p: {
    tenant?: number;
    userId?: string;
    sessionId?: string;
  }): void {
    if (p.tenant == null) return;
    this.l1Lists.delete(`admin:${p.tenant}`);
    if (p.userId) {
      this.l1Lists.delete(`user:${p.tenant}:${p.userId}`);
      for (const k of this.l1ActiveTool.keys()) {
        if (k.startsWith(`active:${p.tenant}:${p.userId}:`)) this.l1ActiveTool.delete(k);
      }
    } else {
      for (const k of this.l1Lists.keys()) {
        if (k.includes(`:${p.tenant}:`) || k === `admin:${p.tenant}`) this.l1Lists.delete(k);
      }
      for (const k of this.l1ActiveTool.keys()) {
        if (k.startsWith(`active:${p.tenant}:`)) this.l1ActiveTool.delete(k);
      }
    }
  }

  private l1ListKey(
    kind: 'user' | 'admin',
    tenant: number,
    userId?: string,
  ): string {
    return kind === 'admin'
      ? (`admin:${tenant}` as const)
      : (`user:${tenant}:${userId!}` as const);
  }

  async loadUserGrants(tenant: number, userId: string): Promise<Grant[]> {
    const key = this.l1ListKey('user', tenant, userId);
    const hit = this.l1Lists.get(key);
    if (hit) return hit;

    const l2 = await this.l2GetUserList(tenant, userId);
    if (l2) {
      this.l1Lists.set(key, l2);
      return l2;
    }

    const fromDb = await this.repository.findUserGrants(tenant, userId);
    await this.l2SetUserList(tenant, userId, fromDb);
    this.l1Lists.set(key, fromDb);
    return fromDb;
  }

  async loadAdminGrants(tenant: number): Promise<Grant[]> {
    const key = this.l1ListKey('admin', tenant);
    const hit = this.l1Lists.get(key);
    if (hit) return hit;

    const l2 = await this.l2GetAdminList(tenant);
    if (l2) {
      this.l1Lists.set(key, l2);
      return l2;
    }

    const fromDb = await this.repository.findAdminGrants(tenant);
    await this.l2SetAdminList(tenant, fromDb);
    this.l1Lists.set(key, fromDb);
    return fromDb;
  }

  async loadSessionGrants(sessionId: string): Promise<SessionGrantWithId[]> {
    if (!this.redis) return [];
    const key = RedisKeys.authzGrantsSession(sessionId);
    const h = await this.redis.hgetall(key);
    const out: SessionGrantWithId[] = [];
    for (const [field, json] of Object.entries(h)) {
      try {
        const parsed = JSON.parse(json) as SessionGrant;
        out.push({ ...parsed, grantId: field });
      } catch {
        // skip corrupt
      }
    }
    return out;
  }

  async consumeSessionGrant(sessionId: string, grantId: string): Promise<void> {
    if (!this.redis) return;
    const key = RedisKeys.authzGrantsSession(sessionId);
    const raw = await this.redis.hget(key, grantId);
    if (!raw) return;
    const o = JSON.parse(raw) as SessionGrant;
    o.consumeTime = Date.now();
    await this.redis.hset(key, grantId, JSON.stringify(o));
  }

  async getActive(grantId: string): Promise<Grant | null> {
    const idKey = `id:${grantId}` as L1ListKey;
    const idHit = this.l1Lists.get(idKey);
    if (idHit?.[0]) return idHit[0]!;

    const l2 = await this.l2GetGrantById(grantId);
    if (l2) {
      this.l1Lists.set(idKey, [l2]);
      return l2;
    }

    const fromDb = await this.repository.findBySfid(grantId);
    if (fromDb) {
      await this.l2SetGrantById(fromDb);
      this.l1Lists.set(idKey, [fromDb]);
    }
    return fromDb;
  }

  /**
   * 单条热路径：先 L1 / L2 per-tool，再回源 MySQL。
   */
  async findActiveGrant(
    userId: string,
    toolName: string,
    ctx: { tenant: number },
  ): Promise<Grant | null> {
    const { tenant } = ctx;
    const actKey = `active:${tenant}:${userId}:${toolName}`;

    const l1g = this.l1ActiveTool.get(actKey);
    if (l1g) return l1g;

    const toolKey = RedisKeys.authzGrantActiveTool(tenant, userId, toolName);
    const r = this.redis;
    if (r) {
      const raw = await r.get(toolKey);
      if (raw) {
        const g = JSON.parse(raw) as Grant;
        if (isGrantActive(g)) {
          this.l1ActiveTool.set(actKey, g);
          return g;
        }
      }
    }

    const g = await this.repository.findActiveForUserTool(tenant, userId, toolName);
    if (g && isGrantActive(g)) {
      this.l1ActiveTool.set(actKey, g);
      if (r) {
        const ttl = remainingTtlMs(g) ?? L2_TTL_SEC * 1000;
        await r.set(toolKey, JSON.stringify(g), 'PX', Math.min(ttl, L2_TTL_SEC * 1000));
      }
      return g;
    }
    return null;
  }

  async requestGrant(
    toolCall: {
      tenant: number;
      userId: string;
      toolName: string;
      sessionId?: string;
      turnId?: string;
      toolCallId?: string;
      scopeHint?: 'ONCE' | 'PERSISTENT';
    },
  ): Promise<{ grantRequestId: string }> {
    const id = this.sfid.next();
    const body = {
      status: 'PENDING' as const,
      ...toolCall,
      createTime: Date.now(),
    };
    if (this.redis) {
      await this.redis.set(
        RedisKeys.authzGrantRequest(id),
        JSON.stringify(body),
        'PX',
        60_000,
      );
    }
    this.onGrantRequest?.({
      type: 'grant-request-v1',
      grantRequestId: id,
      tenant: toolCall.tenant,
      userId: toolCall.userId,
      toolName: toolCall.toolName,
      sessionId: toolCall.sessionId,
      turnId: toolCall.turnId,
      toolCallId: toolCall.toolCallId,
      scopeHint: toolCall.scopeHint,
    });
    return { grantRequestId: id };
  }

  async waitForGrantResolution(input: WaitForGrantResolutionInput): Promise<'APPROVED' | 'DENIED' | 'TIMEOUT'> {
    const timeoutMs = input.timeoutMs ?? 60_000;
    const pollMs = input.pollMs ?? 500;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const active = await this.findActiveGrant(input.userId, input.toolName, { tenant: input.tenant });
      if (active) return 'APPROVED';

      if (this.redis) {
        const pending = await this.redis.get(RedisKeys.authzGrantRequest(input.grantRequestId));
        if (!pending) {
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const recheck = await this.findActiveGrant(input.userId, input.toolName, {
              tenant: input.tenant,
            });
            if (recheck) return 'APPROVED';
            if (attempt < 4) {
              await delay(Math.min(pollMs, 100));
            }
          }
          return 'DENIED';
        }
      }

      await delay(pollMs);
    }

    return 'TIMEOUT';
  }

  async approveGrant(
    grantId: string,
    scope: GrantScope | undefined,
    ctx: { tenant: number; userId: string; ttlSeconds?: number },
  ): Promise<Grant> {
    const now = Date.now();
    const ttlMs = (ctx.ttlSeconds ?? 3600) * 1000;
    const expireTime = now + ttlMs;

    if (this.redis) {
      const raw = await this.redis.get(RedisKeys.authzGrantRequest(grantId));
      if (raw) {
        const pending = JSON.parse(raw) as {
          tenant: number;
          userId: string;
          toolName: string;
        };
        const effectiveScope: GrantScope = scope ?? {
          toolName: pending.toolName,
          action: 'ALLOW',
        };
        const row: GrantInsert = {
          id: this.sfid.next(),
          tenant: pending.tenant,
          form: 'G_D',
          grantorType: 'USER',
          grantorUserId: ctx.userId,
          subject: { userId: pending.userId },
          scope: effectiveScope,
          origin: 'SESSION_UPGRADE',
          deleted: 0,
          createTime: now,
          updateTime: now,
          expireTime,
          createBy: ctx.userId,
          updateBy: ctx.userId,
        };
        await this.repository.insertGrant(row);
        await this.redis.del(RedisKeys.authzGrantRequest(grantId));
        await this.publishInvalidate({
          tenant: pending.tenant,
          userId: pending.userId,
          reason: 'grant_approved',
        });
        await this.refreshTierCaches(row);
        return row;
      }
    }

    throw AgenticEngineError.fromCode(
      'RESOURCE_NOT_FOUND_SESSION',
      `approveGrant: no pending grant request ${grantId} for tenant ${ctx.tenant}`,
    );
  }

  async denyGrant(grantId: string, reason: string, ctx: { tenant: number }): Promise<void> {
    void reason;
    if (this.redis) {
      await this.redis.del(RedisKeys.authzGrantRequest(grantId));
    }
    await this.publishInvalidate({ tenant: ctx.tenant, reason: 'grant_denied' });
  }

  async expireGrant(grantId: string, ctx: { tenant: number }): Promise<void> {
    const now = Date.now();
    const g = await this.repository.findById(ctx.tenant, grantId);
    await this.repository.updateExpire(grantId, ctx.tenant, now);
    await this.publishInvalidate({
      tenant: ctx.tenant,
      userId: g?.subject.userId,
      reason: 'grant_expired',
    });
    if (g) await this.refreshTierCaches({ ...g, expireTime: now });
  }

  async revokeGrant(
    grantId: string,
    ctx: { tenant: number; revokeUserId: string },
  ): Promise<void> {
    const before = await this.repository.findById(ctx.tenant, grantId);
    const uid = before?.subject.userId ?? '';
    const toolName = before?.scope.toolName ?? before?.scope.toolPattern ?? '';
    await this.repository.softRevoke(grantId, ctx.tenant, ctx.revokeUserId);
    await this.publishInvalidate({
      tenant: ctx.tenant,
      userId: uid || undefined,
      reason: 'grant_revoked',
    });
    if (before) {
      const revoked = { ...before, deleted: Date.now(), revokeTime: Date.now() };
      await this.refreshTierCaches(revoked);
    }
    const r = this.redis;
    if (r && uid && toolName) {
      await r.del(RedisKeys.authzGrantActiveTool(ctx.tenant, uid, toolName));
    }
  }

  invalidateUser(tenant: number, userId: string): void {
    this.l1Lists.delete(this.l1ListKey('user', tenant, userId));
    for (const k of this.l1ActiveTool.keys()) {
      if (k.startsWith(`active:${tenant}:${userId}:`)) this.l1ActiveTool.delete(k);
    }
  }

  /**
   * Jobs BC grant-expire worker: after SQL sets revoke_time on expired grants,
   * invalidate user grant caches so AuthZ re-reads from DB/L2 on next decide.
   * ref: grant-expire.processor.ts / authorization-gateway.md §9
   */
  notifyGrantsExpiredForUser(tenant: number, userId: string): void {
    this.invalidateUser(tenant, userId);
  }

  /** Invalidate L1 cache entries for an entire tenant */
  invalidateTenant(tenant: number): void {
    for (const k of this.l1Lists.keys()) {
      if (k.includes(`:${tenant}:`) || k === `admin:${tenant}`) this.l1Lists.delete(k);
    }
    for (const k of this.l1ActiveTool.keys()) {
      if (k.startsWith(`active:${tenant}:`)) this.l1ActiveTool.delete(k);
    }
  }

  filterActive(grants: Grant[]): Grant[] {
    return grants.filter(g => isGrantActive(g));
  }

  /** @internal 单测注入 L1 列表缓存 */
  _l1Set(key: string, grants: Grant[]): void {
    this.l1Lists.set(key, grants);
  }

  private async refreshTierCaches(g: Grant): Promise<void> {
    this.invalidateUser(g.tenant, g.subject.userId ?? '');
    this.l1Lists.delete(`admin:${g.tenant}`);
    const r = this.redis;
    if (!r) return;
    await r.del(RedisKeys.authzGrantsUser(g.tenant, g.subject.userId ?? ''));
    await r.del(RedisKeys.authzGrantsAdmin(g.tenant));
    if (g.scope.toolName) {
      await r.del(
        RedisKeys.authzGrantActiveTool(
          g.tenant,
          g.subject.userId ?? '',
          g.scope.toolName,
        ),
      );
    }
  }

  private async l2GetUserList(
    tenant: number,
    userId: string,
  ): Promise<Grant[] | null> {
    if (!this.redis) return null;
    const raw = await this.redis.get(RedisKeys.authzGrantsUser(tenant, userId));
    if (!raw) return null;
    return JSON.parse(raw) as Grant[];
  }

  private async l2SetUserList(
    tenant: number,
    userId: string,
    grants: Grant[],
  ): Promise<void> {
    if (!this.redis) return;
    await this.redis.set(
      RedisKeys.authzGrantsUser(tenant, userId),
      JSON.stringify(grants),
      'EX',
      L2_TTL_SEC,
    );
  }

  private async l2GetAdminList(tenant: number): Promise<Grant[] | null> {
    if (!this.redis) return null;
    const raw = await this.redis.get(RedisKeys.authzGrantsAdmin(tenant));
    if (!raw) return null;
    return JSON.parse(raw) as Grant[];
  }

  private async l2SetAdminList(tenant: number, grants: Grant[]): Promise<void> {
    if (!this.redis) return;
    await this.redis.set(
      RedisKeys.authzGrantsAdmin(tenant),
      JSON.stringify(grants),
      'EX',
      L2_TTL_SEC,
    );
  }

  private async l2GetGrantById(grantId: string): Promise<Grant | null> {
    if (!this.redis) return null;
    const raw = await this.redis.get(`agentic:engine:authz:grant:byid:${grantId}`);
    if (!raw) return null;
    return JSON.parse(raw) as Grant;
  }

  private async l2SetGrantById(g: Grant): Promise<void> {
    if (!this.redis) return;
    await this.redis.set(
      `agentic:engine:authz:grant:byid:${g.id}`,
      JSON.stringify(g),
      'EX',
      L2_TTL_SEC,
    );
  }

  private async publishInvalidate(payload: {
    tenant: number;
    userId?: string;
    sessionId?: string;
    reason?: string;
  }): Promise<void> {
    if (!this.redis) return;
    await this.redis.publish(
      RedisKeys.pubsubGrantInvalidate(),
      JSON.stringify(payload),
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingTtlMs(g: Grant): number | null {
  if (g.expireTime == null) return null;
  return Math.max(0, g.expireTime - Date.now());
}

export function createGrantRepository(
  pool: import('mysql2/promise').Pool | null,
): IGrantRepository {
  if (pool) return new MysqlGrantRepository(pool);
  return new EmptyGrantRepository();
}

export type { IGrantRepository };
