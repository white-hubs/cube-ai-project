# Descriptor Repository Layout

声明式资产目录，供 agent-engine `DescriptorLoader` 加载。

## Structure

- `agents/` — AgentDescriptor YAML
- `tools/` — **不再存放 YAML**；见 [`tools/README.md`](./tools/README.md)（内置工具清单与禁用现状）
- `rules/` — RuleDescriptor YAML
- `skills/` — SkillDescriptor 目录与资源

## Loading

- 冷启动：全局 prompt（`CUBE.md`）+ agent 索引 + skill/rule 目录
- 内置 / 管理 Tool：由引擎代码注册（非本目录 YAML）
- 可选：`AGENTIC_ENGINE_TOOL_DESCRIPTOR_DIR` 加载自定义 tool 文件（非递归）
- 运行时缓存 hydrated descriptor，文件变更或 reload 时驱逐
