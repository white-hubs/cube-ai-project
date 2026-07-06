# ADR-0033: descriptor 创建契约收口 —— 唯一信封 `{ name, content }` + name 作 fail-closed slug 身份键 + propose 产出 name，三面统一 intake（修订 ADR-0018 / 扩展 ADR-0027）

- **Status**: Accepted
- **Date**: 2026-07-04
- **Deciders**: 架构组（经一轮 `/improve-codebase-architecture` grilling 收敛；起于一例 `INVALID_ARGUMENT_DESCRIPTOR_NAME` 线上错误）
- **Tags**: agent, engine, descriptor, contracts, sdk-console, propose, wire-schema

## Context

一例 `INVALID_ARGUMENT_DESCRIPTOR_NAME`（"Descriptor name is required"）暴露出一条**契约漂移**：

- `DescriptorManagementService.create()` 期望信封 `{ name, content }`（ADR-0018 §4 正式契约；`:fromDocument` frontmatter、管理 ops 工具集 create 均如此）。
- 但 `agent-sdk-console` 的 `createAgent(content)` 直接把**扁平 kind content** 当 body 发出——body 里根本没有顶层 `name`，服务端遂 fail。
- `AgentContentInput`（= `TenantAgentContentSchema` 的 input）里也**没有** `name`，只有 content 内的 `displayName`。

即：**创建请求的形状没有唯一真源**。SDK 序列化端与服务端反序列化端各写各的，中间无「crossing test」把两者钉在一起；`name` 的取值策略在三个 create 入口（HTTP 结构化 / `:fromDocument` / MCP ops）各自发散。此前的临时补丁（controller 里 `normalizeCreateBody` 从 `displayName` 派生 `name`）能解一时之堵，但把「身份键从人类标签派生」这一**错误耦合**固化了下来——而 `displayName` 允许中文/大写/空格，根本不适合当租户内唯一键或文件名式 slug。

另一处相关缺陷：`create` 走 `repo.upsert(name)` 时**未做同名 owner 归属检查**（`:fromDocument` 做了），意味着 A 用户可用 B 用户已占用的 `name` 触发覆盖式 upsert——跨用户隔离在此有洞（ADR-0029）。且 `:fromDocument` **未过** `assertUserDescriptorContentIsolated`（engine-internal ref 隔离），而结构化 `create` 过了——两条写路的校验强度不一致。

约束基线不变：跨域只走 contracts port（ADR-0002）；租户/用户隔离（ADR-0012 addendum / ADR-0029）；draft/publish 版本模型（ADR-0016）。

## Decision

### 1. `name` = fail-closed 的 slug 身份键，与 displayName / id 严格三分

`name` 是**租户内唯一键**，创建时**必填、显式、不可变**，服务端**永不从 displayName 派生**。contracts 立单一权威 `DescriptorNameSchema`：

```
DESCRIPTOR_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/   // 小写 kebab、ASCII、无 前导/尾随/连续 连字符
DescriptorNameSchema = z.string().trim().regex(DESCRIPTOR_NAME_PATTERN, …)
```

三分语义（见 CONTEXT.md「descriptor 三重标识」词条）：

| 字段 | 角色 | 载体 / 生命周期 | 约束 |
| --- | --- | --- | --- |
| `name` | 身份键（≈文件名） | 顶层、不可变、**不进版本内容** | slug，fail-closed |
| `displayName` | 人类标签 | **content 内**、被版本化 | 任意字符（可中文），可重复 |
| `id`（`agt_`…） | 运行时身份 | 服务端生成 SFID | 不可变 |

理由：`content` 是被版本化的单元（`draft_content_json`，publish 冻结、有版本历史）；`name` 是身份键、从不进版本内容。二者生命周期不同，故结构上分离——与 `update`（只传 content、name 不可改）天然对称。

### 2. 唯一 wire 契约 = 信封 `{ name, content }`

contracts 新增 `TenantDescriptorCreateRequestSchema = { name: DescriptorNameSchema, content: unknown }`，作为**三面 + propose 产出**唯一同形真源。`content` 处为 `unknown`（kind 来自路径/工具入参），由服务端按 kind 二次校验。不引入二级结构以外的东西——信封本身即最小必要结构（`content` 嵌套的「足够理由」：版本生命周期 + update 对称 + propose→create 对称 + content schema 演进零维护）。

`agent-sdk-console` 的 `createAgent/createSkill/createRule` 签名由 `(content)` 改为 `({ name, content })`（新增导出类型 `DescriptorCreateRequest<C>`），与 wire 1:1 镜像。SDK 单测新增 **crossing test**：断言 `createAgent` 实际序列化出的 body 能被 `TenantDescriptorCreateRequestSchema.parse` 通过——按构造消除漂移。

### 3. propose 产出即带 slug-safe `name`

`ProposeResultSchema` 顶层加 `name: DescriptorNameSchema`，使产出 `{ name, content, suggestions }` 与 create 信封同形、可直接喂 create。Phase-2 结构化 prompt 要求 LLM 产出 `meta.name`（明示 slug、ASCII、非空、≠ displayName）；服务端 `toDescriptorNameSlug` 做有损兜底（`meta.name` → `displayName` 有损 slug → `${kind}-<rand>` 生成），保证恒为合法 slug。理由：`displayName` 可能全中文，create 端 `name` 必填不可派生——若 propose 不产 name，AI-native 创作链（propose→create）与 console 前端对接时就**缺字段**。

### 4. 三面统一 intake —— `writeDraft` 单点写核

`DescriptorManagementService` 抽出私有 `writeDraft(tenant, kind, rawName, rawContent, actor)`，收敛四件事到一处：**name 政策**（`assertDescriptorName`，slug fail-closed）、**content 校验**（按 kind schema + engine-internal ref 隔离）、**同名 owner 归属检查**（防跨用户覆盖）、**作者货架登记**。`create`（吃信封）与 `fromDocument`（YAML 解析后）都经此核；MCP ops create 本就走 `service.create`，自动继承。领域解析（YAML→structured）仍留 `DescriptorDocumentParser`——intake 只吃已成形的 `(name, content)`。

副作用（一并修复）：`:fromDocument` 现在也过 owner 归属检查与 engine-internal 隔离校验，两条写路强度一致。

### 5. 立即移除兼容读

删除 controller 的 `normalizeCreateBody` 兼容适配。结构化 create 唯一接受信封；扁平 body（无 `name`）由 `writeDraft` fail-closed 拒绝。下游未升级的 SDK 调用会失败直至对齐——强制一次到位（本轮 SDK 与服务端同 PR 更新，playground codegen 从类型再生）。

## Consequences

- **正向**：创建请求形状有唯一归宿（contracts schema）；SDK↔server 由 crossing test 钉住、不再漂移。name/displayName/id 三分在类型层显式化，杜绝「拿中文 displayName 当键」。三面 name 政策 + 校验统一在 `writeDraft` 单点，附带堵上 `create` 的跨用户覆盖洞与 `:fromDocument` 的隔离校验缺口。propose→create 全链同形，AI-native 创作与 console 对接不再缺字段。
- **代价 / 破坏性**：`createAgent(content)` → `createAgent({ name, content })` 是 **breaking change**；未升级的下游立即 400。`name` 收紧为 ASCII slug，非法名（中文/大写/空格/边缘连字符）一律拒——含既有 `:fromDocument` frontmatter 非 slug 名（仅在 create 入口校验，不追溯既存行的 `name`）。
- **中性**：`content` 内仍保留 `displayName`（被版本化的人类标签）；`name` 不进 content。

## Options Considered

- **下游改 SDK 对齐信封（选中）** vs 上游服务端改吃扁平：后者需服务端持续维护「哪些顶层键是身份 vs 内容」的拆分规则，随 content schema 演进而脆化，且与 `:fromDocument`/MCP/update 全线不一致。信封使四面一致、零拆分维护。
- **name 可选 + 从 displayName slug 化派生**（长期行为）：被否。displayName 可全中文 → 派生要么产空要么产不稳定 slug；把身份键耦合到人类标签是本次 bug 的根因，不固化。
- **真扁平 wire `{ name, displayName, prompt, … }`**（无 content 嵌套）：被否。理由见 Decision §2（版本生命周期 / update 对称 / propose 对称 / 演进维护）。
- **保留兼容读、加 deprecation 日志渐进迁移**：被否，选择立即移除强制一次到位（本轮同 PR 更新全链，无外部已发布消费者需过渡）。

## Open Questions

- 既有租户库中若已存非 slug `name`（历史 `:fromDocument` 导入），其 `update`/`publish` 用既存 `name`、不过 create 入口校验，暂不受影响；是否需要一次性迁移规整留待观察。
- `name` 是否需要租户内跨 kind 唯一（当前是 kind 内唯一，`(tenant, kind, name)`）——维持现状（ADR-0016）。
