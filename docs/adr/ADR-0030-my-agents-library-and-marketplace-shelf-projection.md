# ADR-0030: 我的智能体 / 库（商城）+ 技能 / 插件 —— 用户级货架投影、作者归属、发布≠上架、ref 浮动安装、内容可见性分层

- **Status**: Accepted
- **Date**: 2026-06-22
- **Parent / Amends**: [ADR-0016](./ADR-0016-agent-console-and-descriptor-dual-authority.md)（修订 §3 标识/归属、§4 版本模型、§8 鉴权）、[ADR-0029](./ADR-0029-session-owner-user-isolation-sublayer.md)（把「user 是 tenant 之下子层」模式从 session 锚定资源**扩展**到 descriptor 货架/作者归属）
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛；结构/归属/发布语义/安装语义/可见性/admin 由用户逐项裁决）
- **Tags**: agent, skill, tool, console, descriptor, marketplace, user, tenant, owner, version, authz

## Context

ADR-0016 给了 agent 域**租户级**管理面：agent / skill / rule descriptor 按 `tenant` 隔离做 draft/publish/版本 CRUD，`create_by` 仅审计、**无 user 维度**，tool **不入**租户 CRUD（Nacos 运维推送）。ADR-0029 把 **user** 确立为 tenant 之下、**仅作用于 session 锚定资源**的隔离子层，明确**不含 descriptor**、不复活 project。

但当前 `agent-sdk-console` 仅是上述 tenant 级 CRUD（见 `packages/agent/sdk-console/src/client.ts`），**无法支撑生产级**的智能体/技能/插件生态。上游需要补齐一组概念的业务闭环：**《我的智能体》《智能体库（商城）》《技能库（商城）》《我的技能》《插件库（工具库，只提供安装）》**，并收到 9 条零散故事点（我的智能体用户级、启用禁用/删除用户级、发布、库管理「我发布的」、删除仅移除、库添加先 ref/copy 留口子、版本/回滚/恢复草稿、选未发布草稿）。

三处术语与既有词条/ADR 冲突，须先对齐：①「**用户级**」vs descriptor 现为 tenant 级（ADR-0016）+ user 仅 session 锚定（ADR-0029）；②「**发布**」已有精确含义（草稿→运行时可解析），与「发布到库（共享）」撞名；③「**删除**」（ADR-0016 软删）与「删除仅是移除」撞名。

约束基线：跨域只走 contracts port（ADR-0002）、统一 MySQL（ADR-0013）、tenant 单一隔离主键（ADR-0012-addendum）、能力包无自有鉴权 / engine 不自建角色（ADR-0016 §8）、Tool 编排归 engine（ADR-0006）。

## Decision

### D1 — 我的智能体 = 用户级货架投影层（非用户级 descriptor 存储）

「我的智能体」是单一 user 在其 tenant 内「可运行/可选用智能体集合」的**用户级视图（货架）**，**叠加在 tenant 级 descriptor 之上**：descriptor 权威仍 tenant 级（ADR-0016 不动其存储/隔离），「用户级」只指**货架条目及其 per-user 状态**。这是 **tenant 之下的投影子层**，与 ADR-0029 的 session owner 同构，**不复活 project、不改 tenant 单一隔离主键**。货架两类来源：**我创作的**（authored，创建即自动入货架）+ **从库安装的引用**。

### D2 — 智能体作者归属（owner）：descriptor 增 tenant 内作者维度（修订 ADR-0016 §3/§8）

`tenant_descriptors` 增 `owner_user_id`，标记创作者 user。**作者（+ 治理 admin，见 D10）独占该 descriptor 的编辑/发布/回滚/软删**；**未发布草稿仅作者可见**。owner 是 **tenant 之下的作者/写控属性、不是新隔离键**（tenant 仍是隔离边界）；与 ADR-0016 §8「engine 不建角色 / 租户内人人可改」相比，本决策引入**作者级写控**（仍非角色模型，按 owner + 平台 scope 判定）。

### D3 — 发布 ≠ 上架（两个独立动作；放宽「只有 published 可解析」）

- **发布 (publish)** = 把草稿冻结为**不可变的已发布版本**，是**作者私有**的稳定可解析版本（沿用 ADR-0016 版本机制，但不再等于「共享」）。
- **上架到库 (list)** = 把**某个已发布版本**暴露到 **智能体库（商城）** 供**同租户** user 发现+安装；**上架必须基于 published 版本**（不能上架草稿），上架**设置/更新该 agent 的「当前共享版本」指针**；逆动作 **下架 (unlist)**。
- **作者可直接选用/运行自己的未发布草稿 head**，无需发布。ADR-0016 §4「只有已发布 head 可被新 session 解析」**放宽**为：**仅对非作者、或经安装引用的消费**才要求已发布版本。

### D4 — 草稿可变 + 版本仅发布时冻结（修订 ADR-0016 §4）

- **草稿 (draft)** = **单条可变工作副本**，保存即覆盖、**不进版本历史**；**恢复草稿 = 编辑器级 undo**（丢弃未保存编辑、重载最近一次已保存草稿，与版本历史无关）。
- **版本 (version)** = **仅在发布时**由草稿冻结而成，不可变、append-only。
- **展示版本** = 已发布版本列表；**回滚 (rollback)** = 选一个历史已发布版本、其内容成为**新的发布版本**（已上架者需重新上架才改共享指针）。
- 这把 ADR-0016 §4「编辑产生草稿版本」改为「草稿可变、发布才出版本」。

### D5 — 安装：默认浮动 ref / 可钉版 / copy 留口子

- **安装 (install)** 默认产生**浮动引用 (float ref)**：解析到上游**当前已上架版本**（随作者上架前进；作者**下架/删除后冻结到最后一次已上架版本**——故「下架不影响已安装方」；再上架恢复跟随）。
- 可选**钉版引用 (pinned ref)**：钉在选定的已发布版本、不自动前进，安装方可显式「更新到最新已上架版本」。
- 安装方对引用只能**启用/禁用/移除**与切换钉/浮，**不可编辑/发布/回滚**（owner 的权）。
- **copy** 留口子：完全解耦 fork（快照物化为 copier 自己 owner 的新 descriptor、与上游彻底脱钩、仅留 `copied_from` provenance），安装记录以 `source = ref | copy` 区分、默认 `ref`，**本轮只留口子不实现**。

### D6 — 移除 ≠ 软删（两动作两视图）

- **「我的智能体」货架**：`移除` = 用户级，仅丢弃货架条目（ref 即卸载、authored 即移出运行集），**不删 descriptor**；`启用/禁用` = 用户级可用性开关（禁用后不进本 user 可选/可启动集，不影响他人、不影响已在跑会话——快照冻结）。
- **「我创作的 / 管理视图」**：按 owner 过滤的管理面，**编辑/发布/上架/回滚/软删 descriptor** 在此；**软删才是 ADR-0016 真销毁**（连带下架）。
- authored agent **创建即自动入货架**，满足「选择自己未发布但已保存的智能体」。

### D7 — 技能完全镜像 agent，差异仅消费方式

skill 复用同一套 owner / 草稿·发布·版本·回滚 / 技能库（上架·下架）/ 我的技能（安装 ref、copy 留口子、启用·禁用·移除）。**唯一差异**：skill 不独立运行，而是**被 agent 的 `skillRefs` 引用**。租户内 transitive 引用天然可解（被引技能只要本租户已发布即 tenant 级可见，ADR-0016 §6）。

### D8 — 插件库（工具库）只提供安装（守 ADR-0016/0006）

插件库 = **系统/运维（Nacos）登记的工具目录**，对 user **只提供安装**——**无创作/发布/上架/版本/owner**（tool 仍不入租户 CRUD、Tool 编排仍归 engine、凭据/consent/safety 仍运维侧）。**安装 = 每用户把工具启用进自己的「可用工具集」**，经 agent `availableTools` 消费；启用/禁用/移除 per-user。**运行期工具授权仍是 ADR-0006 的 per-user consent/grant，不被安装替代**。

### D9 — 能力可见性分层（系统级黑盒 / 租户已上架透明）

- **系统级 descriptor（agent / skill / tool）对 user 不透明**：仅暴露**能力描述**，**不可查看内部内容**（system prompt / instructions / 工具配置 / 凭据），**仅 ref、不可 copy**（黑盒能力、IP 边界；engine 内部解析不受影响，仅 API 读取面遮蔽）。
- **租户已上架资产对同租户安装方透明**：可见内容、**ref + copy** 皆可（可读才能复制）。

### D10 — 治理 admin（补 ADR-0029 写旁路缺口，scope 驱动）

引入平台签发的**租户级 descriptor admin scope**（engine 只认 scope、不自建角色，复刻 ADR-0029 D4）：**读** = 本租户全部 descriptor + 库（对齐 ADR-0029 D3 读旁路）；**写**仅限**下架 + 软删**（治理 / 违规 / 离职清理）；**不可**编辑他人草稿内容、**不介入**他人个人货架。与 `engine.session.admin` 并列、各管各域。

### D11 — 边界与口子：仅租户内 + 配额 seam + scope seam

- **仅租户内共享**：listing 预留 `scope` 字段（恒 `tenant`）；**跨租户/全局商城显式推迟**，须另立 ADR + 平台级可见性设计才开，绝不在本轮引入跨租户读路径。
- **配额**：写路径（create / 发布 / 安装）预留校验 seam，阈值平台级可配（per-tenant + per-user），默认宽松/无限，本轮不硬编码数值。

## Consequences

- **Positive**：补齐《我的智能体/库/技能/插件》生产级闭环，满足全部 9 条故事点；三处术语冲突（用户级/发布/删除）以「货架投影 / 发布≠上架 / 移除≠软删」明确消解；owner + 货架复用 ADR-0029 的「user 在 tenant 之下」既有模式，不复活 project；默认浮动 ref + 下架冻结兼顾「上游可改进」与「不破坏已安装方」；系统级黑盒守住 IP 边界；治理 admin 补上 ADR-0029 写旁路缺口且收窄到治理。
- **Negative**：修订 ADR-0016 三处（§3 owner、§4 版本模型、§8 写控），新增多张持久化表（货架/listing/owner 列/可用工具集）与解析投影；浮动默认带来「上游悄改」风险（以可选钉版兜底）；消费方需理解 ref/copy、float/pin、发布/上架、移除/软删四组二元概念，心智变大。
- **Neutral**：copy / 跨租户 / 配额具体阈值 / admin reassign owner 均**留口子未实现**；系统级资产仍走 ADR-0016 §8 独立只读源，库 UI 仅做并列呈现；rule 不纳入货架/商城（仍 ADR-0016 租户 CRUD）。

## Options Considered

- **descriptor 真·用户级隔离存储**（给 descriptor 加 user_id 隔离键）：直观，但违背 tenant 单一隔离主键、复活类 project 维度、与 ADR-0029「user 仅 session 锚定」冲突。否（取 D1 货架投影）。
- **发布与上架合一**（发布即共享）：链路短，但与「作者私有冻结版」「选未发布草稿」矛盾。否（取 D3 两分）。
- **每次保存产生不可变草稿版本**（ADR-0016 现状）：版本列表被草稿态塞满、与「恢复草稿=undo」不符。否（取 D4 草稿可变）。
- **安装默认钉版**：可预测，但失去「上游改进自动惠及」。否（取 D5 默认浮动 + 可钉版兜底）。
- **单视图（删除对 authored=软删、对 ref=移除）**：少一个视图，但同一按钮语义二义、违背「删除仅是移除」。否（取 D6 两视图）。
- **工具开放租户/用户创作**：能力完整，但凭据/consent/safety 面大、违 ADR-0016/0006。否（取 D8 只安装）。
- **系统级资产内容透明 + 可 copy**：复用方便，但泄露内置 IP。否（取 D9 黑盒）。
- **全量 admin（读写全租户 + 他人货架）**：管控最大，但违 ADR-0029 谨慎写旁路、易误伤。否（取 D10 治理最小集）。
- **现在就做跨租户/全局商城**：一步到位，但触 tenant 隔离基线、改动巨大。缓（D11 留口子）。

## Open Questions

- copy 的实现触发与 UX（何时从 ref 转 copy、provenance 呈现）。
- 跨租户 / 全局商城的可见性与平台级身份设计（D11 推迟，须另立 ADR）。
- 配额具体阈值与超限交互（D11 留 seam）。
- 治理 admin 是否需要 **reassign owner**（离职资产转移）——D10 暂未开。
- 浮动 ref 跨「上游回滚」的 UX（上架指针变更即跟随，已定；回滚后须重上架，提示策略待定）。
- 系统级资产「下发」终态是否经管理面 API（承接 ADR-0016 Open Question）。

## References

- [ADR-0016](./ADR-0016-agent-console-and-descriptor-dual-authority.md) — 被本 ADR 修订（§3/§4/§8）
- [ADR-0029](./ADR-0029-session-owner-user-isolation-sublayer.md) — 被本 ADR 扩展（user-under-tenant 模式 → descriptor 货架/owner）
- [ADR-0012-addendum](./ADR-0012-addendum-tenant-single-isolation-no-project.md) — tenant 单一隔离主键（不复活 project）
- [ADR-0006](./ADR-0006-tool-mcp-engine-owned.md) — Tool 编排归 engine（插件库只安装的依据）
- `CONTEXT.md` — 词条「我的智能体 / 智能体库（商城）/ 智能体作者归属 / 上架到库 / 安装 / 浮动 vs 钉版 / 能力可见性分层 / 我创作的 / 我的技能 / 插件库 / descriptor 治理 admin」
