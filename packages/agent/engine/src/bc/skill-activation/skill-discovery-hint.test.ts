import { describe, expect, test } from "bun:test";

import { SKILL_DISCOVERY_PROMPT_SUFFIX, appendSkillDiscoveryHint } from "./skill-discovery-hint";

describe("SKILL_DISCOVERY_PROMPT_SUFFIX wording", () => {
  // rc.10 深单 loop 删除了 direct-answer 子流程（ADR-0006），无工具轮由 loop
  // step-1 承接；提示词不应再提一个已不存在的轮型（迁移残留 L4）。
  test("does not reference the removed direct-answer turn concept", () => {
    expect(SKILL_DISCOVERY_PROMPT_SUFFIX).not.toContain("direct-answer");
  });

  test("describes the no-tool-call turn instead", () => {
    expect(SKILL_DISCOVERY_PROMPT_SUFFIX).toContain("on turns where you answer without calling any tool");
  });

  // F1 保留了 Available Skills 的 name+描述（精确选型信号，防盲选幻觉）；
  // 提示词须与实际渲染一致——不得再声称「names only」。
  test("describes Available Skills as a name+description menu, not names-only", () => {
    expect(SKILL_DISCOVERY_PROMPT_SUFFIX).not.toContain("names only");
    expect(SKILL_DISCOVERY_PROMPT_SUFFIX).toContain("short description");
  });
});

describe("appendSkillDiscoveryHint", () => {
  test("appends the suffix to a non-empty instruction", () => {
    const out = appendSkillDiscoveryHint("Base instruction.");
    expect(out).toContain("Base instruction.");
    expect(out).toContain("## Skill Discovery");
  });

  test("returns the suffix as-is when instruction is empty", () => {
    expect(appendSkillDiscoveryHint("   ")).toBe(SKILL_DISCOVERY_PROMPT_SUFFIX);
  });

  test("is idempotent — does not double-append when already present", () => {
    const once = appendSkillDiscoveryHint("Base.");
    const twice = appendSkillDiscoveryHint(once);
    expect(twice).toBe(once);
  });
});
