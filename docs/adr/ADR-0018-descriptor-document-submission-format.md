# ADR-0018: Descriptor Document 提交格式 —— `:fromDocument` 独立端点、text/plain upsert、draft 落库、DescriptorDocumentParser seam、三种 kind schema 对称扩展

- **Status**: Accepted
- **Date**: 2026-06-12
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: agent, console, descriptor, sdk, api-design

## Context

ADR-0016 定义了 agent 管理面的结构化 CRUD 路径（`POST /agent/agents` 等，JSON body，`content` 字段为结构化对象）。上游平台（tachu 等）同时需要一种**文档驱动**的提交方式：直接将类似 `descriptors/skills/*/SKILL.md` 的原始文档内容 POST 到管理面，落库效果与结构化创建等价。

背景约束：
- 系统级 skill 已有 YAML frontmatter + markdown body 格式（`parseSkillMarkdown`），rule / agent 目前为纯 YAML。
- `parseSkillMarkdown` 等解析函数是 `descriptor-loader.ts` 的私有模块函数，HTTP 层不可访问。
- ADR-0016 §4 定义 draft/publish 两态；§6 规定 v1 不支持 skill 附属资源文件。

## Decision

### 1. 格式：三种 kind 统一为 YAML frontmatter + markdown body

agent / skill / rule 的 Descriptor Document 格式完全对齐 SKILL.md：

```
---
name: <string, required>
description: <string>
displayName: <string>
tags: [...]
version: <string>        # 内容语义版本，独立于 DB head_version_no
<kind 特定字段>           # skill: trigger; agent: modelConfig/ruleRefs/skillRefs/...
---
<markdown body>           # skill → instructions; rule → content; agent → prompt
```

frontmatter 中不在目标 schema 的字段（`resources`、`requires`、`deprecated` 等）静默丢弃。

### 2. 端点：独立 `:fromDocument`，不与结构化路径复用

```
POST /agent/agents:fromDocument   Content-Type: text/plain
POST /agent/skills:fromDocument   Content-Type: text/plain
POST /agent/rules:fromDocument    Content-Type: text/plain
```

独立端点，而非在 `POST /agent/agents` 同端点通过 `rawContent` 字段区分。理由：
- raw 路径完全自包含（name 来自 frontmatter），与结构化路径（name 在请求体顶层）的语义根本不同；同端点多态会混淆契约。
- 上游调用模式清晰：`createFromDocument(text)` vs `create({ name, content })`。

### 3. 请求体：`text/plain`，非 JSON 信封

HTTP body 直接是文档原文，无 JSON 包装。上游可直接将文件内容 POST，sdk-console 封装后对调用方透明。

### 4. 写入语义：按 `(tenant, kind, name)` upsert，结果为 draft

- 不存在 → create（draft, v1）。
- 已存在 → update（新草稿版本，head_version_no+1，status 回 draft）。
- 结果始终为 **draft**，需显式 `POST /agent/agents/:id/publish` 才对运行时可见（与结构化路径一致，无 auto-publish）。
- 响应：`{ id, name, action: 'created' | 'updated', headVersionNo, status: 'draft' }`，HTTP 200。
- parse 失败（缺 frontmatter / name 为空 / content 不合 schema）→ 422。

### 5. DescriptorDocumentParser seam：从 `descriptor-loader.ts` 提取

新建 `packages/agent/engine/src/bc/descriptor/descriptor-document-parser.ts`，导出纯函数（无 I/O）：

```ts
parseSkillDocument(raw: string): { name: string; content: TenantSkillContent }
parseRuleDocument(raw: string): { name: string; content: TenantRuleContent }
parseAgentDocument(raw: string): { name: string; content: TenantAgentContent }
```

`descriptor-loader.ts` 内部的 `parseSkillMarkdown` 重构为调用 `parseSkillDocument`，保持行为不变。`:fromDocument` controller 调用同一函数。**两个消费者（文件加载 + HTTP 入口）确认了这个 seam 的价值。**

### 6. 三种 kind 的 contracts schema 对称扩展

`TenantSkillContentSchema` / `TenantRuleContentSchema` / `TenantAgentContentSchema` 均加入：

```ts
displayName?: string
tags?: string[]
version?: string   // 内容语义版本，非 DB 修订计数
```

三种 kind 同步扩展，避免后续再走一遍 contracts → engine → SDK 变更链路。

## Consequences

- **Positive**：上游可直接将 SKILL.md 类文档 POST 落库，无需 JSON 序列化；文件加载与 HTTP 入口共用 DescriptorDocumentParser，解析逻辑有单一 locality；格式与系统级 `descriptors/` 文件对齐，迁移路径自然。
- **Negative**：新增 3 条路由（每个 kind 一条）；`descriptor-loader.ts` 需重构以复用 parser；`text/plain` body 需在中间件侧单独处理（不走 JSON 解析中间件）。
- **Neutral**：`:fromDocument` upsert 不做引用校验的乐观锁——update 路径直接用当前 head_version_no，不要求调用方传 `expectedHeadVersionNo`（结构化 `update` 需要）。

## Options Considered

- **同端点 body 多态（`rawContent` 字段）**：保持路由简单，但结构化与 document 路径语义根本不同（name 来源不同），共享端点混淆契约。否。
- **JSON 信封 `{ "document": "..." }`**：所有端点保持 JSON 统一，但上游需额外字符串序列化，与"原始文档"语义相悖。否。
- **auto-publish（`:fromDocument` 写入即生效）**：符合 CI/CD 部署直觉，但破坏 draft/publish 两态统一语义，管理面用户失去"审核后上线"空间。否（保留 draft，需显式 publish）。
- **解析逻辑放 controller**：实现最快，但与 `descriptor-loader.ts` 内部解析重复，无 locality。否（取 DescriptorDocumentParser seam）。
- **仅 skill 支持 document 格式，rule/agent 暂不支持**：保守，但制造 kind 间不对称，之后扩展还需再走一遍变更链路。否（三种 kind 一次对齐）。

## Open Questions

- `:fromDocument` 的 upsert 是否需要幂等键（防止重复 POST）？当前依赖 `(tenant, kind, name)` 唯一键自然幂等，无需额外机制。
- agent Descriptor Document 的 frontmatter 中 `subAgentRefs` 嵌套 agent id（带 `agt_` 前缀）时，引用校验与结构化路径一致（目标须为系统级或本租户已发布）——无额外问题，文档化即可。
