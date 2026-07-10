/**
 * 「一核」目录与系统级 descriptor 生成的结构校验（ADR-0027 §7/§8）：
 *   - buildManagementToolDescriptors() 产出 7 个 schema-valid 系统级 ToolDescriptor；
 *   - in-process descriptor 声明的 consent 与 MCP confirm 策略对齐（§9）。
 *
 * 注：`descriptors/tools/` 已不再存放 YAML 影子定义；管理工具仅由本模块 builder 注册。
 */
import { describe, expect, it } from "bun:test";

import {
  CONFIRM_REQUIRED_OPS,
  buildManagementToolDescriptors,
  descriptorOpFromExecute,
  managementMcpToolList,
  managementToolNames,
} from "./descriptor-ops";

describe("management ops core catalog", () => {
  it("builds 7 schema-valid system-level tool descriptors with descriptorOps handler", () => {
    const descriptors = buildManagementToolDescriptors();
    expect(descriptors).toHaveLength(7);
    for (const d of descriptors) {
      expect(d.handler?.kind).toBe("descriptorOps");
      expect(d.isPreset).toBe(true);
      expect(d.execute.startsWith("builtin:platform.descriptor.")).toBe(true);
      expect(descriptorOpFromExecute(d.execute)).not.toBeNull();
    }
    expect(descriptors.map((d) => d.name).toSorted()).toEqual([...managementToolNames()].toSorted());
  });

  it("consent policy: reads NEVER, drafts ON_FIRST_USE, runtime-affecting EACH_CALL + confirm", () => {
    const byName = new Map(buildManagementToolDescriptors().map((d) => [d.name, d] as const));
    expect(byName.get("platform.descriptor.list")?.meta.consent).toBe("NEVER");
    expect(byName.get("platform.descriptor.get")?.meta.consent).toBe("NEVER");
    expect(byName.get("platform.descriptor.propose")?.meta.consent).toBe("NEVER");
    expect(byName.get("platform.descriptor.create")?.meta.consent).toBe("ON_FIRST_USE");
    expect(byName.get("platform.descriptor.update")?.meta.consent).toBe("ON_FIRST_USE");
    expect(byName.get("platform.descriptor.publish")?.meta.consent).toBe("EACH_CALL");
    expect(byName.get("platform.descriptor.delete")?.meta.consent).toBe("EACH_CALL");
    expect([...CONFIRM_REQUIRED_OPS].toSorted()).toEqual(["delete", "publish"]);
  });

  it("MCP tools/list mirrors the same tool set with input schemas", () => {
    const list = managementMcpToolList();
    expect(list.map((t) => t.name).toSorted()).toEqual([...managementToolNames()].toSorted());
    for (const t of list) {
      expect(t.inputSchema.type).toBe("object");
    }
  });
});
