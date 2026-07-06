import { describe, expect, test } from "bun:test";

import { findExplicitRuleMentions } from "./explicit-rule-mention";

describe("findExplicitRuleMentions", () => {
  const rules = ["safety-baseline", "sql-style"];

  test("matches @rule-name", () => {
    expect(findExplicitRuleMentions("请遵守 @safety-baseline", rules)).toEqual(["safety-baseline"]);
  });

  test("matches /rule-name", () => {
    expect(findExplicitRuleMentions("/sql-style 帮我写查询", rules)).toEqual(["sql-style"]);
  });

  test("is case-insensitive on the sigil form", () => {
    expect(findExplicitRuleMentions("apply @Safety-Baseline now", rules)).toEqual(["safety-baseline"]);
  });

  test("does NOT match a bare name (rules diverge from skills to avoid false positives)", () => {
    // "safety" 是常见词；规则名裸出现绝不应触发，否则任何提到 safety 的 prompt 都误命中。
    expect(findExplicitRuleMentions("讲讲 safety-baseline 的历史", rules)).toEqual([]);
  });

  test("dedups and returns each matched rule once", () => {
    expect(findExplicitRuleMentions("@safety-baseline 再看 @safety-baseline", rules)).toEqual(["safety-baseline"]);
  });

  test("returns [] for empty prompt or empty candidate set", () => {
    expect(findExplicitRuleMentions("", rules)).toEqual([]);
    expect(findExplicitRuleMentions("@safety-baseline", [])).toEqual([]);
  });
});
