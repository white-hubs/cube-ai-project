/**
 * Unit tests: GrantService L1/L2 + request/approve/deny + findActive + pubsub。
 * ref: P1-05 design doc §7 / P3-03-authz.md §5
 */
import { describe, it, expect } from 'bun:test';
import type Redis from 'ioredis';
import { RedisKeys } from '@cube-ai/contracts';
import type { Grant, GrantScope } from '@cube-ai/contracts';
import { SfidService } from '../../infra/sfid/sfid.service';
import { GrantService, createGrantRepository } from './grant.service';
import type { GrantInsert, IGrantRepository } from './grant.repository';

function makeGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: '100000000000001',
    tenant: 101,
    form: 'G_B',
    grantorType: 'USER',
    subject: { userId: 'usr_test' },
    scope: { toolName: 'orders.read', action: 'ALLOW' },
    origin: 'USER_CENTER',
    deleted: 0,
    createTime: Date.now(),
    updateTime: Date.now(),
    ...overrides,
  };
}

class MemRepo implements IGrantRepository {
  grants = new Map<string, Grant>();
  async findById(tenant: number, id: string): Promise<Grant | null> {
    const g = this.grants.get(id);
    return g && g.tenant === tenant && g.deleted === 0 ? g : null;
  }
  async findBySfid(id: string): Promise<Grant | null> {
    const g = this.grants.get(id);
    return g && g.deleted === 0 ? g : null;
  }
  async findUserGrants(tenant: number, userId: string): Promise<Grant[]> {
    return [...this.grants.values()].filter(
      g =>
        g.tenant === tenant &&
        g.subject.userId === userId &&
        g.deleted === 0 &&
        (g.form === 'G_B' || g.form === 'G_D'),
    );
  }
  async findAdminGrants(tenant: number): Promise<Grant[]> {
    return [...this.grants.values()].filter(
      g => g.tenant === tenant && g.deleted === 0 && g.form === 'G_A',
    );
  }
  async findActiveForUserTool(
    tenant: number,
    userId: string,
    toolName: string,
  ): Promise<Grant | null> {
    const list = await this.findUserGrants(tenant, userId);
    return (
      list.find(
        g =>
          g.scope.toolName === toolName ||
          (g.scope.toolPattern != null &&
            toolName.startsWith(g.scope.toolPattern.replace(/\.\*$/, '.'))),
      ) ?? null
    );
  }
  async insertGrant(row: GrantInsert): Promise<void> {
    this.grants.set(row.id, {
      ...row,
      createTime: row.createTime,
      updateTime: row.updateTime,
    });
  }
  async updateExpire(grantId: string, tenant: number, expireTimeMs: number): Promise<void> {
    const g = await this.findById(tenant, grantId);
    if (g) this.grants.set(grantId, { ...g, expireTime: expireTimeMs, updateTime: Date.now() });
  }
  async softRevoke(grantId: string, tenant: number, revokeUserId: string): Promise<void> {
    const g = await this.findById(tenant, grantId);
    if (g)
      this.grants.set(grantId, {
        ...g,
        deleted: Date.now(),
        revokeTime: Date.now(),
        revokeUserId,
      });
  }
}

/** 最小内存 Redis，覆盖单测所需命令（无外部依赖） */
class MemoryRedis {
  strings = new Map<string, { v: string; exp?: number }>();
  hashes = new Map<string, Map<string, string>>();
  messageHandlers: ((ch: string, msg: string) => void)[] = [];

  async get(key: string): Promise<string | null> {
    const e = this.strings.get(key);
    if (!e) return null;
    if (e.exp != null && Date.now() > e.exp) {
      this.strings.delete(key);
      return null;
    }
    return e.v;
  }

  async set(key: string, val: string, ...args: unknown[]): Promise<'OK'> {
    let exp: number | undefined;
    const pxIdx = args.indexOf('PX');
    if (pxIdx >= 0 && typeof args[pxIdx + 1] === 'number')
      exp = Date.now() + (args[pxIdx + 1] as number);
    const exIdx = args.indexOf('EX');
    if (exIdx >= 0 && typeof args[exIdx + 1] === 'number')
      exp = Date.now() + (args[exIdx + 1] as number) * 1000;
    this.strings.set(key, { v: val, exp });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.strings.delete(k)) n++;
    }
    return n;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const h = this.hashes.get(key);
    return h ? Object.fromEntries(h) : {};
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    let h = this.hashes.get(key);
    if (!h) {
      h = new Map();
      this.hashes.set(key, h);
    }
    const isNew = !h.has(field);
    h.set(field, value);
    return isNew ? 1 : 0;
  }

  async publish(channel: string, message: string): Promise<number> {
    for (const fn of this.messageHandlers) {
      try {
        fn(channel, message);
      } catch {
        /* ignore */
      }
    }
    return 1;
  }

  duplicate(): MemoryRedis {
    return this;
  }

  subscribe(_ch: string, cb?: (err: Error | null) => void): Promise<number> {
    cb?.(null);
    return Promise.resolve(1);
  }

  on(event: string, fn: (ch: string, msg: string) => void): void {
    if (event === 'message') this.messageHandlers.push(fn);
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): void {
    this.strings.clear();
    this.hashes.clear();
    this.messageHandlers = [];
  }
}

function asRedis(m: MemoryRedis): Redis {
  return m as unknown as Redis;
}

function svc(repo: IGrantRepository, redis: Redis | null, sfid = new SfidService()) {
  return new GrantService({
    repository: repo,
    redis,
    sfid,
    enableInvalidationSubscriber: false,
  });
}

describe('GrantService L1 cache', () => {
  it('L1 hit does not hit repository lists', async () => {
    const mem = new MemRepo();
    const service = svc(mem, null);
    const grant = makeGrant();
    service._l1Set('user:101:usr_test', [grant]);

    const result = await service.loadUserGrants(101, 'usr_test');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(grant.id);
  });

  it('L1 miss + 空仓库 → 空数组（不再抛 UNIMPLEMENTED）', async () => {
    const service = svc(createGrantRepository(null), null);
    const result = await service.loadUserGrants(101, 'no_cache_user');
    expect(result).toEqual([]);
  });

  it('L1 miss + 空管理员 grants → 空数组', async () => {
    const service = svc(createGrantRepository(null), null);
    const result = await service.loadAdminGrants(101);
    expect(result).toEqual([]);
  });

  it('L1 hit admin list', async () => {
    const service = svc(createGrantRepository(null), null);
    const grant = makeGrant({ form: 'G_A', grantorType: 'ADMIN', subject: {} });
    service._l1Set('admin:101', [grant]);

    const result = await service.loadAdminGrants(101);
    expect(result).toHaveLength(1);
  });

  it('invalidateUser removes L1 entry', async () => {
    const service = svc(createGrantRepository(null), null);
    service._l1Set('user:101:usr_test', [makeGrant()]);
    service.invalidateUser(101, 'usr_test');

    const result = await service.loadUserGrants(101, 'usr_test');
    expect(result).toEqual([]);
  });

  it('filterActive returns only non-revoked, non-expired grants', () => {
    const service = svc(createGrantRepository(null), null);
    const active = makeGrant({ deleted: 0 });
    const revoked = makeGrant({ deleted: Date.now(), id: '100000000000002' });
    const expired = makeGrant({ deleted: 0, expireTime: Date.now() - 1000, id: '100000000000003' });

    const result = service.filterActive([active, revoked, expired]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(active.id);
  });
});

describe('GrantService Phase 3 flows', () => {
  it('requestGrant 写入 Redis grantReq + 触发回调', async () => {
    const mem = new MemRepo();
    const redis = new MemoryRedis();
    const events: unknown[] = [];
    const sfid = new SfidService();
    const service = new GrantService({
      repository: mem,
      redis: asRedis(redis),
      sfid,
      enableInvalidationSubscriber: false,
      onGrantRequest: e => events.push(e),
    });

    const r = await service.requestGrant({
      tenant: 101,
      userId: 'u1',
      toolName: 't1',
      sessionId: 'sid',
    });
    expect(r.grantRequestId).toMatch(/^\d{19}$/);
    const raw = await redis.get(RedisKeys.authzGrantRequest(r.grantRequestId));
    expect(raw).toBeTruthy();
    expect(events).toHaveLength(1);
  });

  it('approveGrant：消费 pending 并插入 MemRepo', async () => {
    const mem = new MemRepo();
    const redis = new MemoryRedis();
    const sfid = new SfidService();
    const service = new GrantService({
      repository: mem,
      redis: asRedis(redis),
      sfid,
      enableInvalidationSubscriber: false,
    });
    const { grantRequestId } = await service.requestGrant({
      tenant: 101,
      userId: 'u1',
      toolName: 'platform.api.invoke',
    });
    const scope: GrantScope = { toolName: 'platform.api.invoke', action: 'ALLOW' };
    const g = await service.approveGrant(grantRequestId, scope, {
      tenant: 101,
      userId: 'u1',
      ttlSeconds: 3600,
    });
    expect(g.form).toBe('G_D');
    expect(g.subject.userId).toBe('u1');
    const pending = await redis.get(RedisKeys.authzGrantRequest(grantRequestId));
    expect(pending).toBeNull();
  });

  it('findActiveGrant：L2 Redis 命中', async () => {
    const mem = new MemRepo();
    const redis = new MemoryRedis();
    const sfid = new SfidService();
    const g = makeGrant({
      id: '100000000000099',
      tenant: 101,
      subject: { userId: 'u1' },
      scope: { toolName: 'x.read', action: 'ALLOW' },
    });
    await redis.set(
      RedisKeys.authzGrantActiveTool(101, 'u1', 'x.read'),
      JSON.stringify(g),
      'EX',
      60,
    );
    const service = svc(mem, asRedis(redis), sfid);
    const hit = await service.findActiveGrant('u1', 'x.read', { tenant: 101 });
    expect(hit?.id).toBe(g.id);
  });

  it('findActiveGrant：L2 miss → DB MemRepo', async () => {
    const mem = new MemRepo();
    const redis = new MemoryRedis();
    const sfid = new SfidService();
    const g = makeGrant({
      tenant: 101,
      subject: { userId: 'u2' },
      scope: { toolName: 'y.write', action: 'ALLOW' },
    });
    mem.grants.set(g.id, g);
    const service = svc(mem, asRedis(redis), sfid);
    const hit = await service.findActiveGrant('u2', 'y.write', { tenant: 101 });
    expect(hit?.id).toBe(g.id);
  });

  it('pubsub invalidate 清 L1 user 缓存', async () => {
    const mem = new MemRepo();
    const redis = new MemoryRedis();
    const service = new GrantService({
      repository: mem,
      redis: asRedis(redis),
      sfid: new SfidService(),
      enableInvalidationSubscriber: true,
    });
    service._l1Set('user:101:u3', [makeGrant({ subject: { userId: 'u3' } })]);
    await redis.publish(
      RedisKeys.pubsubGrantInvalidate(),
      JSON.stringify({ tenant: 101, userId: 'u3', reason: 'test' }),
    );
    const after = await service.loadUserGrants(101, 'u3');
    expect(after).toEqual([]);
  });

  it('waitForGrantResolution returns APPROVED when active grant appears', async () => {
    const mem = new MemRepo();
    const redis = new MemoryRedis();
    const service = svc(mem, asRedis(redis), new SfidService());
    const { grantRequestId } = await service.requestGrant({
      tenant: 101,
      userId: 'u4',
      toolName: 'z.read',
    });

    void service.approveGrant(grantRequestId, { toolName: 'z.read', action: 'ALLOW' }, {
      tenant: 101,
      userId: 'u4',
      ttlSeconds: 60,
    });

    const r = await service.waitForGrantResolution({
      grantRequestId,
      tenant: 101,
      userId: 'u4',
      toolName: 'z.read',
      timeoutMs: 2000,
      pollMs: 10,
    });
    expect(r).toBe('APPROVED');
  });

  it('waitForGrantResolution returns DENIED when pending request disappears without active grant', async () => {
    const mem = new MemRepo();
    const redis = new MemoryRedis();
    const service = svc(mem, asRedis(redis), new SfidService());
    const { grantRequestId } = await service.requestGrant({
      tenant: 101,
      userId: 'u5',
      toolName: 'z.write',
    });
    await service.denyGrant(grantRequestId, 'deny', { tenant: 101 });

    const r = await service.waitForGrantResolution({
      grantRequestId,
      tenant: 101,
      userId: 'u5',
      toolName: 'z.write',
      timeoutMs: 2000,
      pollMs: 10,
    });
    expect(r).toBe('DENIED');
  });

  it('waitForGrantResolution returns TIMEOUT when request stays pending', async () => {
    const mem = new MemRepo();
    const redis = new MemoryRedis();
    const service = svc(mem, asRedis(redis), new SfidService());
    const { grantRequestId } = await service.requestGrant({
      tenant: 101,
      userId: 'u6',
      toolName: 'z.long',
    });

    const r = await service.waitForGrantResolution({
      grantRequestId,
      tenant: 101,
      userId: 'u6',
      toolName: 'z.long',
      timeoutMs: 50,
      pollMs: 10,
    });
    expect(r).toBe('TIMEOUT');
  });
});
