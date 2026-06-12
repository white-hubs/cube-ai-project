# Agent 管理面（agent console）实现计划

> **决策权威**：[ADR-0016](../../adr/ADR-0016-agent-console-and-descriptor-dual-authority.md)。术语见 [CONTEXT.md](../../../CONTEXT.md)（Descriptor 资产一节）。
> **执行约定**：每个里程碑完成后 `bun run typecheck && bun test` 全绿再进下一个；测试与源文件同目录（`*.test.ts`），需要 MySQL/Redis 的用例写成 `*.testcontainers.test.ts`（离线自动 skip）。

**Goal:** 上游可经 HTTP API + `@cube-ai/agent-sdk-console` 对 agent / skill / rule 做租户级 CRUD / 版本 / 发布，已发布资产可被会话运行时解析；连带补全 rule 水合。另提供 **Descriptor Document** 入口（`:fromDocument` 端点），支持直接提交 YAML frontmatter + markdown body 格式的文档落库，最终效果与结构化创建等价。

**Architecture:** contracts 定 wire schema 与 id 前缀 → engine 新 BC `tenant-descriptor`（MySQL 双表 + draft/publish）→ `/agent/*` 控制器 → 运行时条目级缓存 + outbox `descriptor_reload` 广播失效 → `agent-sdk-console` 封装 HTTP。**DescriptorDocumentParser**（从 `descriptor-loader.ts` 提取）为文件加载与 `:fromDocument` 入口提供统一 document→structured 解析。

**不做（v1）：** tool 租户 CRUD、skill 附属资源文件、draft 预览运行、角色级权限（平台侧负责）、UI。

---

## 全局不变量（实现时反复对照）

1. 租户资产 id：`agt_<sfid>` / `skl_<sfid>` / `rul_<sfid>`，服务端生成；裸 name 永远指系统级。
2. 所有查询带 `tenant_id = currentTenantId()`；id 不嵌租户。
3. 只有 `published` head 可被运行时解析；草稿不可见。
4. 系统级资产对管理面只读；list 接口不混入系统级（系统级走 `/agent/system/*`）。
5. 引用校验（ruleRefs/skillRefs/subAgentRefs）：目标须为「系统级」或「本租户已发布」。
6. DI token 用 `agentic.*` 命名空间（ADR-0015）；依赖版本写 `"catalog:"`。

---

## M1 — contracts：wire schema 与 id 前缀

**Files:**
- Create: `packages/contracts/src/descriptor/tenant-descriptor.ts`（+ 同目录 `tenant-descriptor.test.ts`）
- Modify: `packages/contracts/src/descriptor/index.ts`（re-export）

**内容（zod，风格对齐同目录 `tool-descriptor.ts`）：**

```ts
export const TENANT_DESCRIPTOR_ID_PREFIXES = {
  agent: 'agt_',
  skill: 'skl_',
  rule: 'rul_',
} as const;
export type TenantDescriptorKind = keyof typeof TENANT_DESCRIPTOR_ID_PREFIXES;

/** 'agt_123' -> { kind: 'agent', sfid: '123' }；裸 name 返回 null（= 系统级） */
export function parseTenantDescriptorId(ref: string):
  { kind: TenantDescriptorKind; sfid: string } | null;

export const TenantAgentContentSchema = TenantDescriptorMetaSchema.extend({
  prompt: z.string().min(1),
  modelConfig: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
  }).optional(),
  ruleRefs: z.array(z.string()).default([]),
  skillRefs: z.array(z.string()).default([]),
  availableTools: z.array(z.string()).default([]),
  subAgentRefs: z.array(z.string()).default([]),
  maxDepth: z.number().int().positive().optional(),
});

/** 三种 kind 共有的可选展示/检索字段（对齐 Descriptor Document frontmatter，见 CONTEXT.md） */
const TenantDescriptorMetaSchema = z.object({
  displayName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  version: z.string().optional(),        // 内容语义版本，独立于 DB head_version_no
});

export const TenantSkillContentSchema = TenantDescriptorMetaSchema.extend({
  description: z.string().min(1),
  trigger: z.string().optional(),        // 对齐 SKILL.md frontmatter trigger 字段
  instructions: z.string().min(1),       // markdown 文本
});

export const TenantRuleContentSchema = TenantDescriptorMetaSchema.extend({
  description: z.string().optional(),    // 人类可读说明
  content: z.string().min(1),            // 注入 system prompt 的规则文本
});

export const TenantDescriptorStatusSchema = z.enum(['draft', 'published']);

export const TenantDescriptorViewSchema = z.object({
  id: z.string(),                        // 带前缀
  kind: z.enum(['agent', 'skill', 'rule']),
  name: z.string(),
  status: TenantDescriptorStatusSchema,
  headVersionNo: z.number().int(),
  publishedVersionNo: z.number().int().nullable(),
  content: z.unknown(),                  // head 版本内容（按 kind 再 parse）
  createTime: z.number(),
  updateTime: z.number(),
});

// 请求体：Create{name, content} / Update{content, expectedHeadVersionNo} /
// Publish{versionNo?} / List{kind 由路由决定, limit, cursor}
```

**测试要点：** `parseTenantDescriptorId` 对三种前缀、裸 name、空串、未知前缀；各 content schema 的必填/边界。

**验证：** `bun test packages/contracts && bun run typecheck`

---

## M2 — engine：`bc/tenant-descriptor` 持久化与服务

**Files:**
- Create: `packages/agent/engine/src/bc/descriptor/descriptor-document-parser.ts`（+ `descriptor-document-parser.test.ts`）
- Modify: `packages/agent/engine/src/bc/descriptor/descriptor-loader.ts`（内部改用 DescriptorDocumentParser）
- Create: `packages/agent/engine/src/bc/tenant-descriptor/`
  - `tenant-descriptor.repository.ts`（mysql2，模式对齐 `bc/session/session.repository`）
  - `tenant-descriptor.service.ts` + `tenant-descriptor.service.test.ts`
  - `tenant-descriptor.module.ts`、`index.ts`
- Modify: `infra/test-infra/fixtures/minimal-mysql.sql`（追加 DDL）
- Modify: `packages/agent/engine/src/infra/tenant-guard/isolation-matrix.ts`（登记新表的租户隔离）

**DescriptorDocumentParser — 纯函数，无 I/O（见 CONTEXT.md `DescriptorDocumentParser`）：**

```ts
// packages/agent/engine/src/bc/descriptor/descriptor-document-parser.ts
export function parseSkillDocument(raw: string):
  { name: string; content: TenantSkillContent }

export function parseRuleDocument(raw: string):
  { name: string; content: TenantRuleContent }

export function parseAgentDocument(raw: string):
  { name: string; content: TenantAgentContent }
```

- 三者统一：YAML frontmatter 提取 `name`（必填）+ schema 字段（`displayName / tags / version` + kind 特定字段），markdown body 作为主文本内容（skill→`instructions`，rule→`content`，agent→`prompt`）。
- frontmatter 中 `resources / requires / deprecated` 等不在目标 schema 的字段静默丢弃。
- `descriptor-loader.ts` 内的 `parseSkillMarkdown` 重构为调用 `parseSkillDocument`（保持行为不变，消除重复）。
- 测试：三种 kind 的 valid 文档、缺 name、缺 body、无 frontmatter、多余字段被丢弃。

**DDL（两表，audit 列对齐既有表）：**

```sql
CREATE TABLE tenant_descriptors (
  id            VARCHAR(40) PRIMARY KEY,      -- 带前缀完整 id
  tenant        VARCHAR(64) NOT NULL,
  kind          ENUM('agent','skill','rule') NOT NULL,
  name          VARCHAR(190) NOT NULL,
  status        ENUM('draft','published') NOT NULL DEFAULT 'draft',
  head_version_no      INT NOT NULL DEFAULT 1,
  published_version_no INT NULL,
  deleted       TINYINT NOT NULL DEFAULT 0,
  -- create_by/creator_id/creator_type/create_time/update_* 同既有 audit 体系
  UNIQUE KEY uk_tenant_kind_name (tenant, kind, name),
  KEY idx_tenant_kind (tenant, kind)
);

CREATE TABLE tenant_descriptor_versions (
  id            VARCHAR(40) PRIMARY KEY,      -- sfid
  descriptor_id VARCHAR(40) NOT NULL,
  tenant        VARCHAR(64) NOT NULL,
  version_no    INT NOT NULL,
  content_json  MEDIUMTEXT NOT NULL,
  -- audit 列同上；版本行不可变、无软删
  UNIQUE KEY uk_descriptor_version (descriptor_id, version_no)
);
```

**Service 行为（每条都要有测试）：**
- `create(kind, name, content)`：content 按 kind schema 校验 → 引用校验 → 插 head 行（draft, v1）+ 版本行；name 撞 `uk_tenant_kind_name` 报 409 语义错误。
- `upsertFromDocument(kind, rawText)`：调 `DescriptorDocumentParser.parseXxxDocument(rawText)` 提取 `{name, content}` → 按 `(tenant, kind, name)` 查找；不存在则 `create()`，已存在则 `update(id, content, currentHeadVersionNo)`（跳过乐观锁冲突检查，直接用当前 head_version_no）→ 返回 `{ id, name, action: 'created' | 'updated', headVersionNo, status: 'draft' }`。结果始终为 draft，需显式 publish 才对运行时可见。
- `update(id, content, expectedHeadVersionNo)`：乐观锁不符报 409；写新版本行、head_version_no+1、status 回 `draft`（已发布的资产被编辑 = published_version_no 不动、运行时继续解析旧发布版）。
- `publish(id, versionNo?)`：默认发布 head；`published_version_no = versionNo`、status=`published`；事务内经 `OutboxWriter.append` 写 `descriptor_reload` 事件（payload: `{tenant, id, kind}`）。
- `rollback` = `publish(id, 旧 versionNo)`（不需要独立方法，文档化即可）。
- `softDelete(id)`：deleted=1 + outbox 失效事件；运行时解析视同不存在。
- 引用校验：`ruleRefs/skillRefs/subAgentRefs/availableTools` 逐项——带前缀 → 本租户已发布存在；裸 name → 问系统级（agent: `DescriptorLoader.getIndexedAgentPath`；skill: `SkillRegistryService.get`；rule: M4 的 rule registry；tool: `DescriptorRegistryService.get`）。
- `resolvePublished(tenant, id)`：运行时读路径，只回 published 版本内容。

**测试：** service 单测用 fake repo；另写 `tenant-descriptor.testcontainers.test.ts` 走真 MySQL（fixture DDL）覆盖乐观锁与唯一键。

---

## M3 — HTTP：`/agent/*` 控制器与 ai-center 装配

**Files:**
- Create: `packages/agent/engine/src/bc/tenant-descriptor/tenant-descriptor.controller.ts`（+ controller 测试，模式对齐既有 `*controller.ts`）
- Create: `packages/agent/engine/src/bc/tenant-descriptor/system-descriptor.controller.ts`
- Modify: `apps/ai-center/src/routes/ai-center-domain-http.module.ts`（挂模块）
- Modify: `apps/ai-center/src/routes/domain-routes.test.ts`（加 `/agent/agents` 冒烟）

**路由（`domain-path-rewrite.middleware` 已剥 `/agent` 前缀，控制器注册裸路径）：**

| Method | Path（对外） | Content-Type | 行为 |
|---|---|---|---|
| POST | `/agent/agents` | application/json | create（skills/rules 同构） |
| GET | `/agent/agents` | — | list（仅本租户，含 draft/published 状态） |
| GET | `/agent/agents/:id` | — | detail（head 内容） |
| GET | `/agent/agents/:id/versions` | — | 版本历史 |
| PUT | `/agent/agents/:id` | application/json | update（新草稿版本） |
| POST | `/agent/agents/:id/publish` | application/json | publish（body 可带 versionNo 做回滚） |
| DELETE | `/agent/agents/:id` | — | 软删 |
| POST | `/agent/agents:fromDocument` | text/plain | **Descriptor Document upsert**（skill/rule 同构，路径换 `:fromDocument`） |
| GET | `/agent/system/agents` `/agent/system/skills` `/agent/system/rules` | — | 系统级只读列表 |

**`:fromDocument` 端点行为：**
- 读取 `text/plain` request body → 调 `service.upsertFromDocument(kind, rawText)`。
- 响应：`{ id, name, action: 'created'|'updated', headVersionNo, status: 'draft' }`，HTTP 200（created/updated 均如此，调用方按 `action` 字段区分）。
- parse 失败（缺 frontmatter、name 为空、content 不合 schema）→ 422。

**注意：**
- 复用既有 tenant-context / 鉴权中间件链（与 `/sessions` 同链路），不加任何新鉴权概念。
- 响应不回 `tenant` 字段（对齐 session 的 §API-4 约定）。
- `/agents` 与消费面无路径冲突（engine 现有 `/sessions /files /grants /jobs /health`）。

---

## M4 — 运行时：解析、缓存、失效、rule 水合

### 4a. outbox `descriptor_reload` 派发补全

- Modify: `infra/bun-server-ext/outbox/src/dispatcher.ts`：CompositeDispatcher 对 `channel === 'descriptor_reload'` 走新的 `RedisPubSubDispatcher`（`redis.publish(REDIS_PUBSUB_CHANNELS.descriptor_reload, payloadJson)`）；`infra/bun-server-ext/outbox/src/outbox.module.ts` 装配。
- Test: 对齐 `infra/bun-server-ext/outbox/src/test/relay.service.test.ts` 的 fake 模式。

### 4b. 条目级缓存

- Create: `packages/agent/engine/src/bc/tenant-descriptor/tenant-descriptor.cache.ts`
  - `get(tenant, id)`：Map 命中即回；miss → `resolvePublished` 回源后缓存（含「不存在」负缓存）。
  - 订阅 Redis 频道 `agentic:engine:pubsub:descriptor.reload`，按 payload 删单条 key；Redis 不可用时降级为直读 DB（warn 一次）。

### 4c. 运行时解析点接入

- Modify: `packages/agent/engine/src/bc/session/session.service.ts`
  - `buildSnapshots`：`agentId` 经 `parseTenantDescriptorId` 分流——`agt_` → 缓存/DB 取 published content（shape 与文件 YAML record 对齐后走既有路径）；裸 name → 现有 `descriptorLoader.getAgent`。snapshot 里记录 `descriptorVersionNo`。
- Modify: `packages/agent/engine/src/bc/session/snapshot-skill-hydration.ts`：`runtimeRefs.userSkills` / agent `skillRefs` 中 `skl_` → 租户解析为 `SkillDescriptor` 形（name/description/trigger/instructions），裸 name → 现有 `SkillRegistryService`。

### 4d. rule 水合（系统级 + 租户级）

- Modify: `packages/agent/engine/src/bc/descriptor/descriptor-loader.ts`：新增 `loadRulesFromDir`（默认 `descriptors/rules/`，env `AGENTIC_ENGINE_RULE_DESCRIPTOR_DIR` 覆盖），解析 `kind: rule` YAML（name + content）进新的内存 `RuleRegistryService`（同目录新文件，模式抄 `skill-registry.service.ts`），`start()` 与 Nacos reload 时各调一次。
- Modify: `packages/agent/engine/src/bc/session/session.service.ts` `buildSnapshots`：`ruleRefs` 逐项解析（裸 name → RuleRegistry；`rul_` → 租户缓存），内容写入 `snapshot.rules`（替换现在恒空的 `rules: []`），保持 4MB snapshot 上限检查。
- Modify: prompt 组装处（`packages/agent/engine/src/bc/tachu/engine-factory.ts` / `cube-engine-prompt-overrides.ts`，以实际消费 snapshot 的位置为准）：把 `snapshot.rules` 内容拼入 system prompt（global prompt 之后、agent prompt 之前），有既有 prompt-dedup 测试保护。
- Test: 端到端断言——建 session 引用 `safety-baseline`，snapshot.rules 非空且 prompt 含规则文本（更新 `session.service.test.ts` 现有 `ruleRefs` 用例）。

---

## M5 — SDK：`@cube-ai/agent-sdk-console`

**Files:**
- Create: `packages/agent/sdk-console/`（package.json `"@cube-ai/agent-sdk-console"`、tsconfig、`src/{index,client,http}.ts`、`src/client.test.ts`）——整体结构、构建与测试模式**照抄 `packages/llm/sdk-console`**。
- Modify: 根 `package.json` workspaces 若用显式列表则追加（glob 匹配则不用动）。

**API 面（类型全部 import 自 `@cube-ai/contracts`）：**

```ts
const console = createAgentConsoleClient({ baseUrl, auth, headersProvider });
console.agents.create / list / get / versions / update / publish / remove
console.agents.createFromDocument(rawText: string)  // POST :fromDocument, text/plain
console.skills.*   // 同构（含 createFromDocument）
console.rules.*    // 同构（含 createFromDocument）
console.system.listAgents / listSkills / listRules
```

`createFromDocument` 的返回类型：`{ id: string; name: string; action: 'created' | 'updated'; headVersionNo: number; status: 'draft' }`。

只走 HTTP，不 import 任何后端包（ADR-0011/0002 红线，`composition-root-import-boundary.test.ts` 会兜底）。

**Test:** 用 fetch mock 断言 method/path/body/headers 与 4xx 错误映射，对齐 `llm/sdk-console/src/client.test.ts` 的写法。

---

## M6 — 收尾与全量验证

- Modify: `descriptors/README.md`：标注「文件 = 系统级权威；租户级走 `/agent/*` 管理面（ADR-0016）」。
- Modify: `AGENTS.md` 目录地图行 `packages/agent/sdk-*` 描述若列举了家族成员则补 `console`。
- 集成测试：`apps/ai-center` 或 engine 下新增 `tenant-descriptor-e2e.testcontainers.test.ts` —— create agent（带 ruleRefs/skillRefs）→ publish → `POST /v1/sessions` 用 `agt_` id 建会话成功且 snapshot 含水合内容；未 publish 的 draft 建会话应 4xx。
- 全量门：`bun run typecheck && bun test`；有 Docker 时 `bun run test:containers`。

---

## 里程碑依赖与交付顺序

```
M1 contracts ──► M2 持久化 ──► M3 HTTP ──► M5 SDK
                      │
                      └──► M4 运行时（4a 可与 M3 并行；4c/4d 依赖 M2）──► M6
```

每个里程碑独立可合（typecheck+test 全绿）；M3 完成后 API 即可用 curl 验证，M4 完成后资产才真正参与会话。
