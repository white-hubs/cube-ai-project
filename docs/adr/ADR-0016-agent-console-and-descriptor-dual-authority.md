# ADR-0016: agent 管理面（console face）与 descriptor 双层权威 —— 租户 MySQL + 系统文件，前缀 id 命名空间，draft/publish 版本模型

- **Status**: Accepted
- **Date**: 2026-06-11
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: agent, console, descriptor, tenant, persistence, sdk

## Context

当前 agent 域只有消费面（`/v1/*`，ADR-0008 addendum）：agent / skill / rule descriptor 由 `DescriptorLoader` 从 `descriptors/` 文件冷加载（tool 另有 Nacos 运维推送），上游**没有任何 HTTP 接口可自助 CRUD 这些资产**。ADR-0011 包清单里 `agent-sdk-console` 标注「暂无」。

上游平台（ghcloud 等）需要租户自助管理 agent / skill / rule 的能力（对标 `agent-sdk-client*` 的消费面 SDK 体验）。同时存在一个运行时缺口：agent YAML 的 `ruleRefs` 只以字符串进入 session snapshot，`descriptors/rules/*.yaml` 内容**从未被加载与注入**（snapshot `rules: []` 恒空）。

约束基线：跨域只走 contracts port（ADR-0002）、持久化统一 MySQL（ADR-0013）、tenant 单一隔离主键（ADR-0012 addendum）、能力包无自有鉴权（CONTEXT.md）、SDK 按面命名（ADR-0011）。outbox 基建已预留 `descriptor_reload` channel 及 Redis pub/sub 频道映射（`infra/bun-server-ext/outbox/src/dispatcher.ts`），但 CompositeDispatcher 未实现该 channel。

## Decision

### 1. 范围：agent + skill + rule 的租户 CRUD；tool 不开放

Tool descriptor 涉及 consent / safety / 凭据面，保留 Nacos 运维推送通道，不纳入租户自助 CRUD。

### 2. 双层权威

- **租户级 descriptor**：唯一权威 = engine 域 MySQL（`tenant_id` 隔离），经管理面 API 写入。
- **系统级 descriptor**：唯一权威 = 部署物（`descriptors/` 文件 + Nacos），全租户可见、对管理面只读。
- 二者**互不遮蔽**，运行时合并解析。

### 3. 标识：类型前缀 id 命名空间，不嵌 tenantId

- 租户资产 id = 类型前缀 + SFID：`agt_<sfid>` / `skl_<sfid>` / `rul_<sfid>`，服务端生成、不可变。
- 裸 name（无前缀）永远指系统级资产；运行时按前缀路由解析（前缀 → 租户 DB，裸 name → 文件/registry）。
- 租户归属**不嵌入 id**，靠请求上下文 `currentTenantId()` 限定查询——同名冲突物理上不可能，也不存在跨租户 id 泄露语义。
- name 仅在租户内唯一（UX 约束），不参与运行时解析。

### 4. 生命周期：draft/publish 两态 + append-only 版本历史

- 版本表 append-only + head 指针；**编辑产生草稿版本，publish 才移 head**。
- 只有已发布 head 可被新 session/turn 解析；回滚 = 将旧版本内容发布为新 head 版本。
- 已建会话靠既有 snapshot 冻结语义不受变更影响；snapshot 记录所引用的 descriptor 版本号供审计。
- 删除为软删（与现有 audit 字段体系一致）。

### 5. 运行时消费：条目级懒加载缓存 + outbox `descriptor_reload` 失效广播

- 解析点（session create 解 `agt_`/rule、turn start 解 `skl_`）走条目级内存缓存（key = `tenant + id`），miss 回源 MySQL。
- 写路径（publish / 删除）经 outbox `descriptor_reload` channel → Redis pub/sub（`agentic:engine:pubsub:descriptor.reload`，预留频道）广播单条失效，多实例即时收敛。
- 需补全 CompositeDispatcher 对 `descriptor_reload` 的派发实现。
- 不改造现有全局 `DescriptorRegistryService` / `SkillRegistryService`（它们继续承载系统级资产）。

### 6. 引用校验与字段域

- 租户 Agent descriptor 与文件 YAML 全字段对齐（prompt / modelConfig / ruleRefs / skillRefs / availableTools / subAgentRefs / maxDepth）。
- 写入时校验引用**存在且可见**（系统级 或 本租户已发布）；subAgentRefs 同样限系统级 + 本租户。
- Skill 为结构化 wire schema（name / description / trigger / instructions[markdown]），v1 不支持附属资源文件。

### 7. Rule 运行时水合一并补全

`ruleRefs`（裸 name → 系统级文件，`rul_` → 租户 DB）在 session create 时解析出 rule 内容写入 snapshot.rules，并注入 system prompt。否则 rule CRUD 是死数据。

### 8. 路由与鉴权

- 管理面挂 `/agent/*` 领域命名空间（`/agent/agents` `/agent/skills` `/agent/rules`），与 flow/kb/llm 的「领域命名空间=管理面」模式对齐；消费面继续独占 `/v1/*`（ADR-0008 addendum 不变）。`domain-path-rewrite.middleware` 已含 `/agent` 前缀。
- list 只返回租户资产；系统级走独立只读 endpoint（如 `/agent/system/agents`）。
- 鉴权与消费面一致：platform-adapter 解租户即可 CRUD，engine 不建角色模型（角色细分归平台侧）。

### 9. SDK：`agent-sdk-console`

新增 `packages/agent/sdk-console` → `@cube-ai/agent-sdk-console`（ADR-0011 预留名），HTTP only，复用 contracts wire schema，结构对齐 `llm-sdk-console`。

## Consequences

- **Positive**：上游获得与消费面同等体验的管理面 SDK；前缀 id 让「系统级 vs 租户级」在标识层自描述，杜绝 shadow 歧义与抢注；draft/publish + 版本历史给管理面用户安全编辑与回滚；rule 水合缺口被关闭；复用预留的 `descriptor_reload` seam，无新基建。
- **Negative**：engine 新增一组持久化表与缓存失效链路，运维面变大；draft/publish 比「改了就生效」多一步操作心智；消费方需理解两类标识（裸 name / 前缀 id）。
- **Neutral**：dev 占位 agent YAML 的退役路径不变（真实租户 agent 改由本管理面创建）；tool 纳入租户 CRUD、附属资源文件、draft 预览运行等留待真实需求触发。

## Options Considered

- **同名 shadow（租户覆盖系统级同名资产）**：消费方只记 name 更简单，但运行时解析依赖隐式优先级、易被抢注/误覆盖，审计困难。否（取前缀命名空间，物理不可碰撞）。
- **短 TTL 读穿透缓存**：实现最小，但写后生效有 TTL 窗口；管理面「发布」语义要求即时可见。否（取条目级缓存 + outbox 广播失效）。
- **DB 同步进 tenant-aware 全量 registry**：读零 DB 访问，但需改造现有全局 registry、全量租户数据驻留内存。否（条目级懒加载已满足，读频低）。
- **更新即生效（无 draft/publish）**：链路最短，但租户编辑中的半成品立即暴露给运行时，无回滚。否。
- **API 写回文件 / 推 Nacos**：不动加载模型，但文件与 Nacos 都不是租户隔离存储，违背 ADR-0012 addendum / ADR-0013 的隔离与持久化基线。否。
- **Tool 纳入租户 CRUD**：能力完整，但凭据/consent/safety 审查面大，且已有运维通道。否（待真实需求另议）。

## Open Questions

- 系统级 agent 的「下发」终态：ghcloud AI 中台下发是否最终也落到本管理面 API（service-to-service 调用），从而让 `descriptors/agents/` 仅剩引擎内置？
- 配额：单租户 descriptor 数量/体积上限是否需要平台级配置。
