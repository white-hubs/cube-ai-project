import { describe, expect, it } from "bun:test";

import {
  DescriptorNameSchema,
  DescriptorVersionSchema,
  FromDocumentResultSchema,
  ProposeResultSchema,
  TENANT_DESCRIPTOR_ID_PREFIXES,
  TenantAgentContentSchema,
  TenantDescriptorCreateRequestSchema,
  TenantDescriptorViewSchema,
  TenantRuleContentSchema,
  TenantSkillContentSchema,
  parseTenantDescriptorId,
} from "./tenant-descriptor";

describe("DescriptorNameSchema (ADR-0033 slug key)", () => {
  it("accepts lower-kebab slugs", () => {
    for (const ok of ["a", "agent", "customer-support-agent", "v2-agent-3"]) {
      expect(DescriptorNameSchema.safeParse(ok).success).toBe(true);
    }
  });

  it("rejects non-ASCII, spaces, uppercase, and edge hyphens", () => {
    for (const bad of ["", "支持", "Support Agent", "UPPER", "-lead", "trail-", "a b", "under_score"]) {
      expect(DescriptorNameSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("trims surrounding whitespace before validating", () => {
    expect(DescriptorNameSchema.parse("  support-agent  ")).toBe("support-agent");
  });
});

describe("TenantDescriptorCreateRequestSchema (envelope)", () => {
  it("requires a slug name and an (opaque) content payload", () => {
    expect(TenantDescriptorCreateRequestSchema.safeParse({ name: "a", content: { prompt: "hi" } }).success).toBe(true);
    expect(TenantDescriptorCreateRequestSchema.safeParse({ content: { prompt: "hi" } }).success).toBe(false);
    expect(TenantDescriptorCreateRequestSchema.safeParse({ name: "Bad Name", content: {} }).success).toBe(false);
  });
});

describe("ProposeResultSchema carries a slug name", () => {
  it("requires name so propose output is directly feedable into create", () => {
    expect(ProposeResultSchema.safeParse({ name: "support-agent", content: {}, suggestions: [], valid: true }).success).toBe(true);
    expect(ProposeResultSchema.safeParse({ content: {}, suggestions: [], valid: true }).success).toBe(false);
  });
});

describe("parseTenantDescriptorId", () => {
  it("parses the three kind prefixes", () => {
    expect(parseTenantDescriptorId("agt_123")).toEqual({ kind: "agent", sfid: "123" });
    expect(parseTenantDescriptorId("skl_456")).toEqual({ kind: "skill", sfid: "456" });
    expect(parseTenantDescriptorId("rul_789")).toEqual({ kind: "rule", sfid: "789" });
  });

  it("returns null for bare names (= system-level)", () => {
    expect(parseTenantDescriptorId("safety-baseline")).toBeNull();
    expect(parseTenantDescriptorId("myAgent")).toBeNull();
  });

  it("returns null for empty string, unknown prefix, missing sfid", () => {
    expect(parseTenantDescriptorId("")).toBeNull();
    expect(parseTenantDescriptorId("xyz_123")).toBeNull();
    expect(parseTenantDescriptorId("agt_")).toBeNull();
    expect(parseTenantDescriptorId("_123")).toBeNull();
  });

  it("keeps sfid intact when it contains underscores", () => {
    expect(parseTenantDescriptorId("agt_a_b")).toEqual({ kind: "agent", sfid: "a_b" });
  });

  it("prefix map covers exactly agent/skill/rule", () => {
    expect(Object.keys(TENANT_DESCRIPTOR_ID_PREFIXES).toSorted()).toEqual(["agent", "rule", "skill"]);
  });
});

describe("TenantAgentContentSchema", () => {
  it("requires non-empty prompt and defaults ref arrays", () => {
    const parsed = TenantAgentContentSchema.parse({ prompt: "You are helpful." });
    expect(parsed.ruleRefs).toEqual([]);
    expect(parsed.skillRefs).toEqual([]);
    expect(parsed.availableTools).toEqual([]);
    expect(parsed.subAgentRefs).toEqual([]);

    expect(TenantAgentContentSchema.safeParse({ prompt: "" }).success).toBe(false);
    expect(TenantAgentContentSchema.safeParse({}).success).toBe(false);
  });

  it("bounds temperature and maxDepth", () => {
    expect(
      TenantAgentContentSchema.safeParse({
        modelConfig: { temperature: 2.5 },
        prompt: "p",
      }).success,
    ).toBe(false);
    expect(TenantAgentContentSchema.safeParse({ maxDepth: 0, prompt: "p" }).success).toBe(false);
    expect(
      TenantAgentContentSchema.safeParse({
        maxDepth: 3,
        modelConfig: { model: "gpt-4o", provider: "openai", temperature: 0.7 },
        prompt: "p",
      }).success,
    ).toBe(true);
  });

  it("accepts shared meta fields", () => {
    const parsed = TenantAgentContentSchema.parse({
      displayName: "客服 Agent",
      prompt: "p",
      tags: ["cs"],
      version: "1.2.0",
    });
    expect(parsed.displayName).toBe("客服 Agent");
    expect(parsed.tags).toEqual(["cs"]);
    expect(parsed.version).toBe("1.2.0");
  });

  it("parses optional groundingPrefetch declarations and rejects empty tool names", () => {
    const parsed = TenantAgentContentSchema.parse({
      prompt: "p",
      groundingPrefetch: [
        { tool: "mcp.biz-ontology.read_ontology", args: { connection: "", entity: "_index" } },
        { tool: "mcp.biz-ontology.search_ontology", queryFromPrompt: true, topK: 8 },
      ],
    });
    expect(parsed.groundingPrefetch).toEqual([
      { tool: "mcp.biz-ontology.read_ontology", args: { connection: "", entity: "_index" } },
      { tool: "mcp.biz-ontology.search_ontology", queryFromPrompt: true, topK: 8 },
    ]);
    // omitted entirely → stays undefined (host treats as "no prefetch")
    expect(TenantAgentContentSchema.parse({ prompt: "p" }).groundingPrefetch).toBeUndefined();
    // an entry without a tool name is meaningless → rejected
    expect(TenantAgentContentSchema.safeParse({ prompt: "p", groundingPrefetch: [{ tool: "" }] }).success).toBe(false);
    expect(TenantAgentContentSchema.safeParse({ prompt: "p", groundingPrefetch: [{ topK: 3 }] }).success).toBe(false);
  });
});

describe("TenantSkillContentSchema", () => {
  it("requires description and instructions", () => {
    expect(
      TenantSkillContentSchema.safeParse({
        description: "d",
        instructions: "do this",
      }).success,
    ).toBe(true);
    expect(TenantSkillContentSchema.safeParse({ description: "", instructions: "x" }).success).toBe(false);
    expect(TenantSkillContentSchema.safeParse({ description: "d", instructions: "" }).success).toBe(false);
  });

  it("strips unknown frontmatter fields (resources/requires/deprecated/legacy trigger)", () => {
    const parsed = TenantSkillContentSchema.parse({
      deprecated: true,
      description: "d",
      instructions: "i",
      requires: ["y"],
      resources: [{ path: "x" }],
      trigger: "explicit",
    } as Record<string, unknown>);
    expect("resources" in parsed).toBe(false);
    expect("requires" in parsed).toBe(false);
    expect("deprecated" in parsed).toBe(false);
    // rc.13：旧 trigger 词汇彻底移除，wire 只认 activation（透传为未知字段被 strip）。
    expect("trigger" in parsed).toBe(false);
  });

  it("accepts activation modes and is fail-closed on invalid ones (rc.13)", () => {
    expect(TenantSkillContentSchema.safeParse({ description: "d", instructions: "i", activation: { mode: "manual" } }).success).toBe(true);
    expect(
      TenantSkillContentSchema.safeParse({ description: "d", instructions: "i", activation: { mode: "path", globs: ["src/**/*.ts"] } })
        .success,
    ).toBe(true);
    // 缺省（无 activation）合法——读取侧回落 semantic。
    expect(TenantSkillContentSchema.safeParse({ description: "d", instructions: "i" }).success).toBe(true);
    // fail-closed：未知 mode / path 缺非空 globs。
    expect(TenantSkillContentSchema.safeParse({ description: "d", instructions: "i", activation: { mode: "explicit" } }).success).toBe(
      false,
    );
    expect(
      TenantSkillContentSchema.safeParse({ description: "d", instructions: "i", activation: { mode: "path", globs: [] } }).success,
    ).toBe(false);
  });
});

describe("TenantRuleContentSchema", () => {
  it("requires non-empty content; description optional", () => {
    expect(TenantRuleContentSchema.safeParse({ content: "rule text" }).success).toBe(true);
    expect(TenantRuleContentSchema.safeParse({ content: "" }).success).toBe(false);
    expect(TenantRuleContentSchema.safeParse({ content: "r", description: "why" }).success).toBe(true);
  });
});

describe("FromDocumentResultSchema", () => {
  it("accepts a valid :fromDocument upsert result (ADR-0018 §4)", () => {
    const parsed = FromDocumentResultSchema.parse({
      action: "created",
      headVersionNo: 1,
      id: "skl_123",
      name: "review-pr",
      status: "draft",
    });
    expect(parsed.action).toBe("created");
    expect(parsed.status).toBe("draft");
    expect(
      FromDocumentResultSchema.safeParse({
        action: "updated",
        headVersionNo: 2,
        id: "skl_1",
        name: "n",
        status: "draft",
      }).success,
    ).toBe(true);
  });

  it("rejects published status and unknown action (always draft, ADR-0018 §4)", () => {
    expect(
      FromDocumentResultSchema.safeParse({
        action: "created",
        headVersionNo: 1,
        id: "skl_1",
        name: "n",
        status: "published",
      }).success,
    ).toBe(false);
    expect(
      FromDocumentResultSchema.safeParse({
        action: "deleted",
        headVersionNo: 1,
        id: "skl_1",
        name: "n",
        status: "draft",
      }).success,
    ).toBe(false);
  });
});

describe("TenantDescriptorViewSchema", () => {
  it("requires owner and unpublished-change projection fields", () => {
    const parsed = TenantDescriptorViewSchema.parse({
      content: { prompt: "Help users." },
      createTime: 1710000000000,
      hasUnpublishedChanges: true,
      headVersionNo: 2,
      id: "agt_123",
      kind: "agent",
      name: "support-agent",
      ownerUserId: "user-1",
      publishedVersionNo: 1,
      status: "draft",
      updateTime: 1710000001000,
    });

    expect(parsed.ownerUserId).toBe("user-1");
    expect(parsed.hasUnpublishedChanges).toBe(true);
    expect(
      TenantDescriptorViewSchema.safeParse({
        content: { description: "d", instructions: "i" },
        createTime: 1710000000000,
        hasUnpublishedChanges: false,
        headVersionNo: 1,
        id: "skl_1",
        kind: "skill",
        name: "review",
        ownerUserId: null,
        publishedVersionNo: 1,
        status: "published",
        updateTime: 1710000001000,
      }).success,
    ).toBe(true);
  });

  it("rejects views missing the unpublished-change flag", () => {
    expect(
      TenantDescriptorViewSchema.safeParse({
        content: { prompt: "Help users." },
        createTime: 1710000000000,
        headVersionNo: 2,
        id: "agt_123",
        kind: "agent",
        name: "support-agent",
        ownerUserId: "user-1",
        publishedVersionNo: 1,
        status: "draft",
        updateTime: 1710000001000,
      }).success,
    ).toBe(false);
  });
});

describe("DescriptorVersionSchema", () => {
  it("accepts published version list items without content", () => {
    const parsed = DescriptorVersionSchema.parse({
      createBy: "author-1",
      createTime: 1710000000000,
      versionNo: 1,
    });

    expect(parsed.versionNo).toBe(1);
    expect("content" in parsed).toBe(false);
  });

  it("accepts version detail items with optional content", () => {
    const parsed = DescriptorVersionSchema.parse({
      content: { prompt: "Published prompt." },
      createBy: "author-1",
      createTime: 1710000001000,
      versionNo: 2,
    });

    expect(parsed.content).toEqual({ prompt: "Published prompt." });
  });
});
