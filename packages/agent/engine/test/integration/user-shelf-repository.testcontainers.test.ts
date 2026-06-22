/**
 * User descriptor shelf repository — MySQL Testcontainers.
 *
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/user-shelf-repository.testcontainers.test.ts
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { createPool } from 'mysql2/promise';
import {
  applyMinimalMysqlSchema,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlRedis,
  stopTrackedTestcontainersIfAny,
  type MysqlRedisStack,
} from '@cube-ai/test-infra';
import { SfidService } from '../../src/infra/sfid/sfid.service';
import { DescriptorListingRepositoryImpl } from '../../src/bc/descriptor/descriptor-listing.repository';
import { TenantDescriptorRepositoryImpl } from '../../src/bc/descriptor/tenant-descriptor.repository';
import { UserShelfRepositoryImpl } from '../../src/bc/descriptor/user-shelf.repository';

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

(run ? describe : describe.skip)('UserShelfRepository [testcontainers]', () => {
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

  test('ref install, patch, remove and authored upsert', async () => {
    const s = stackHolder.current!;
    const pool = createPool({
      uri: s.mysqlUrl,
      connectionLimit: 4,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    try {
      const sfid = new SfidService();
      const descriptors = new TenantDescriptorRepositoryImpl(pool, sfid);
      const listings = new DescriptorListingRepositoryImpl(pool);
      const shelves = new UserShelfRepositoryImpl(pool, sfid);
      const tenant = 801;

      const agent = await descriptors.upsert(tenant, 'agent', 'support', {
        prompt: 'p',
        displayName: 'Support Agent',
      }, 'alice');
      await descriptors.publish(tenant, agent.id, 'alice');
      await listings.list(tenant, agent.id, 1, 'alice');

      const installed = await shelves.insertRef(tenant, 'bob', 'agent', agent.id, null);
      expect(installed.id.startsWith('she_')).toBe(true);
      expect(installed).toMatchObject({
        targetKind: 'agent',
        targetId: agent.id,
        source: 'ref',
        pinVersionNo: null,
        effectiveVersionNo: 1,
        runnableStatus: 'runnable',
        displayName: 'Support Agent',
      });

      const pinned = await shelves.patch(tenant, 'bob', installed.id, { pinVersionNo: 1 });
      expect(pinned.pinVersionNo).toBe(1);

      const disabled = await shelves.patch(tenant, 'bob', installed.id, { enabled: false });
      expect(disabled.enabled).toBe(false);
      expect(disabled.runnableStatus).toBe('disabled');

      await shelves.softDelete(tenant, 'bob', installed.id);
      expect(await shelves.listByUser(tenant, 'bob', 'agent')).toEqual([]);

      const authored1 = await shelves.upsertAuthored(tenant, 'alice', agent.id, 'agent');
      const authored2 = await shelves.upsertAuthored(tenant, 'alice', agent.id, 'agent');
      expect(authored2.id).toBe(authored1.id);
      expect(authored1).toMatchObject({
        targetKind: 'agent',
        targetId: agent.id,
        source: 'authored',
        effectiveVersionNo: null,
        runnableStatus: 'runnable',
      });
    } finally {
      await pool.end();
    }
  }, HOOK_MS);
});
