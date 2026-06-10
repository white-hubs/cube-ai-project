/**
 * AuthZ — MySQL（grants 表）+ Redis Testcontainers。
 *
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/authz.testcontainers.test.ts
 *   bun run test:containers
 */
import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from 'bun:test';
import { createPool } from 'mysql2/promise';
import { RedisKeys } from '@cube-ai/contracts';
import {
  applyGrantsMysqlSchema,
  applyMinimalMysqlSchema,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlRedis,
  stopTrackedTestcontainersIfAny,
  type MysqlRedisStack,
} from '@cube-ai/test-infra';
import { createTestRedisClient } from '@cube-ai/bun-server-ext-outbox';
import { GrantService, createGrantRepository } from '../../src/bc/authz/grant.service';
import { AuthzGatewayService } from '../../src/bc/authz/authz-gateway.service';
import { ConsentPolicyEngine } from '../../src/bc/authz/consent-policy.engine';
import { SfidService } from '../../src/infra/sfid/sfid.service';

const run = await resolveShouldRunTestcontainers();
const stackHolder: { current: MysqlRedisStack | null } = { current: null };
const HOOK_MS = 1_800_000;

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

(run ? describe : describe.skip)('AuthZ integration [testcontainers]', () => {
  beforeAll(async () => {
    const s = await startMysqlRedis();
    try {
      await applyMinimalMysqlSchema(s.mysqlUrl);
      await applyGrantsMysqlSchema(s.mysqlUrl);
      stackHolder.current = s;
    } catch (e) {
      await s.stop();
      throw e;
    }
  }, HOOK_MS);

  afterAll(async () => {
    if (stackHolder.current) {
      await stackHolder.current.stop().catch(() => {});
      stackHolder.current = null;
    }
    await stopTrackedTestcontainersIfAny();
  });

  test('G-B：user-level grant → check 允许 user_default', async () => {
    const s = stackHolder.current!;
    const pool = createPool({
      uri: s.mysqlUrl,
      connectionLimit: 2,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    const redis = createTestRedisClient(s.redisUrl);
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
    await redis.quit();
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
    const s = stackHolder.current!;
    const redis = createTestRedisClient(s.redisUrl);
    const tenant = 1001;
    const userId = 'u_l2';
    const tool = 't.roundtrip';
    const key = RedisKeys.authzGrantActiveTool(tenant, userId, tool);
    const payload = { id: '1', tenant, check: 'l2' };
    await redis.set(key, JSON.stringify(payload), 'EX', 30);
    const raw = await redis.get(key);
    expect(JSON.parse(raw!)).toEqual(payload);
    await redis.del(key);
    await redis.quit();
  });
});
