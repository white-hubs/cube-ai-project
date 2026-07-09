import type { SkillDescriptor } from "@tachu/core";
import { describe, expect, test } from "bun:test";

import { scoreSkillsByKeyword } from "./keyword.strategy";

function makeSkill(overrides: Partial<SkillDescriptor> & { name: string }): SkillDescriptor {
  return {
    kind: "skill",
    name: overrides.name,
    description: overrides.description ?? "Use when testing",
    instructions: overrides.instructions ?? "body",
    activation: overrides.activation ?? { mode: "semantic" },
    ...(overrides.displayName !== undefined ? { displayName: overrides.displayName } : {}),
    ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
    ...(overrides.deprecated !== undefined ? { deprecated: overrides.deprecated } : {}),
  };
}

describe("scoreSkillsByKeyword", () => {
  test("exact name match promotes with score 1", () => {
    const hits = scoreSkillsByKeyword("please use chart-output", [makeSkill({ name: "chart-output", description: "charts" })]);
    expect(hits.length).toBe(1);
    expect(hits[0]?.score).toBe(1);
    expect(hits[0]?.promote).toBe(true);
    expect(hits[0]?.promote).toBe(true);
    expect(hits[0]?.reason?.startsWith("keyword:exact")).toBe(true);
  });

  test("Chinese chart skill intent promotes chart-output to T0", () => {
    const hits = scoreSkillsByKeyword("使用图表生成技能，随机生成几个图表", [
      makeSkill({
        name: "chart-output",
        displayName: "Chart Output",
        description: "Use when the conversation asks for visualization, dashboards, charts, 图表",
        tags: ["chart", "visualization", "echarts"],
      }),
    ]);
    expect(hits.length).toBe(1);
    expect(hits[0]?.skill.name).toBe("chart-output");
    expect(hits[0]?.promote).toBe(true);
    expect(hits[0]?.score).toBeGreaterThanOrEqual(0.9);
  });

  test("Chinese report/dashboard intent promotes html-output to T0", () => {
    const hits = scoreSkillsByKeyword("帮我做一个数据大屏看板", [
      makeSkill({
        name: "html-output",
        displayName: "报告输出",
        description: "适用于生成完整报告/分析报告/BI 报告/报表/仪表盘大屏等场景",
        tags: ["report", "html", "dashboard"],
      }),
    ]);
    expect(hits.length).toBe(1);
    expect(hits[0]?.skill.name).toBe("html-output");
    expect(hits[0]?.promote).toBe(true);
    expect(hits[0]?.score).toBeGreaterThanOrEqual(0.9);
    expect(hits[0]?.reason).toBe("keyword:report-intent");
  });

  test("English report intent promotes html-output", () => {
    const hits = scoreSkillsByKeyword("generate a security analysis report", [
      makeSkill({
        name: "html-output",
        displayName: "报告输出",
        description: "full report / analysis report / BI dashboard layout",
        tags: ["report", "html", "dashboard"],
      }),
    ]);
    expect(hits[0]?.skill.name).toBe("html-output");
    expect(hits[0]?.promote).toBe(true);
    expect(hits[0]?.score).toBeGreaterThanOrEqual(0.9);
  });

  test("report intent does not leak onto non-report skills", () => {
    // chart-output matches "报告" by description substring, but must NOT be report-promoted:
    // it carries no report/dashboard tag and is not html-output.
    const hits = scoreSkillsByKeyword("帮我生成一份报告", [
      makeSkill({
        name: "chart-output",
        displayName: "Chart Output",
        description: "统计可视化图表；也可用于报告中的图表区块",
        tags: ["chart", "visualization", "echarts"],
      }),
    ]);
    const chart = hits.find((h) => h.skill.name === "chart-output");
    expect(chart).toBeDefined();
    expect(chart?.reason).not.toBe("keyword:report-intent");
    expect(chart?.promote).toBe(false);
  });

  test("Chinese twin scene intent promotes model-interact to T0", () => {
    const hits = scoreSkillsByKeyword("切换天气到晴天", [
      makeSkill({
        name: "model-interact",
        displayName: "模型交互",
        description: "数字孪生模型操控：时间天气视角环游漫游",
        tags: ["twin", "model-command", "ue5"],
      }),
    ]);
    expect(hits.length).toBe(1);
    expect(hits[0]?.skill.name).toBe("model-interact");
    expect(hits[0]?.promote).toBe(true);
    expect(hits[0]?.score).toBeGreaterThanOrEqual(0.9);
    expect(hits[0]?.reason).toBe("keyword:model-interact-intent");
  });

  test("enter roam route intent promotes model-interact even without description hit", () => {
    const hits = scoreSkillsByKeyword("进入办公区漫游路线", [
      makeSkill({
        name: "model-interact",
        displayName: "模型交互",
        description: "scene control sdk",
        tags: ["twin", "model-command", "roam"],
      }),
    ]);
    expect(hits[0]?.skill.name).toBe("model-interact");
    expect(hits[0]?.promote).toBe(true);
    expect(hits[0]?.reason).toBe("keyword:model-interact-intent");
  });

  test("excludes snapshot-pinned names", () => {
    const hits = scoreSkillsByKeyword(
      "chart-output",
      [makeSkill({ name: "chart-output" }), makeSkill({ name: "other-skill", description: "chart-output helper" })],
      { excludeNames: new Set(["chart-output"]) },
    );
    expect(hits.every((h) => h.skill.name !== "chart-output")).toBe(true);
  });
});
