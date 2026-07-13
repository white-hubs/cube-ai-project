import { describe, expect, test } from "bun:test";

import { DescriptorRegistryService } from "./descriptor-registry.service";
import {
  DISABLED_ENGINE_BUILTIN_TOOL_NAMES,
  buildImageQwenDescriptor,
  buildPlatformToolDescriptors,
  buildSessionRecallDescriptor,
  ensureBuiltinPlatformToolDescriptors,
} from "./engine-builtin-descriptors";
import type { ToolEffectiveVersionSource } from "./tool-effective-version.provider";

const noopPin: ToolEffectiveVersionSource = {
  refreshFromNacos: async () => {},
  getPinnedVersion: async () => undefined,
};

describe("engine builtin descriptors", () => {
  test("session_recall descriptor parses and pins execute ref", () => {
    const d = buildSessionRecallDescriptor();
    expect(d.name).toBe("session_recall");
    expect(d.execute).toBe("builtin:engine.session_recall");
    expect(d.handler?.kind).toBe("sessionRecall");
    expect(d.description).toContain("CURRENT session");
  });

  test("image.qwen descriptor parses and pins execute ref", () => {
    const d = buildImageQwenDescriptor();
    expect(d.name).toBe("image.qwen");
    expect(d.execute).toBe("builtin:engine.image_qwen");
    expect(d.handler?.kind).toBe("qwenImage");
    expect(d.description).toContain("NOT for understanding or describing images");
  });

  test("platform.flow.invoke descriptor exposes flowId and variables", () => {
    const invoke = buildPlatformToolDescriptors().find((d) => d.name === "platform.flow.invoke");
    expect(invoke).toBeDefined();
    const schema = invoke!.inputSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toContain("flowId");
    expect(schema.properties).toHaveProperty("flowId");
    expect(schema.properties).toHaveProperty("variables");
    expect(schema.properties).not.toHaveProperty("flowCode");
    const vars = schema.properties!.variables as { description?: string; properties?: Record<string, unknown> };
    expect(vars.description).toContain("input");
    expect(vars.properties).toHaveProperty("input");
    expect(invoke!.description).toContain("variables.input");
  });

  test("ensureBuiltinPlatformToolDescriptors skips disabled platform.flow.* tools", () => {
    const registry = new DescriptorRegistryService(noopPin);
    ensureBuiltinPlatformToolDescriptors(registry);
    expect(registry.resolve("platform.knowledge.query")?.execute).toBe("builtin:platform.knowledge.query");
    for (const name of DISABLED_ENGINE_BUILTIN_TOOL_NAMES) {
      expect(registry.resolve(name)).toBeUndefined();
    }
  });
});
