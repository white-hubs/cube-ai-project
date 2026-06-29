import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createPool } from "mysql2/promise";

import { createTestRedisClient } from "@cube-ai/bun-server-ext-outbox";
import { RedisKeys } from "@cube-ai/contracts";
import {
  type MysqlRedisStack,
  applyGrantsMysqlSchema,
  applyMinimalMysqlSchema,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlRedis,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

import { AuthzGatewayService } from "../../src/bc/authz/authz-gateway.service";
import { ConsentPolicyEngine } from "../../src/bc/authz/consent-policy.engine";
import { GrantService, createGrantRepository } from "../../src/bc/authz/grant.service";
import { SfidService } from "../../src/infra/sfid/sfid.service";

/**
 * AuthZ — MySQL（grants 表）+ Redis Testcontainers。
 *
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/authz.testcontainers.test.ts
 *   bun run test:containers
 */

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

(run ? describe : describe.skip)("AuthZ integration [testcontainers]", () => {
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

  test("G-B：user-level grant → check 允许 user_default", async () => {
    const s = stackHolder.current!;
    const pool = createPool({
      bigNumberStrings: true,
      connectionLimit: 2,
      supportBigNumbers: true,
      uri: s.mysqlUrl,
    });
    const redis = createTestRedisClient(s.redisUrl);
    const sfid = new SfidService();
    const grantService = new GrantService({
      redis,
      repository: createGrantRepository(pool),
      sfid,
    });
    const gateway = new AuthzGatewayService(grantService, new ConsentPolicyEngine());
    const tenant = 1001;
    const userId = "u_integ_gb";
    grantService._l1Set(`user:${tenant}:${userId}`, [
      {
        createTime: Date.now(),
        deleted: 0,
        form: "G_B",
        grantorType: "USER",
        id: sfid.next(),
        origin: "USER_CENTER",
        scope: { action: "ALLOW", toolName: "platform.api.invoke" },
        subject: { userId },
        tenant,
        updateTime: Date.now(),
      },
    ]);
    const d = await gateway.check({
      args: {},
      consentPolicy: "EACH_CALL",
      tenant,
      toolName: "platform.api.invoke",
      userId,
    });
    expect(d.kind).toBe("ALLOW");
    expect(d.reason).toBe("user_default");
    await pool.end();
    await redis.quit();
  });

  test("NEVER：无 grant → policy_never", async () => {
    const grantService = new GrantService({
      redis: null,
      repository: createGrantRepository(null),
      sfid: new SfidService(),
    });
    const gateway = new AuthzGatewayService(grantService, new ConsentPolicyEngine());
    const out = await gateway.check({
      args: {},
      consentPolicy: "NEVER",
      tenant: 2002,
      toolName: "platform.apps.list",
      userId: "u_never",
    });
    expect(out.kind).toBe("ALLOW");
    expect(out.reason).toBe("policy_never");
  });

  test("L2：Redis authzGrantActiveTool round-trip", async () => {
    const s = stackHolder.current!;
    const redis = createTestRedisClient(s.redisUrl);
    const tenant = 1001;
    const userId = "u_l2";
    const tool = "t.roundtrip";
    const key = RedisKeys.authzGrantActiveTool(tenant, userId, tool);
    const payload = { check: "l2", id: "1", tenant };
    await redis.set(key, JSON.stringify(payload), "EX", 30);
    const raw = await redis.get(key);
    expect(JSON.parse(raw!)).toEqual(payload);
    await redis.del(key);
    await redis.quit();
  });
});
