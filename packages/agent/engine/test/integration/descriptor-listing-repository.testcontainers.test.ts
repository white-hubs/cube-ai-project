import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createPool } from "mysql2/promise";

/**
 * Descriptor listing repository — MySQL Testcontainers.
 *
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/descriptor-listing-repository.testcontainers.test.ts
 */
import {
  type MysqlRedisStack,
  applyMinimalMysqlSchema,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlRedis,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

import { DescriptorListingRepositoryImpl } from "../../src/bc/descriptor/descriptor-listing.repository";
import { TenantDescriptorRepositoryImpl } from "../../src/bc/descriptor/tenant-descriptor.repository";
import { SfidService } from "../../src/infra/sfid/sfid.service";

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

(run ? describe : describe.skip)("DescriptorListingRepository [testcontainers]", () => {
  beforeAll(async () => {
    const s = await startMysqlRedis();
    try {
      await applyMinimalMysqlSchema(s.mysqlUrl);
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

  test(
    "list/unlist and browse tenant library projection",
    async () => {
      const s = stackHolder.current!;
      const pool = createPool({
        bigNumberStrings: true,
        connectionLimit: 4,
        supportBigNumbers: true,
        uri: s.mysqlUrl,
      });
      try {
        const sfid = new SfidService();
        const descriptors = new TenantDescriptorRepositoryImpl(pool, sfid);
        const listings = new DescriptorListingRepositoryImpl(pool);
        const tenant = 701;

        const created = await descriptors.upsert(
          tenant,
          "agent",
          "support",
          {
            displayName: "Support Agent",
            prompt: "published prompt",
            tags: ["support"],
          },
          "alice",
        );
        await descriptors.publish(tenant, created.id, "alice");

        const listed = await listings.list(tenant, created.id, 1, "alice");
        expect(listed).toMatchObject({
          descriptorId: created.id,
          listed: true,
          publisherUserId: "alice",
          sharedVersionNo: 1,
        });

        const library = await listings.browseListed(tenant, "agent");
        expect(library).toEqual([
          {
            displayName: "Support Agent",
            kind: "agent",
            ref: created.id,
            sharedVersionNo: 1,
            tags: ["support"],
            tier: "tenant",
          },
        ]);
        expect(JSON.stringify(library)).not.toContain("published prompt");

        const detail = await listings.getListed(tenant, "agent", created.id);
        expect(detail).toMatchObject({
          ref: created.id,
          content: {
            displayName: "Support Agent",
            prompt: "published prompt",
            tags: ["support"],
          },
        });

        const unlisted = await listings.unlist(tenant, created.id, "alice");
        expect(unlisted.listed).toBe(false);
        expect(unlisted.sharedVersionNo).toBe(1);
        expect(await listings.browseListed(tenant, "agent")).toEqual([]);
      } finally {
        await pool.end();
      }
    },
    HOOK_MS,
  );
});
