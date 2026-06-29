import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createPool } from "mysql2/promise";

import { OutboxWriterImpl } from "@cube-ai/bun-server-ext-outbox";
import {
  type MysqlRedisStack,
  applyMinimalMysqlSchema,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlRedis,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

import {
  DescriptorListingRepositoryImpl,
  RunnableAgentResolver,
  TenantDescriptorRepositoryImpl,
  TenantDescriptorResolver,
  UserShelfRepositoryImpl,
} from "../../src/bc/descriptor";
import { SessionRepositoryImpl } from "../../src/bc/session/repository/session.repository";
import { SessionService } from "../../src/bc/session/session.service";
import { SfidService } from "../../src/infra/sfid/sfid.service";

/**
 * 租户 descriptor 运行时解析 → session snapshot 水合（ADR-0016 §5/§7）—— MySQL Testcontainers。
 *
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/descriptor-runtime-resolution.testcontainers.test.ts
 *
 * 验收：已发布 agt_/rul_ → 解析进 agentSnapshotJson.rules 且注入 prompt；未发布 → 会话创建 not-found。
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

function makeSessionStack() {
  const s = stackHolder.current!;
  const pool = createPool({
    bigNumberStrings: true,
    connectionLimit: 4,
    supportBigNumbers: true,
    uri: s.mysqlUrl,
  });
  const sfid = new SfidService();
  const descRepo = new TenantDescriptorRepositoryImpl(pool, sfid);
  const listingRepo = new DescriptorListingRepositoryImpl(pool);
  const shelfRepo = new UserShelfRepositoryImpl(pool, sfid);
  const resolver = new TenantDescriptorResolver(descRepo);
  const runnableResolver = new RunnableAgentResolver(descRepo, listingRepo, shelfRepo);
  const sessionSvc = new SessionService(
    sfid,
    new SessionRepositoryImpl(pool),
    pool,
    new OutboxWriterImpl({ nextSfid: () => sfid.next() }),
    undefined, // no file descriptorLoader → forces tenant resolver path for agt_
    undefined,
    undefined,
    resolver,
    undefined,
    runnableResolver,
  );
  return { descRepo, listingRepo, pool, resolver, sessionSvc, shelfRepo };
}

(run ? describe : describe.skip)("Tenant descriptor runtime resolution [testcontainers]", () => {
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

  test("published agt_ + rul_ → hydrated into snapshot.rules and injected into prompt", async () => {
    const { descRepo, sessionSvc, pool } = makeSessionStack();
    const tenant = 101;

    const rule = await descRepo.upsert(tenant, "rule", "no-secrets", {
      content: "Never reveal secrets.",
    });
    await descRepo.publish(tenant, rule.id);

    const agent = await descRepo.upsert(
      tenant,
      "agent",
      "support",
      {
        prompt: "You are a support agent.",
        ruleRefs: [rule.id],
      },
      "user-1",
    );
    await descRepo.publish(tenant, agent.id, "user-1");

    const created = await sessionSvc.createSession(tenant, "user-1", "User One", {
      agentId: agent.id,
    } as never);
    expect(created.id).toBeTruthy();

    const repo = new SessionRepositoryImpl(pool);
    const row = await repo.findById(tenant, created.id);
    const snap = row!.agentSnapshotJson as {
      rules: { name: string; content: { content: string } }[];
      agent: { content: { prompt: string } };
    };
    expect(snap.rules.map((r) => r.name)).toContain("no-secrets");
    expect(snap.rules[0]!.content.content).toBe("Never reveal secrets.");
    // prompt 注入：rule 文本 + agent prompt 都在
    expect(snap.agent.content.prompt).toContain("Never reveal secrets.");
    expect(snap.agent.content.prompt).toContain("You are a support agent.");
  });

  test("unpublished rul_ referenced by agent → session creation fails not-found", async () => {
    const { descRepo, sessionSvc } = makeSessionStack();
    const tenant = 102;

    const rule = await descRepo.upsert(tenant, "rule", "draft-rule", { content: "draft only" });
    // 不 publish
    const agent = await descRepo.upsert(tenant, "agent", "agent2", {
      prompt: "P",
      ruleRefs: [rule.id],
    });
    await descRepo.publish(tenant, agent.id);

    await expect(sessionSvc.createSession(tenant, "user-1", "User One", { agentId: agent.id } as never)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND_DESCRIPTOR",
    });
  });

  test("unpublished agt_ → session creation fails not-found", async () => {
    const { descRepo, sessionSvc } = makeSessionStack();
    const tenant = 103;
    const agent = await descRepo.upsert(tenant, "agent", "unpub", { prompt: "P" });
    // 不 publish
    await expect(sessionSvc.createSession(tenant, "user-1", "User One", { agentId: agent.id } as never)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND_DESCRIPTOR",
    });
  });

  test("owner can run draft agent and snapshot records draft version sentinel", async () => {
    const { descRepo, sessionSvc, pool } = makeSessionStack();
    const tenant = 104;
    const agent = await descRepo.upsert(tenant, "agent", "draft-owned", { prompt: "Draft P" }, "alice");

    const created = await sessionSvc.createSession(tenant, "alice", "Alice", {
      agentId: agent.id,
    } as never);

    const row = await new SessionRepositoryImpl(pool).findById(tenant, created.id);
    expect(row?.agentVersionNo).toBe(0);
    const snapshot = row?.agentSnapshotJson as { agent: { versionNo: number; content: { prompt: string } } } | undefined;
    expect(snapshot?.agent.versionNo).toBe(0);
    expect(snapshot?.agent.content.prompt).toContain("Draft P");
  });

  test("non-owner runs installed floating ref at listed shared version", async () => {
    const { descRepo, listingRepo, shelfRepo, sessionSvc, pool } = makeSessionStack();
    const tenant = 105;
    const agent = await descRepo.upsert(tenant, "agent", "listed", { prompt: "V1" }, "alice");
    await descRepo.publish(tenant, agent.id, "alice");
    await descRepo.upsert(tenant, "agent", "listed", { prompt: "V2" }, "alice");
    await descRepo.publish(tenant, agent.id, "alice");
    await listingRepo.list(tenant, agent.id, 2, "alice");
    await shelfRepo.insertRef(tenant, "bob", "agent", agent.id, null);

    const created = await sessionSvc.createSession(tenant, "bob", "Bob", {
      agentId: agent.id,
    } as never);

    const row = await new SessionRepositoryImpl(pool).findById(tenant, created.id);
    expect(row?.agentVersionNo).toBe(2);
    const snapshot = row?.agentSnapshotJson as { agent: { content: { prompt: string } } } | undefined;
    expect(snapshot?.agent.content.prompt).toContain("V2");
  });
});
