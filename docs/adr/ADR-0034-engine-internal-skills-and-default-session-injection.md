# ADR-0034: 引擎内置 skill 与租户会话默认注入 —— default-reasoning/chart-output 全局常驻、不可声明/退订，成本经技能正文精简而非激活门控收敛

- **Status**: Accepted
- **Date**: 2026-07-06
- **Deciders**: 架构组（经 `/grill-with-docs` 逐项收敛）
- **Tags**: agent, engine, skill, descriptor, prompt-assembly, token-budget

## Context

`packages/contracts/src/descriptor/engine-internal-catalog.ts` 定义了两组常量：

- `ENGINE_INTERNAL_SKILL_REFS = ["default-reasoning", "chart-output"]` —— **引擎内置 skill**：技能库/货架不可见、不可安装、**不可写入用户 `agent.skillRefs`**（`filterUserVisibleSkillRefs` 剔除、`findEngineInternalRefsInAgentContent` 判违规、`stripEngineInternalRefsFromAgentContent` 兜底清洗）。
- `DEFAULT_USER_SESSION_SKILL_REFS = ["default-reasoning", "chart-output"]` —— **租户会话默认注入**：`session.service.ts` 建 session 时对**租户 agent**（`agentIsTenantRef`）经 `withDefaultUserSessionSkillRefs` 在用户可见 skillRefs 之上补齐；内置/系统 agent 走 `rawSkillRefs` 原样（`cube-default` 显式声明 `chart-output`，`cube-researcher`/`cube-descriptor-manager` 只有 `default-reasoning`）。

二者叠加得出一个**反直觉但刻意**的事实：**租户 agent 拿到 chart-output 的唯一途径就是默认注入——它们无法在 skillRefs 里声明它，也无法退订**。这两个 skill 每轮都被激活成 **Active Skills**（注入完整 instructions，见 CONTEXT.md「技能激活分层」），不进 Available 菜单。

触发本 ADR 的两件事：

1. **成本审计**：一次 13 字用户输入实测输入 17,923 token，其中 `chart-output` 完整正文约 **1790 token**、每轮常驻。审计据此提出「按 agent 声明 / 按意图门控」以省成本。
2. **幽灵 ADR 引用**：`engine-internal-catalog.ts` 注释引用「（ADR-0023）」，但 `docs/adr/README.md` 已记载 0020/0021/**0023–0026** 为遗留占位、**不建档**、新增文档化 ADR 由 0027 续接。该设计因此从无正式决策记录。本 ADR 以下一空号 **0034** 补齐（并把代码注释改引 0034）。

## Decision

### 1. 确认 engine-internal + 默认注入设计（不改）

`default-reasoning`、`chart-output` 维持 **engine-internal**（对库/货架不可见、不可安装、不可写入用户 skillRefs）+ **对租户会话默认注入**。租户 agent 不能声明、不能退订——这是**刻意**的「平台级隐藏默认输出能力」，保证任意租户 agent 无需感知即拥有通用推理与出图能力。

### 2. chart-output 每轮成本经**技能正文精简**收敛，而非激活门控（本轮 F3）

`descriptors/skills/chart-output/SKILL.md` 原正文（163 行）把同一批规则重述 4–6 次（「数据图 echarts / 结构图 mermaid」「禁 `var option`/`echarts.init`/`setOption`/`formatter`」「严格 JSON」「不要推脱渲染」分散在 `使用示例`/`输出规范`/`禁止出现的模式`/`避坑指南`/`自检清单`）。本轮**合并冗余为单一权威规范 + 每类一个示例**，保留全部 echarts/mermaid 契约（禁用键、严格 JSON、fallback 到 Markdown 表格等），版本 1.0.3 → 1.1.0，目标 ~900–1100 token。

这是**零激活模型改动、零兼容破坏**的降本路径：凡激活即省，对每个带它的 agent（全部租户 agent + `cube-default`）生效。

### 3. 保持 Active（完整正文常驻），不改激活门控

不把 chart-output 改为 `keyword`/`semantic` 门控。弱模型（qwen-flash）下，「该出图却未激活 → 不知 echarts 契约 → 输出坏图/幻觉」的质量风险，高于省下的 token 收益。

## Consequences

- **Positive**：任意租户 agent 免声明即具备可靠出图；chart-output 每轮 token 约降 40–50%（~1790 → ~900–1100），无兼容破坏、无激活语义改动；幽灵 ADR-0023 引用收口到正式的 ADR-0034；审计里最大的两个 token 头（Available Skills ~6k、Tool Definitions ~2k）分别因「精确选型防幻觉」保留与「tachu 自渲染」归属而不在本轮，决策边界清晰。
- **Negative**：**不出图的租户 agent 仍付（已降低的）chart-output 成本**——因 engine-internal 无退订通道，这是接受的权衡；精简正文对弱模型依从的影响需经出图 eval 确认（见 Open Questions），故采「克制合并」而非砍到骨头。
- **Neutral**：`default-reasoning` 本轮未审其正文冗余；内置工具类 agent（researcher/descriptor-manager）已不带 chart-output，无需迁移；snapshot 冻结语义不变，已建会话不受影响。

## Options Considered

- **按 agent 声明**（从默认移除、agent 自行在 skillRefs 声明）：对**租户 agent 走不通**——chart-output 是 engine-internal、被 `filterUserVisibleSkillRefs` 剔除且判违规，声明不了；移除默认 = 所有租户 agent 直接失去出图且无开关加回。否。
- **激活门控（keyword/semantic）**：连出图 agent 也只在该出图时付费，省最多；但有「主动出图漏激活 → 坏图/幻觉」的弱模型质量风险。否（质量优先）。
- **per-agent 退订开关**（默认开、作者可关，保兼容）：能让不出图的租户 agent 省掉整份 chart-output，且不破坏现有出图；但需新增 contracts 字段 + session 消费 + 管理面 UI。暂否（留 Open Question）。
- **de-internalize chart-output**（改为租户可声明的普通系统 skill）：最贴合「按 agent 声明」，但改变能力可见性分层、需数据迁移、破坏现有租户 agent 出图。否（本轮）。
- **精简技能正文（本决策）**：合并 4–6 处重复、保留全部契约，凡激活即省、零兼容/激活改动、质量可控。是。

## Open Questions

- 是否需要 per-agent「退订默认 chart-output」开关（默认开），让纯文本类租户 agent 免付？触发条件与管理面暴露形态待定。
- `default-reasoning` 正文是否也有可精简冗余。
- chart-output 精简后的**出图 eval**：对 qwen-flash 验证「数据图走 echarts、严格 JSON、无禁用键、不推脱渲染」依从率不低于精简前（本 ADR 落地的验收项，需 live 模型运行）。
