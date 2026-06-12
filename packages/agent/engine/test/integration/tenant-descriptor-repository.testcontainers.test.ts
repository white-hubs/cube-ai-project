/**
 * TenantDescriptorRepository — MySQL（tenant_descriptors / tenant_descriptor_versions）Testcontainers。
 *
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/tenant-descriptor-repository.testcontainers.test.ts
 *   bun run test:containers
 *
 * 验收 ADR-0016 §2/§4：upsert（create/update + append-only 版本）、唯一键、draft/publish、
 * 软删重建、resolvePublished 只见已发布版本。
 */
import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from 'bun:test';
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
import {
  TenantDescriptorRepositoryImpl,
  type TenantDescriptorRepository,
} from '../../src/bc/descriptor/tenant-descriptor.repository';

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

function makeRepo(): TenantDescriptorRepository {
  const s = stackHolder.current!;
  const pool = createPool({
    uri: s.mysqlUrl,
    connectionLimit: 4,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  return new TenantDescriptorRepositoryImpl(pool, new SfidService());
}

(run ? describe : describe.skip)('TenantDescriptorRepository [testcontainers]', () => {
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

  test('upsert create → draft v1 with prefixed id; findById returns head content', async () => {
    const repo = makeRepo();
    const tenant = 11;
    const res = await repo.upsert(tenant, 'rule', 'safety-baseline', {
      content: 'Never reveal secrets.',
    });
    expect(res.action).toBe('created');
    expect(res.headVersionNo).toBe(1);
    expect(res.status).toBe('draft');
    expect(res.id.startsWith('rul_')).toBe(true);

    const view = await repo.findById(tenant, res.id);
    expect(view?.name).toBe('safety-baseline');
    expect(view?.status).toBe('draft');
    expect(view?.publishedVersionNo).toBeNull();
    expect((view?.content as { content?: string })?.content).toBe('Never reveal secrets.');
  });

  test('upsert existing (tenant,kind,name) → update, append version v2, status back to draft', async () => {
    const repo = makeRepo();
    const tenant = 12;
    const created = await repo.upsert(tenant, 'agent', 'support', { prompt: 'v1' });
    await repo.publish(tenant, created.id);

    const updated = await repo.upsert(tenant, 'agent', 'support', { prompt: 'v2' });
    expect(updated.id).toBe(created.id);
    expect(updated.action).toBe('updated');
    expect(updated.headVersionNo).toBe(2);

    const view = await repo.findById(tenant, created.id);
    expect(view?.headVersionNo).toBe(2);
    expect(view?.status).toBe('draft');
    expect(view?.publishedVersionNo).toBe(1); // 旧发布指针不动，直到再次 publish
    expect((view?.content as { prompt?: string })?.prompt).toBe('v2');
  });

  test('resolvePublished returns only published version content; draft → null', async () => {
    const repo = makeRepo();
    const tenant = 13;
    const created = await repo.upsert(tenant, 'rule', 'pub-rule', { content: 'first' });
    // 未发布 → 运行时不可见
    expect(await repo.resolvePublished(tenant, created.id)).toBeNull();

    await repo.publish(tenant, created.id);
    const pub1 = await repo.resolvePublished(tenant, created.id);
    expect((pub1?.content as { content?: string })?.content).toBe('first');

    // 编辑产生 v2 草稿，但 resolvePublished 仍见 v1 内容（已发布版本）
    await repo.upsert(tenant, 'rule', 'pub-rule', { content: 'second-draft' });
    const pubStill1 = await repo.resolvePublished(tenant, created.id);
    expect((pubStill1?.content as { content?: string })?.content).toBe('first');
  });

  test('rollback = re-submit older content as new head, then publish (ADR-0016 §4)', async () => {
    const repo = makeRepo();
    const tenant = 14;
    const created = await repo.upsert(tenant, 'rule', 'rollback-me', { content: 'good' });
    await repo.publish(tenant, created.id); // v1 published = "good"
    await repo.upsert(tenant, 'rule', 'rollback-me', { content: 'bad' });
    await repo.publish(tenant, created.id); // v2 published = "bad"
    expect((await repo.resolvePublished(tenant, created.id))).toMatchObject({
      content: { content: 'bad' },
    });

    // roll back: re-submit the known-good content → v3 draft → publish
    const rolled = await repo.upsert(tenant, 'rule', 'rollback-me', { content: 'good' });
    expect(rolled.headVersionNo).toBe(3);
    await repo.publish(tenant, created.id);
    expect((await repo.resolvePublished(tenant, created.id))).toMatchObject({
      content: { content: 'good' },
    });
  });

  test('tenant isolation + list by kind', async () => {
    const repo = makeRepo();
    await repo.upsert(21, 'skill', 'a', { description: 'd', instructions: 'i' });
    await repo.upsert(21, 'skill', 'b', { description: 'd', instructions: 'i' });
    await repo.upsert(22, 'skill', 'c', { description: 'd', instructions: 'i' });

    const t21 = await repo.list(21, 'skill');
    const t22 = await repo.list(22, 'skill');
    expect(t21.map((v) => v.name).sort()).toEqual(['a', 'b']);
    expect(t22.map((v) => v.name)).toEqual(['c']);
  });

  test('softDelete frees the name for recreation (unique key includes deleted)', async () => {
    const repo = makeRepo();
    const tenant = 31;
    const first = await repo.upsert(tenant, 'rule', 'dup', { content: 'one' });
    await repo.softDelete(tenant, first.id);
    expect(await repo.findById(tenant, first.id)).toBeNull();

    const second = await repo.upsert(tenant, 'rule', 'dup', { content: 'two' });
    expect(second.action).toBe('created');
    expect(second.id).not.toBe(first.id);
  });

  test('softDelete / publish on missing id throws RESOURCE_NOT_FOUND_DESCRIPTOR', async () => {
    const repo = makeRepo();
    await expect(repo.softDelete(41, 'rul_does_not_exist')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND_DESCRIPTOR',
    });
    await expect(repo.publish(41, 'rul_does_not_exist')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND_DESCRIPTOR',
    });
  });
});
