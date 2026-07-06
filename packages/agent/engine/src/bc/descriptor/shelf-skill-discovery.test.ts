import type { SkillDescriptor } from "@tachu/core";
import { describe, expect, test } from "bun:test";

import type { ShelfEntryView } from "@cube-ai/contracts";

import { buildShelfSkillDiscoveryProvider, type OwnerAwareSkillResolver, type ShelfSkillLister } from "./shelf-skill-discovery";

function shelfEntry(over: Partial<ShelfEntryView>): ShelfEntryView {
  return {
    id: "she_1",
    targetKind: "skill",
    targetId: "skl_1",
    source: "authored",
    pinVersionNo: null,
    enabled: true,
    effectiveVersionNo: null,
    runnableStatus: "runnable",
    ...over,
  };
}

function skill(name: string, description: string, tags?: string[]): SkillDescriptor {
  return {
    kind: "skill",
    name,
    description,
    instructions: `body of ${name}`,
    activation: { mode: "semantic" },
    ...(tags ? { tags } : {}),
  } as unknown as SkillDescriptor;
}

function fakeShelf(entries: ShelfEntryView[]): ShelfSkillLister {
  return { listByUser: async () => entries };
}

function fakeResolver(byId: Record<string, SkillDescriptor | undefined>): OwnerAwareSkillResolver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getSkill: async (_tenant: number, ref: string) => {
      calls.push(ref);
      return byId[ref];
    },
  };
}

describe("buildShelfSkillDiscoveryProvider — 我的技能 → tachu SkillDiscoveryProvider (L2/L3)", () => {
  test("list() returns runnable shelf skills as owner-aware name+description(+tags)", async () => {
    const provider = buildShelfSkillDiscoveryProvider({
      shelf: fakeShelf([
        shelfEntry({ targetId: "skl_greeting" }),
        shelfEntry({ id: "she_2", targetId: "skl_report", source: "ref", effectiveVersionNo: 3 }),
      ]),
      resolver: fakeResolver({
        skl_greeting: skill("主公问候前缀", "以主公前缀问候", ["greeting"]),
        skl_report: skill("weekly-report", "生成周报"),
      }),
      tenant: 42,
      userId: "u-owner",
    });

    const list = await provider.list!();
    expect(list).toEqual([
      { name: "主公问候前缀", description: "以主公前缀问候", tags: ["greeting"] },
      { name: "weekly-report", description: "生成周报" },
    ]);
  });

  test("list() skips disabled and non-runnable shelf entries", async () => {
    const provider = buildShelfSkillDiscoveryProvider({
      shelf: fakeShelf([
        shelfEntry({ targetId: "skl_ok" }),
        shelfEntry({ id: "she_d", targetId: "skl_disabled", enabled: false, runnableStatus: "disabled" }),
        shelfEntry({ id: "she_u", targetId: "skl_unresolvable", source: "ref", runnableStatus: "unresolvable" }),
      ]),
      resolver: fakeResolver({
        skl_ok: skill("ok-skill", "d"),
        skl_disabled: skill("disabled-skill", "d"),
        skl_unresolvable: skill("unresolvable-skill", "d"),
      }),
      tenant: 42,
      userId: "u-owner",
    });

    const names = (await provider.list!()).map((e) => e.name);
    expect(names).toEqual(["ok-skill"]);
  });

  test("list() drops entries whose owner-aware resolve returns undefined (e.g. bare system ref)", async () => {
    const resolver = fakeResolver({ skl_real: skill("real", "d") }); // "chart-output" 未登记 → undefined
    const provider = buildShelfSkillDiscoveryProvider({
      shelf: fakeShelf([
        shelfEntry({ targetId: "chart-output", source: "ref", effectiveVersionNo: 1 }),
        shelfEntry({ id: "she_2", targetId: "skl_real" }),
      ]),
      resolver,
      tenant: 42,
      userId: "u-owner",
    });

    expect((await provider.list!()).map((e) => e.name)).toEqual(["real"]);
  });

  test("search() filters by name/description, ranks name>description, honors topK", async () => {
    const provider = buildShelfSkillDiscoveryProvider({
      shelf: fakeShelf([
        shelfEntry({ targetId: "skl_a" }),
        shelfEntry({ id: "she_b", targetId: "skl_b" }),
        shelfEntry({ id: "she_c", targetId: "skl_c" }),
      ]),
      resolver: fakeResolver({
        skl_a: skill("report-weekly", "周报生成"),
        skl_b: skill("greeting", "含 report 字样的描述"),
        skl_c: skill("unrelated", "别的"),
      }),
      tenant: 42,
      userId: "u-owner",
    });

    const hits = await provider.search!("report", 5);
    expect(hits.map((h) => h.name)).toEqual(["report-weekly", "greeting"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);

    const limited = await provider.search!("report", 1);
    expect(limited.map((h) => h.name)).toEqual(["report-weekly"]);
  });

  test("load(name) returns the owner-aware descriptor; unknown name → null", async () => {
    const provider = buildShelfSkillDiscoveryProvider({
      shelf: fakeShelf([shelfEntry({ targetId: "skl_greeting" })]),
      resolver: fakeResolver({ skl_greeting: skill("主公问候前缀", "以主公前缀问候") }),
      tenant: 42,
      userId: "u-owner",
    });

    const loaded = await provider.load!("主公问候前缀");
    expect(loaded?.name).toBe("主公问候前缀");
    expect((loaded as unknown as { instructions: string }).instructions).toBe("body of 主公问候前缀");
    expect(await provider.load!("does-not-exist")).toBeNull();
  });

  test("catalog is resolved once per turn: list + search + load share memoized resolution", async () => {
    const resolver = fakeResolver({ skl_greeting: skill("主公问候前缀", "以主公前缀问候") });
    const provider = buildShelfSkillDiscoveryProvider({
      shelf: fakeShelf([shelfEntry({ targetId: "skl_greeting" })]),
      resolver,
      tenant: 42,
      userId: "u-owner",
    });

    await provider.list!();
    await provider.search!("主公");
    await provider.load!("主公问候前缀");
    expect(resolver.calls).toEqual(["skl_greeting"]);
  });
});
