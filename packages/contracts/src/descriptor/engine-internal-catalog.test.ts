import { describe, expect, test } from "bun:test";

import {
  ENGINE_INTERNAL_AGENT_REFS,
  ENGINE_INTERNAL_SKILL_REFS,
  filterUserVisibleLibraryItems,
  filterUserVisibleShelfEntries,
  findEngineInternalRefsInAgentContent,
  isEngineInternalAgentRef,
  isEngineInternalLibraryRef,
  isEngineInternalSkillRef,
  stripEngineInternalRefsFromAgentContent,
} from "./engine-internal-catalog";

describe("engine-internal-catalog", () => {
  test("marks engine runtime agents as internal", () => {
    for (const ref of ENGINE_INTERNAL_AGENT_REFS) {
      expect(isEngineInternalAgentRef(ref)).toBe(true);
    }
    expect(isEngineInternalAgentRef("1934000000000000001")).toBe(false);
  });

  test("marks engine runtime skills as internal", () => {
    for (const ref of ENGINE_INTERNAL_SKILL_REFS) {
      expect(isEngineInternalSkillRef(ref)).toBe(true);
    }
  });

  test("filters internal library items for user-facing browse", () => {
    const items = [
      { kind: "agent" as const, ref: "cube-default" },
      { kind: "agent" as const, ref: "1934000000000000001" },
      { kind: "skill" as const, ref: "chart-output" },
      { kind: "skill" as const, ref: "my-skill" },
    ];
    expect(filterUserVisibleLibraryItems(items)).toEqual([
      { kind: "agent", ref: "1934000000000000001" },
      { kind: "skill", ref: "my-skill" },
    ]);
    expect(isEngineInternalLibraryRef("agent", "cube-researcher")).toBe(true);
    expect(isEngineInternalLibraryRef("skill", "default-reasoning")).toBe(true);
  });

  test("detects and strips internal refs from user agent content", () => {
    const content = {
      skillRefs: ["default-reasoning", "my-skill"],
      subAgentRefs: ["cube-researcher", "agt_user"],
    };
    expect(findEngineInternalRefsInAgentContent(content)).toEqual([
      { field: "skillRefs", ref: "default-reasoning" },
      { field: "subAgentRefs", ref: "cube-researcher" },
    ]);
    expect(stripEngineInternalRefsFromAgentContent(content)).toEqual({
      skillRefs: ["my-skill"],
      subAgentRefs: ["agt_user"],
    });
  });

  test("filters internal shelf entries", () => {
    const entries = [
      { targetKind: "agent" as const, targetId: "cube-default" },
      { targetKind: "agent" as const, targetId: "1934000000000000001" },
      { targetKind: "skill" as const, targetId: "chart-output" },
    ];
    expect(filterUserVisibleShelfEntries(entries)).toEqual([{ targetKind: "agent", targetId: "1934000000000000001" }]);
  });
});
