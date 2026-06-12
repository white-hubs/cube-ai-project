/**
 * 租户 descriptor 运行时解析 → session snapshot 水合（ADR-0016 §5/§7）—— MySQL Testcontainers。
 *
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/descriptor-runtime-resolution.testcontainers.test.ts
 *
 * 验收：已发布 agt_/rul_ → 解析进 agentSnapshotJson.rules 且注入 prompt；未发布 → 会话创建 not-found。
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
import { OutboxWriterImpl } from '@cube-ai/bun-server-ext-outbox';
import { SfidService } from '../../src/infra/sfid/sfid.service';
import { SessionRepositoryImpl } from '../../src/bc/session/repository/session.repository';
import { SessionService } from '../../src/bc/session/session.service';
import {
  TenantDescriptorRepositoryImpl,
  TenantDescriptorResolver,
} from '../../src/bc/descriptor';

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

function makeSessionStack() {
  const s = stackHolder.current!;
  const pool = createPool({
    uri: s.mysqlUrl,
    connectionLimit: 4,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  const sfid = new SfidService();
  const descRepo = new TenantDescriptorRepositoryImpl(pool, sfid);
  const resolver = new TenantDescriptorResolver(descRepo);
  const sessionSvc = new SessionService(
    sfid,
    new SessionRepositoryImpl(pool),
    pool,
    new OutboxWriterImpl({ nextSfid: () => sfid.next() }),
    undefined, // no file descriptorLoader → forces tenant resolver path for agt_
    undefined,
    undefined,
    resolver,
  );
  return { pool, descRepo, resolver, sessionSvc };
}

(run ? describe : describe.skip)('Tenant descriptor runtime resolution [testcontainers]', () => {
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

  test('published agt_ + rul_ → hydrated into snapshot.rules and injected into prompt', async () => {
    const { descRepo, sessionSvc, pool } = makeSessionStack();
    const tenant = 101;

    const rule = await descRepo.upsert(tenant, 'rule', 'no-secrets', {
      content: 'Never reveal secrets.',
    });
    await descRepo.publish(tenant, rule.id);

    const agent = await descRepo.upsert(tenant, 'agent', 'support', {
      prompt: 'You are a support agent.',
      ruleRefs: [rule.id],
    });
    await descRepo.publish(tenant, agent.id);

    const created = await sessionSvc.createSession(tenant, 'user-1', 'User One', {
      agentId: agent.id,
    } as never);
    expect(created.id).toBeTruthy();

    const repo = new SessionRepositoryImpl(pool);
    const row = await repo.findById(tenant, created.id);
    const snap = row!.agentSnapshotJson as {
      rules: { name: string; content: { content: string } }[];
      agent: { content: { prompt: string } };
    };
    expect(snap.rules.map((r) => r.name)).toContain('no-secrets');
    expect(snap.rules[0]!.content.content).toBe('Never reveal secrets.');
    // prompt 注入：rule 文本 + agent prompt 都在
    expect(snap.agent.content.prompt).toContain('Never reveal secrets.');
    expect(snap.agent.content.prompt).toContain('You are a support agent.');
  });

  test('unpublished rul_ referenced by agent → session creation fails not-found', async () => {
    const { descRepo, sessionSvc } = makeSessionStack();
    const tenant = 102;

    const rule = await descRepo.upsert(tenant, 'rule', 'draft-rule', { content: 'draft only' });
    // 不 publish
    const agent = await descRepo.upsert(tenant, 'agent', 'agent2', {
      prompt: 'P',
      ruleRefs: [rule.id],
    });
    await descRepo.publish(tenant, agent.id);

    await expect(
      sessionSvc.createSession(tenant, 'user-1', 'User One', { agentId: agent.id } as never),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND_DESCRIPTOR' });
  });

  test('unpublished agt_ → session creation fails not-found', async () => {
    const { descRepo, sessionSvc } = makeSessionStack();
    const tenant = 103;
    const agent = await descRepo.upsert(tenant, 'agent', 'unpub', { prompt: 'P' });
    // 不 publish
    await expect(
      sessionSvc.createSession(tenant, 'user-1', 'User One', { agentId: agent.id } as never),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND_DESCRIPTOR' });
  });
});
