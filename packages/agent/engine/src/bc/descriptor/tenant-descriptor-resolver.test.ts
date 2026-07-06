import { describe, test, expect, mock } from "bun:test";
import type Redis from "ioredis";

import { RedisKeys } from "@cube-ai/contracts";
import type { TenantDescriptorView } from "@cube-ai/contracts";

import { TenantDescriptorResolver } from "./tenant-descriptor-resolver";
import type { TenantDescriptorRepository } from "./tenant-descriptor.repository";

/** 最小内存 Redis pub/sub 假件（同构于 grant.service.test.ts 的 MemoryRedis）。 */
class MemoryPubSub {
  messageHandlers: ((ch: string, msg: string) => void)[] = [];

  async publish(channel: string, message: string): Promise<number> {
    for (const fn of this.messageHandlers) fn(channel, message);
    return 1;
  }

  duplicate(): MemoryPubSub {
    return this;
  }

  subscribe(_ch: string, cb?: (err: Error | null) => void): Promise<number> {
    cb?.(null);
    return Promise.resolve(1);
  }

  on(event: string, fn: (ch: string, msg: string) => void): void {
    if (event === "message") this.messageHandlers.push(fn);
  }
}

function asRedis(m: MemoryPubSub): Redis {
  return m as unknown as Redis;
}

function view(over: Partial<TenantDescriptorView>): TenantDescriptorView {
  return {
    id: "x",
    kind: "rule",
    name: "n",
    status: "published",
    headVersionNo: 1,
    publishedVersionNo: 1,
    content: {},
    createTime: 0,
    updateTime: 0,
    ...over,
  };
}

function repoWith(
  resolvePublished: (t: number, id: string) => Promise<TenantDescriptorView | null>,
  findById?: (t: number, id: string) => Promise<TenantDescriptorView | null>,
) {
  return {
    upsert: mock(),
    findById: mock(findById ?? (async () => null)),
    findByName: mock(),
    list: mock(),
    publish: mock(),
    softDelete: mock(),
    resolvePublished: mock(resolvePublished),
  } as unknown as TenantDescriptorRepository & {
    resolvePublished: ReturnType<typeof mock>;
    findById: ReturnType<typeof mock>;
  };
}

describe("TenantDescriptorResolver — prefix routing + published-only + cache", () => {
  test("bare name (no prefix) is never routed to DB → null/undefined without a query", async () => {
    const repo = repoWith(async () => view({}));
    const r = new TenantDescriptorResolver(repo);
    expect(await r.getAgentRecord(1, "support")).toBeNull();
    expect(await r.getRule(1, "safety")).toBeUndefined();
    expect(await r.getSkill(1, "review")).toBeUndefined();
    expect((repo as unknown as { resolvePublished: ReturnType<typeof mock> }).resolvePublished).not.toHaveBeenCalled();
  });

  test("rul_ prefix → RuleDescriptor mapped from published content", async () => {
    const repo = repoWith(async (_t, id) =>
      view({ id, kind: "rule", name: "safety", content: { content: "No secrets.", description: "why", version: "2.0.0" } }),
    );
    const r = new TenantDescriptorResolver(repo);
    const rule = await r.getRule(7, "rul_123");
    expect(rule).toEqual({ kind: "rule", name: "safety", content: "No secrets.", version: "2.0.0", description: "why" });
  });

  test("agt_ prefix → agent record exposes both prompt and instructions + refs", async () => {
    const repo = repoWith(async (_t, id) =>
      view({
        id,
        kind: "agent",
        name: "support",
        content: { prompt: "You are support.", ruleRefs: ["rul_1"], skillRefs: [], availableTools: ["web"] },
      }),
    );
    const r = new TenantDescriptorResolver(repo);
    const rec = await r.getAgentRecord(7, "agt_9");
    expect(rec).toMatchObject({
      prompt: "You are support.",
      instructions: "You are support.",
      ruleRefs: ["rul_1"],
      availableTools: ["web"],
    });
  });

  test("skl_ prefix → SkillDescriptor with kind/name/instructions", async () => {
    const repo = repoWith(async (_t, id) =>
      view({ id, kind: "skill", name: "review", content: { description: "Review", instructions: "read diff" } }),
    );
    const r = new TenantDescriptorResolver(repo);
    const skill = (await r.getSkill(7, "skl_5")) as unknown as Record<string, unknown>;
    expect(skill.kind).toBe("skill");
    expect(skill.name).toBe("review");
    expect(skill.instructions).toBe("read diff");
  });

  test("skl_ prefix → tenant activation is respected, not silently downgraded to semantic", async () => {
    const repo = repoWith(async (_t, id) =>
      view({
        id,
        kind: "skill",
        name: "review",
        content: { description: "Review", instructions: "read diff", activation: { mode: "manual" } },
      }),
    );
    const r = new TenantDescriptorResolver(repo);
    const skill = (await r.getSkill(7, "skl_5")) as unknown as { activation: { mode: string } };
    expect(skill.activation).toEqual({ mode: "manual" });
  });

  test("skl_ prefix → legacy row without activation falls back to semantic (rc.13 clean break)", async () => {
    const repo = repoWith(async (_t, id) =>
      view({
        id,
        kind: "skill",
        name: "review",
        content: { description: "Review", instructions: "read diff" },
      }),
    );
    const r = new TenantDescriptorResolver(repo);
    const skill = (await r.getSkill(7, "skl_5")) as unknown as { activation: { mode: string } };
    expect(skill.activation).toEqual({ mode: "semantic" });
  });

  test("unpublished (resolvePublished → null) → undefined/null", async () => {
    const repo = repoWith(async () => null);
    const r = new TenantDescriptorResolver(repo);
    expect(await r.getRule(1, "rul_1")).toBeUndefined();
    expect(await r.getAgentRecord(1, "agt_1")).toBeNull();
  });

  test("kind mismatch (id prefix vs stored kind) → not returned", async () => {
    const repo = repoWith(async (_t, id) => view({ id, kind: "agent", name: "x", content: { prompt: "p" } }));
    const r = new TenantDescriptorResolver(repo);
    // asking for a rule but the row is an agent → undefined
    expect(await r.getRule(1, "rul_1")).toBeUndefined();
  });

  test("entry cache: second hit within TTL does not re-query; invalidate forces refetch", async () => {
    let calls = 0;
    const repo = repoWith(async (_t, id) => {
      calls++;
      return view({ id, kind: "rule", name: "safety", content: { content: `v${calls}` } });
    });
    const r = new TenantDescriptorResolver(repo, 10_000);
    const a = await r.getRule(1, "rul_1");
    const b = await r.getRule(1, "rul_1");
    expect(calls).toBe(1);
    expect((a as { content: string }).content).toBe("v1");
    expect((b as { content: string }).content).toBe("v1");

    r.invalidate(1, "rul_1");
    const c = await r.getRule(1, "rul_1");
    expect(calls).toBe(2);
    expect((c as { content: string }).content).toBe("v2");
  });

  test("invalidateAll clears every tenant entry", async () => {
    let calls = 0;
    const repo = repoWith(async (_t, id) => {
      calls++;
      return view({ id, kind: "rule", name: "n", content: { content: "c" } });
    });
    const r = new TenantDescriptorResolver(repo, 10_000);
    await r.getRule(1, "rul_1");
    await r.getRule(2, "rul_2");
    expect(calls).toBe(2);
    r.invalidateAll();
    await r.getRule(1, "rul_1");
    expect(calls).toBe(3);
  });
});

// 所有权感知运行时解析（ADR-0016 addendum / 「我的技能」语义）：草稿只对 owner 可见，
// publish 只决定对其他用户/技能库的可见性。owner 分支读 findById（草稿、绕过 published 缓存），
// 非 owner 分支保持 resolvePublished（未发布 → 拿不到）。与 RunnableAgentResolver 的 owner 语义对齐。
describe("TenantDescriptorResolver — owner-aware draft resolution", () => {
  test("skl_ owner sees own DRAFT (unpublished) via findById, not resolvePublished", async () => {
    const repo = repoWith(
      async () => null, // resolvePublished: 草稿从未发布
      async (_t, id) =>
        view({
          id,
          kind: "skill",
          name: "greeting",
          ownerUserId: "u-owner",
          status: "draft",
          publishedVersionNo: null,
          content: { description: "d", instructions: "say 主公" },
        }),
    );
    const r = new TenantDescriptorResolver(repo);
    const skill = (await r.getSkill(7, "skl_5", "u-owner")) as unknown as Record<string, unknown> | undefined;
    expect(skill?.["kind"]).toBe("skill");
    expect(skill?.["instructions"]).toBe("say 主公");
  });

  test("skl_ non-owner does NOT see an unpublished (draft) skill", async () => {
    const repo = repoWith(
      async () => null,
      async (_t, id) =>
        view({
          id,
          kind: "skill",
          name: "greeting",
          ownerUserId: "u-owner",
          status: "draft",
          publishedVersionNo: null,
          content: { description: "d", instructions: "say 主公" },
        }),
    );
    const r = new TenantDescriptorResolver(repo);
    expect(await r.getSkill(7, "skl_5", "someone-else")).toBeUndefined();
  });

  test("skl_ non-owner sees the PUBLISHED body, never the owner's draft (no leak, no regression)", async () => {
    const repo = repoWith(
      async (_t, id) =>
        view({
          id,
          kind: "skill",
          name: "greeting",
          ownerUserId: "u-owner",
          publishedVersionNo: 3,
          content: { description: "d", instructions: "published body" },
        }),
      async (_t, id) =>
        view({
          id,
          kind: "skill",
          name: "greeting",
          ownerUserId: "u-owner",
          status: "draft",
          content: { description: "d", instructions: "unpublished draft body" },
        }),
    );
    const r = new TenantDescriptorResolver(repo);
    const skill = (await r.getSkill(7, "skl_5", "someone-else")) as unknown as Record<string, unknown> | undefined;
    expect(skill?.["instructions"]).toBe("published body");
  });

  test("skl_ without an actor resolves published-only (backward compat)", async () => {
    const draftOnly = repoWith(
      async () => null,
      async (_t, id) =>
        view({
          id,
          kind: "skill",
          name: "g",
          ownerUserId: "u-owner",
          status: "draft",
          publishedVersionNo: null,
          content: { description: "d", instructions: "draft" },
        }),
    );
    expect(await new TenantDescriptorResolver(draftOnly).getSkill(7, "skl_5")).toBeUndefined();

    const published = repoWith(async (_t, id) =>
      view({ id, kind: "skill", name: "g", content: { description: "d", instructions: "pub" } }),
    );
    const s = (await new TenantDescriptorResolver(published).getSkill(7, "skl_5")) as unknown as Record<string, unknown> | undefined;
    expect(s?.["instructions"]).toBe("pub");
  });

  test("skl_ owner draft is FRESH across calls (bypasses the published 30s cache)", async () => {
    let calls = 0;
    const repo = repoWith(
      async () => null,
      async (_t, id) => {
        calls++;
        return view({
          id,
          kind: "skill",
          name: "g",
          ownerUserId: "u-owner",
          status: "draft",
          publishedVersionNo: null,
          content: { description: "d", instructions: `v${calls}` },
        });
      },
    );
    const r = new TenantDescriptorResolver(repo, 10_000);
    const a = (await r.getSkill(7, "skl_5", "u-owner")) as unknown as Record<string, unknown>;
    const b = (await r.getSkill(7, "skl_5", "u-owner")) as unknown as Record<string, unknown>;
    expect(a["instructions"]).toBe("v1");
    expect(b["instructions"]).toBe("v2");
    expect(calls).toBe(2);
  });

  test("rul_ owner sees own DRAFT rule; non-owner falls back to published-only", async () => {
    const repo = repoWith(
      async () => null,
      async (_t, id) =>
        view({
          id,
          kind: "rule",
          name: "safety",
          ownerUserId: "u-owner",
          status: "draft",
          publishedVersionNo: null,
          content: { content: "draft rule text" },
        }),
    );
    const r = new TenantDescriptorResolver(repo);
    expect(await r.getRule(7, "rul_9", "u-owner")).toMatchObject({ kind: "rule", name: "safety", content: "draft rule text" });
    expect(await r.getRule(7, "rul_9", "someone-else")).toBeUndefined();
  });
});

// L9（迁移残留）：publish/softDelete 已经在 append `descriptor_reload` outbox 事件，
// PubSubDispatcher 也已经把它映射到 `pubsub:descriptor.reload` redis 频道
// （见 infra/bun-server-ext/outbox/src/dispatcher.ts）——唯一缺的是订阅端，
// 本组测试锁定 attachInvalidationSubscriber 补上的那一段。
describe("TenantDescriptorResolver.attachInvalidationSubscriber — descriptor.reload pubsub", () => {
  test("valid {tenant, descriptorId} message invalidates exactly that entry", async () => {
    let calls = 0;
    const repo = repoWith(async (_t, id) => {
      calls++;
      return view({ id, kind: "rule", name: "safety", content: { content: `v${calls}` } });
    });
    const r = new TenantDescriptorResolver(repo, 10_000);
    const redis = new MemoryPubSub();
    r.attachInvalidationSubscriber(asRedis(redis));

    const before = await r.getRule(1, "rul_1");
    expect((before as { content: string }).content).toBe("v1");
    expect(calls).toBe(1);

    await redis.publish(RedisKeys.pubsubDescriptorReload(), JSON.stringify({ tenant: 1, descriptorId: "rul_1" }));

    const after = await r.getRule(1, "rul_1");
    expect((after as { content: string }).content).toBe("v2");
    expect(calls).toBe(2);
  });

  test("message for a different entry does not invalidate unrelated cache entries", async () => {
    let calls = 0;
    const repo = repoWith(async (_t, id) => {
      calls++;
      return view({ id, kind: "rule", name: "safety", content: { content: `v${calls}` } });
    });
    const r = new TenantDescriptorResolver(repo, 10_000);
    const redis = new MemoryPubSub();
    r.attachInvalidationSubscriber(asRedis(redis));

    await r.getRule(1, "rul_1");
    expect(calls).toBe(1);

    await redis.publish(RedisKeys.pubsubDescriptorReload(), JSON.stringify({ tenant: 1, descriptorId: "rul_other" }));

    await r.getRule(1, "rul_1");
    expect(calls).toBe(1);
  });

  test("malformed JSON on the channel is swallowed and falls back to clearing the whole cache", async () => {
    let calls = 0;
    const repo = repoWith(async (_t, id) => {
      calls++;
      return view({ id, kind: "rule", name: "n", content: { content: "c" } });
    });
    const r = new TenantDescriptorResolver(repo, 10_000);
    const redis = new MemoryPubSub();
    r.attachInvalidationSubscriber(asRedis(redis));

    await r.getRule(1, "rul_1");
    expect(calls).toBe(1);

    expect(async () => {
      await redis.publish(RedisKeys.pubsubDescriptorReload(), "not json");
    }).not.toThrow();

    await r.getRule(1, "rul_1");
    expect(calls).toBe(2);
  });

  test("subscribe failure (e.g. duplicate() throws) is swallowed — resolver still works cache-only", async () => {
    const repo = repoWith(async () => view({ kind: "rule", content: { content: "c" } }));
    const r = new TenantDescriptorResolver(repo);
    const brokenRedis = {
      duplicate: () => {
        throw new Error("no redis connection");
      },
    } as unknown as Redis;

    expect(() => r.attachInvalidationSubscriber(brokenRedis)).not.toThrow();
    expect(await r.getRule(1, "rul_1")).toBeDefined();
  });
});
