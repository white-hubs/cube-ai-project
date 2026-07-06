import { describe, expect, test } from "bun:test";

import {
  applyHostGatingPolicyPreseed,
  detectDataChartIntent,
  detectGeneratedImageIntent,
  detectReferenceImageEditIntent,
  shouldIncludeImageQwenForTurn,
  shouldOmitImageQwenFromMirror,
} from "./host-gating-policy";

describe("host-gating-policy", () => {
  test("detectDataChartIntent matches Chinese chart queries", () => {
    expect(detectDataChartIntent("今日最新科技股大盘情况，用图表方式总结")).toBe(true);
    expect(detectDataChartIntent("画一只猫")).toBe(false);
  });

  test("detectGeneratedImageIntent matches draw requests", () => {
    expect(detectGeneratedImageIntent("画一只猫")).toBe(true);
    expect(detectGeneratedImageIntent("/draw a small cat")).toBe(true);
    expect(detectGeneratedImageIntent("用图表总结大盘")).toBe(false);
  });

  test("applyHostGatingPolicyPreseed excludes image.qwen for data-chart", () => {
    const env = applyHostGatingPolicyPreseed(
      { content: "用图表总结科技股", metadata: { modality: "text", size: 10 } },
      "用图表总结科技股",
      ["image.qwen", "currentDate"],
    );
    expect(env.metadata?.gatingPolicy?.excludeTools).toContain("image.qwen");
    expect(env.metadata?.gatingPolicy?.pinSkills).toContain("chart-output");
    expect(env.metadata?.gatingPolicy?.visualization).toBe("data-chart");
  });

  test("applyHostGatingPolicyPreseed includes image.qwen for generated-image", () => {
    const env = applyHostGatingPolicyPreseed({ content: "画一只猫", metadata: { modality: "text", size: 4 } }, "画一只猫", ["image.qwen"]);
    expect(env.metadata?.gatingPolicy?.includeTools).toContain("image.qwen");
    expect(env.metadata?.gatingPolicy?.visualization).toBe("generated-image");
  });

  test("shouldOmitImageQwenFromMirror for uploaded-image describe", () => {
    expect(shouldOmitImageQwenFromMirror("介绍下图里的内容", true)).toBe(true);
    expect(shouldOmitImageQwenFromMirror("画一只猫", false)).toBe(false);
    expect(shouldOmitImageQwenFromMirror("画一只猫", true)).toBe(false);
  });

  test("shouldIncludeImageQwenForTurn covers draw and reference edit", () => {
    expect(shouldIncludeImageQwenForTurn("画一只猫", false)).toBe(true);
    expect(shouldIncludeImageQwenForTurn("介绍下图", true)).toBe(false);
    expect(shouldIncludeImageQwenForTurn("把这张图改成油画风格", true)).toBe(true);
    expect(detectReferenceImageEditIntent("edit this image to watercolor")).toBe(true);
  });
});
