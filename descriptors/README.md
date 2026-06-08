# Descriptor Repository Layout

声明式资产目录，供 agent-engine `DescriptorLoader` 加载。

## Structure

- `agents/` — AgentDescriptor YAML
- `tools/` — tool descriptors
- `rules/` — RuleDescriptor YAML
- `skills/` — SkillDescriptor 目录与资源

## Loading

- 冷启动：全局 prompt（`CUBE.md`）+ agent 索引
- 按需：被引用时解析 rule/skill/tool 文件
- 运行时缓存 hydrated descriptor，文件变更或 reload 时驱逐
