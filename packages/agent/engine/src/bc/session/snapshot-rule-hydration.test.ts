import { describe, expect, test } from "bun:test";

import type { RuleActivation, RuleDescriptor } from "../descriptor/rule-registry.service";
import { hydrateSnapshotRules, snapshotRulesToTachuDescriptors, type SnapshotRuleEntry } from "./snapshot-rule-hydration";

function entry(name: string, content: string, activation?: RuleActivation): SnapshotRuleEntry {
  return {
    name,
    versionNo: 0,
    content: { kind: "rule", name, content, ...(activation ? { activation } : {}) } satisfies RuleDescriptor,
  };
}

describe("hydrateSnapshotRules（快照冻结）", () => {
  test("冻结全部 activation（含动态规则）进 snapshot，供 per-turn 动态注入检索", () => {
    const registry = {
      resolve: (name: string): RuleDescriptor => ({
        kind: "rule",
        name,
        content: `c-${name}`,
        activation: name === "manual-rule" ? { mode: "manual" } : { mode: "always" },
      }),
    };

    const out = hydrateSnapshotRules(["always-rule", "manual-rule"], registry);

    // 快照是整会话的规则权威：动态规则也必须在册，否则 per-turn 注入无从检索。
    expect(out.map((r) => r.content.activation)).toEqual([{ mode: "always" }, { mode: "manual" }]);
  });
});

describe("snapshotRulesToTachuDescriptors（→ SessionScope.additionalRules 投影）", () => {
  test("把 snapshot 规则忠实投影为 tachu RuleDescriptor：缺省 activation 回落 always、type 默认 rule", () => {
    const rows: SnapshotRuleEntry[] = [
      entry("always-explicit", "ALWAYS", { mode: "always" }),
      entry("default-implicit", "DEFAULT"),
      entry("manual-rule", "MANUAL", { mode: "manual" }),
      entry("path-rule", "PATH", { mode: "path", globs: ["**/*.ts"] }),
    ];

    expect(snapshotRulesToTachuDescriptors(rows)).toEqual([
      { kind: "rule", name: "always-explicit", description: "", type: "rule", activation: { mode: "always" }, content: "ALWAYS" },
      { kind: "rule", name: "default-implicit", description: "", type: "rule", activation: { mode: "always" }, content: "DEFAULT" },
      { kind: "rule", name: "manual-rule", description: "", type: "rule", activation: { mode: "manual" }, content: "MANUAL" },
      { kind: "rule", name: "path-rule", description: "", type: "rule", activation: { mode: "path", globs: ["**/*.ts"] }, content: "PATH" },
    ]);
  });

  test("透传 version/displayName/tags，对畸形行 / 空正文防御性跳过，空输入返回 []", () => {
    expect(snapshotRulesToTachuDescriptors(undefined)).toEqual([]);
    expect(
      snapshotRulesToTachuDescriptors([
        null,
        42,
        { name: "no-content" },
        { content: { kind: "rule", name: "blank", content: "   ", activation: { mode: "always" } } },
        {
          content: {
            kind: "rule",
            name: "full",
            content: "BODY",
            description: "why",
            version: "1.2.0",
            displayName: "Full",
            tags: ["x"],
            activation: { mode: "manual" },
          },
        },
      ]),
    ).toEqual([
      {
        kind: "rule",
        name: "full",
        description: "why",
        type: "rule",
        activation: { mode: "manual" },
        content: "BODY",
        version: "1.2.0",
        displayName: "Full",
        tags: ["x"],
      },
    ]);
  });
});
