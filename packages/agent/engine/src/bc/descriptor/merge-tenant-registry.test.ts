import type { SkillDescriptor } from "@tachu/core";
import { describe, expect, test } from "bun:test";

import { mergeTenantRules, mergeTenantSkills } from "./merge-tenant-registry";
import type { RuleDescriptor } from "./rule-registry.service";
import type { TenantDescriptorResolver } from "./tenant-descriptor-resolver";

describe("mergeTenantSkills / mergeTenantRules — thread actorUserId to owner-aware resolver", () => {
  test("mergeTenantSkills forwards actorUserId to resolver.getSkill (owner sees own draft)", async () => {
    const seen: Array<{ tenant: number; ref: string; actor?: string }> = [];
    const resolver = {
      getSkill: async (tenant: number, ref: string, actorUserId?: string) => {
        seen.push({ tenant, ref, actor: actorUserId });
        return {
          kind: "skill",
          name: ref,
          description: "d",
          instructions: "i",
          activation: { mode: "semantic" },
        } as unknown as SkillDescriptor;
      },
    } as unknown as TenantDescriptorResolver;

    const merged = await mergeTenantSkills(["skl_1"], undefined, resolver, 42, "u-owner");
    expect(seen).toEqual([{ tenant: 42, ref: "skl_1", actor: "u-owner" }]);
    expect(merged?.resolve("skl_1")).toMatchObject({ kind: "skill", name: "skl_1" });
  });

  test("mergeTenantRules forwards actorUserId to resolver.getRule (owner sees own draft)", async () => {
    const seen: Array<{ tenant: number; ref: string; actor?: string }> = [];
    const resolver = {
      getRule: async (tenant: number, ref: string, actorUserId?: string) => {
        seen.push({ tenant, ref, actor: actorUserId });
        return { kind: "rule", name: ref, content: "c" } as RuleDescriptor;
      },
    } as unknown as TenantDescriptorResolver;

    const merged = await mergeTenantRules(["rul_1"], undefined, resolver, 42, "u-owner");
    expect(seen).toEqual([{ tenant: 42, ref: "rul_1", actor: "u-owner" }]);
    expect(merged?.resolve("rul_1")).toMatchObject({ kind: "rule", name: "rul_1" });
  });
});
