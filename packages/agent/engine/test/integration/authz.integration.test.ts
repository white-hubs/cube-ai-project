/**
 * P3-03 AuthZ / Grant — live MySQL + Redis（已由 `authz.testcontainers.test.ts` 取代）。
 *
 * Testcontainers：`USE_TESTCONTAINERS=1` / `bun run test:containers`
 */

import { describe, test, expect } from 'bun:test';
import { createPool } from 'mysql2/promise';
import Redis from 'ioredis';
import { RedisKeys } from '@cube-ai/contracts';
import { GrantService, createGrantRepository } from '../../src/bc/authz/grant.service';
import { AuthzGatewayService } from '../../src/bc/authz/authz-gateway.service';
import { ConsentPolicyEngine } from '../../src/bc/authz/consent-policy.engine';
import { SfidService } from '../../src/infra/sfid/sfid.service';

describe.skip('AuthZ integration (live mysql + redis)', () => {
  test('G-B：user-level grant → check 允许 user_default', async () => {
    const dsn = process.env.AGENTIC_ENGINE_MYSQL_DSN;
    const url = process.env.AGENTIC_ENGINE_REDIS_URL;
    if (!dsn || !url) {
      throw new Error('Set AGENTIC_ENGINE_MYSQL_DSN and AGENTIC_ENGINE_REDIS_URL');
    }
    const pool = createPool({ uri: dsn, connectionLimit: 2 });
    const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    await redis.connect();
    const sfid = new SfidService();
    const grantService = new GrantService({
      repository: createGrantRepository(pool),
      redis,
      sfid,
    });
    const gateway = new AuthzGatewayService(grantService, new ConsentPolicyEngine());
    const tenant = 1001;
    const userId = 'u_integ_gb';
    grantService._l1Set(`user:${tenant}:${userId}`, [
      {
        id: sfid.next(),
        tenant,
        form: 'G_B',
        grantorType: 'USER',
        subject: { userId },
        scope: { toolName: 'platform.api.invoke', action: 'ALLOW' },
        origin: 'USER_CENTER',
        deleted: 0,
        createTime: Date.now(),
        updateTime: Date.now(),
      },
    ]);
    const d = await gateway.check({
      tenant,
      userId,
      toolName: 'platform.api.invoke',
      args: {},
      consentPolicy: 'EACH_CALL',
    });
    expect(d.kind).toBe('ALLOW');
    expect(d.reason).toBe('user_default');
    await pool.end();
    redis.disconnect();
  });

  test('NEVER：无 grant → policy_never', async () => {
    const grantService = new GrantService({
      repository: createGrantRepository(null),
      redis: null,
      sfid: new SfidService(),
    });
    const gateway = new AuthzGatewayService(grantService, new ConsentPolicyEngine());
    const out = await gateway.check({
      tenant: 2002,
      userId: 'u_never',
      toolName: 'platform.apps.list',
      args: {},
      consentPolicy: 'NEVER',
    });
    expect(out.kind).toBe('ALLOW');
    expect(out.reason).toBe('policy_never');
  });

  test('L2：Redis authzGrantActiveTool round-trip', async () => {
    const url = process.env.AGENTIC_ENGINE_REDIS_URL;
    if (!url) throw new Error('AGENTIC_ENGINE_REDIS_URL');
    const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    await redis.connect();
    const tenant = 1001;
    const userId = 'u_l2';
    const tool = 't.roundtrip';
    const key = RedisKeys.authzGrantActiveTool(tenant, userId, tool);
    const payload = { id: '1', tenant, check: 'l2' };
    await redis.set(key, JSON.stringify(payload), 'EX', 30);
    const raw = await redis.get(key);
    expect(JSON.parse(raw!)).toEqual(payload);
    await redis.del(key);
    redis.disconnect();
  });
});
