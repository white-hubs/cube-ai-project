# 我的智能体 / 库（商城）+ 技能 / 插件 —— 实现计划

> **决策权威**：[ADR-0030](../../adr/ADR-0030-my-agents-library-and-marketplace-shelf-projection.md)（修订 [ADR-0016](../../adr/ADR-0016-agent-console-and-descriptor-dual-authority.md) / 扩展 [ADR-0029](../../adr/ADR-0029-session-owner-user-isolation-sublayer.md)）。术语见 [CONTEXT.md](../../../CONTEXT.md) §「我的智能体与库（商城）」。
> **前置阅读**：本文件假定你已读过上面三篇 ADR 与 CONTEXT 对应段落；下文不再重复其论证，只给落地结构。
> **执行约定**：每个里程碑完成后 `bun run typecheck && bun test` 全绿再进下一个；测试与源文件同目录（`*.test.ts`），需要 MySQL/Redis 的用例写成 `*.testcontainers.test.ts`（离线自动 skip，CI `bun run test:containers` 跑全量）。

**Goal:** 在现有租户级 descriptor 管理面（ADR-0016）之上，补出生产级闭环：**作者归属** → **草稿可变 / 发布出版本 / 回滚** → **上架到库 / 下架** → **库浏览（内容可见性分层）** → **安装到「我的智能体 / 我的技能」（ref 浮动 / 钉版，copy 留口子）** → **货架启用 / 禁用 / 移除** → **运行时按作者 / 货架 / 浮动指针解析（作者可跑草稿）** → **插件库安装可用工具集**；并补 **治理 admin** 写旁路。全部经 HTTP + `@cube-ai/agent-sdk-console` 暴露。

**Architecture:** 一句话依赖链——

```
contracts(wire schema 扩展)
  └→ engine migration V005(owner 列 + 可变草稿列 + 货架/上架/可用工具 三张新表)
       └→ engine descriptor BC
            ├ 版本模型改造(草稿可变 / 发布才出版本 / 版本列表 / 回滚)
            ├ owner 写控 + 治理 admin scope(仿 session-owner.ts)
            ├ listing 仓储/服务(上架·下架·共享版本指针)  ← library 读(分层投影)
            ├ shelf 仓储/服务(安装 ref·启用禁用·移除)
            └ available-tool 仓储/服务(插件库安装)
       └→ session 运行时解析投影(buildSnapshots / 新 RunnableAgentResolver)
            └ 作者跑草稿 + 安装 ref 浮动/钉版 → 冻结正确版本进 snapshot
  └→ /agent/console/* 控制器扩面(versions/rollback/list + my + library + plugins)
  └→ agent-sdk-console 扩面 + ai-center DOMAIN_PREFIX_MOUNTS 注册
```

**不做（v1，明确划界）：**
- **rule 不进货架 / 库**：rule 仅作为 agent 内部 `ruleRefs` 引用，保持 ADR-0016 的租户 CRUD；本轮不给 rule 加 owner/上架/安装（owner 列对三 kind 都加，但 rule 不暴露货架/库端点）。
- **copy（解耦复制）不实现**：只落 `copied_from` 列 + `source='copy'` 枚举位 + 端点 501 占位（D5 留口子）。
- **跨租户 / 全局库不实现**：listing 只在本租户可见；`scope` 字段先不落表（用 listing 行存在性 = tenant 域，见 OQ）。
- **配额硬限不实现**：只留校验 seam（默认放行），不接平台配置。
- **draft 预览运行**沿用「作者直接跑草稿」即可，不单独做 preview sandbox。
- **UI 不在本计划内**（ai-sdk-playground 单列里程碑 M8，可选/后置）。

---

## 全局不变量（实现时反复对照）

1. **tenant 仍是唯一隔离主键**；user 是 tenant 之下的子层（ADR-0029 模式）。所有新表查询都带 `tenant = subject.tenant`，再叠 `user_id`。id 不嵌租户。
2. **id 命名空间**：descriptor 沿用 `agt_/skl_/rul_`；货架行新增 `she_` 前缀；可用工具行用 `uat_`（仅内部 PK，不对外暴露语义）。裸 name（无前缀）永远指系统级资产。
3. **owner 写控**：`update / publish / rollback / 上架 / 下架` = owner 本人；`下架 / 软删` 额外允许 **治理 admin**（scope）。**admin 不得改草稿内容 / 不得发布**（D10）。
4. **草稿可变、发布才出版本**（D4）：`create/update` 覆盖写 `draft_content_json`，不进版本表；`publish` 才向 `tenant_descriptor_versions` 追加一条不可变版本。版本列表只列已发布版本。
5. **运行时可解析集合**（D1/D3/D5）：
   - 作者本人 → 可解析自己 descriptor 的**草稿**（无需发布）或指定已发布版本；
   - 非作者 → 必须在**货架**有 `enabled=1` 的安装条目，按 `ref` 的浮动/钉版解析到某个**已发布**版本；
   - 系统级（裸 name）→ 已发布只读，照旧。
   - 其他一律 404（不可解析）。
6. **内容可见性分层**（D9）：库里 **租户已上架** = 透明（返回已发布 content）；**系统预置** = 不透明（只返回 name/description/能力说明，绝不返回 prompt/instructions/凭据）。
7. **失效广播**：publish / 上架 / 下架 / 软删 → 写 outbox `descriptor_reload`（已通到 `PubSubDispatcher`），消费侧 `TenantDescriptorResolver.invalidate(tenant, id)`。货架/可用工具变更不需要广播（运行时只在会话创建时读，且作者草稿走 TTL/直读）。
8. **DI token** 用 `agentic.*` 命名空间（ADR-0015）；子包依赖写 `"catalog:"`（ADR-0016 §6 / AGENTS.md）。
9. **无 MySQL 仍可构造**：新仓储沿用 `TenantDescriptorRepositoryImpl` 的「pool 延迟校验」风格，不阻塞无库 dev 启动。

---

## 数据模型（migration V005）

> 文件：`packages/agent/engine/migrations/V005__my_agents_marketplace.sql`（下一个可用号；runner 见 `infra/mysql-migration/src/runner.ts`，V 文件 once、history 表 `engine_schema_migrations`）。DDL 风格对齐 `V002__tenant_descriptors.sql`（utf8mb4 / InnoDB / `tenant INT(10)` / `deleted BIGINT(20)` 软删 epoch ms / 审计四列 `*_by VARCHAR(64)` + `*_time DATETIME(3)`）。

### 1. 扩展 `tenant_descriptors`：owner 维度 + 可变草稿

```sql
ALTER TABLE tenant_descriptors
  ADD COLUMN owner_user_id      VARCHAR(64) NULL  COMMENT 'D2 作者 user；NULL=系统/迁移前遗留' AFTER name,
  ADD COLUMN draft_content_json JSON        NULL  COMMENT 'D4 可变草稿工作副本（保存即覆盖；发布才进 versions）' AFTER status,
  ADD COLUMN copied_from        VARCHAR(64) NULL  COMMENT 'D5 copy provenance 口子（本轮不写）' AFTER draft_content_json,
  ADD KEY idx_tenant_kind_owner (tenant, kind, owner_user_id, deleted);
```

**版本模型语义改造（D4，修订 ADR-0016 §4）**——列不删，只改写入语义：

| 列 | ADR-0016 旧义 | ADR-0030 新义 |
|---|---|---|
| `head_version_no` | 每次保存 +1，且每次保存都建版本行 | **草稿修订计数**（每次保存 +1，用于乐观并发 / 「草稿已变」展示）；**不再**与版本表一一对应 |
| `draft_content_json`（新） | — | 最近一次保存的**可变**草稿内容（authoring 视图读它） |
| `published_version_no` | 指向 versions 的已发布版本号 | 不变（NULL=从未发布） |
| `tenant_descriptor_versions` | append 每次保存 | **只在 publish 时 append**；`version_no` = 已发布序列（`published_version_no` 的取值域） |

**回填（V005 内联；ADR-0012-addendum 默认 fresh-start，下面是防御性兜底）：**

```sql
UPDATE tenant_descriptors td
  JOIN tenant_descriptor_versions v
    ON v.descriptor_id = td.id AND v.version_no = td.head_version_no
  SET td.draft_content_json = v.content_json
  WHERE td.draft_content_json IS NULL;
UPDATE tenant_descriptors SET owner_user_id = create_by WHERE owner_user_id IS NULL;
```
> ⚠️ Caveat：若已有历史数据且 `tenant_descriptor_versions` 混入了「草稿期版本」，新旧 `version_no` 序列语义不一致。生产切换前确认表为空或仅含已发布版本（见 OQ-V）。

### 2. `descriptor_listing`：上架记录 / 共享版本指针（D3 上架·D5 浮动）

```sql
CREATE TABLE IF NOT EXISTS descriptor_listing (
  descriptor_id     VARCHAR(36) NOT NULL COMMENT '引用 tenant_descriptors.id（agent/skill）',
  tenant            INT(10)     NOT NULL,
  listed            TINYINT(1)  NOT NULL DEFAULT 1 COMMENT '1=在库可发现/可安装；0=已下架',
  shared_version_no INT         NOT NULL COMMENT '浮动 ref 跟随的版本；下架后冻结为最后值',
  publisher_user_id VARCHAR(64) NOT NULL COMMENT '上架者=owner',
  listed_time       DATETIME(3) NULL,
  unlisted_time     DATETIME(3) NULL,
  create_by VARCHAR(64) NOT NULL, create_time DATETIME(3) NOT NULL,
  update_by VARCHAR(64) NOT NULL, update_time DATETIME(3) NOT NULL,
  PRIMARY KEY (descriptor_id),
  KEY idx_tenant_listed (tenant, listed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ADR-0030 上架记录 + 共享版本指针';
```
- **上架(`descriptor_id, versionNo`)**：owner only；`versionNo` 必须是已发布版本；upsert → `listed=1, shared_version_no=versionNo, listed_time=now`。
- **下架(`descriptor_id`)**：owner/admin；`listed=0, unlisted_time=now`，**保留** `shared_version_no`（→ 已安装浮动 ref 冻结在此，不破坏 B，对应「A 下架后不影响 B」）。
- 库浏览 = `listed=1` 行；安装只允许 `listed=1`。

### 3. `user_descriptor_shelf`：我的智能体 / 我的技能 货架（D1/D5/D6/D7）

```sql
CREATE TABLE IF NOT EXISTS user_descriptor_shelf (
  id             VARCHAR(36) NOT NULL COMMENT 'she_ + SFID',
  tenant         INT(10)     NOT NULL,
  user_id        VARCHAR(64) NOT NULL,
  target_kind    VARCHAR(16) NOT NULL COMMENT 'agent | skill',
  target_id      VARCHAR(64) NOT NULL COMMENT 'agt_/skl_（租户）或裸 name（系统级）',
  source         VARCHAR(16) NOT NULL DEFAULT 'ref' COMMENT 'authored | ref | copy',
  pin_version_no INT         NULL     COMMENT 'NULL=浮动；否则钉版（仅 source=ref 有意义）',
  enabled        TINYINT(1)  NOT NULL DEFAULT 1 COMMENT '用户级启用/禁用',
  deleted        BIGINT(20)  NOT NULL DEFAULT 0 COMMENT '移除=软删货架条目（不动 descriptor）',
  create_by VARCHAR(64) NOT NULL, create_time DATETIME(3) NOT NULL,
  update_by VARCHAR(64) NOT NULL, update_time DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_target (tenant, user_id, target_id, deleted),
  KEY idx_tenant_user_kind (tenant, user_id, target_kind, deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ADR-0030 我的智能体/我的技能 货架投影';
```
- **authored 条目**：作者 `create` descriptor 时**自动**插一条 `source='authored', pin_version_no=NULL`（D1 自动上架到本人货架）。
- **ref 条目**：从库安装时插入，`pin_version_no` NULL=浮动 / 非 NULL=钉版。
- **移除（D6）**：`deleted=now`，**不动** descriptor / listing。
- **启用/禁用（D1）**：`enabled` 翻转，纯用户级；运行时 `enabled=0` → 不可解析。

### 4. `user_available_tool`：插件库安装 / 可用工具集（D8）

```sql
CREATE TABLE IF NOT EXISTS user_available_tool (
  id        VARCHAR(36)  NOT NULL COMMENT 'uat_ + SFID',
  tenant    INT(10)      NOT NULL,
  user_id   VARCHAR(64)  NOT NULL,
  tool_name VARCHAR(255) NOT NULL COMMENT '系统/运维登记的工具名（裸 name）',
  enabled   TINYINT(1)   NOT NULL DEFAULT 1,
  deleted   BIGINT(20)   NOT NULL DEFAULT 0,
  create_by VARCHAR(64) NOT NULL, create_time DATETIME(3) NOT NULL,
  update_by VARCHAR(64) NOT NULL, update_time DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_tool (tenant, user_id, tool_name, deleted),
  KEY idx_tenant_user (tenant, user_id, deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ADR-0030 插件库安装/可用工具集（install-only）';
```
- 无 owner / 无版本 / 无 listing：插件库目录权威 = 系统 `DescriptorRegistryService`（tools）。
- 安装 = insert；启用/禁用 = `enabled`；移除 = `deleted=now`。
- **运行时鉴权不变**：工具实际调用仍走 ADR-0006 的 per-user consent/grant；本表只决定「这个工具是否出现在我可选/可编排的工具面板」。

---

## contracts wire schema 扩展

> 文件：`packages/contracts/src/descriptor/`。新增 `shelf.ts` / `library.ts` / `listing.ts`，并在 `tenant-descriptor.ts` 补字段；`index.ts` re-export。风格对齐现有 `tenant-descriptor.ts`（zod）。

### 1. `TenantDescriptorView` 补字段（`tenant-descriptor.ts`）

```ts
export const TenantDescriptorViewSchema = z.object({
  id: z.string(),
  kind: z.enum(['agent', 'skill', 'rule']),
  name: z.string(),
  ownerUserId: z.string().nullable(),          // D2：新增
  status: TenantDescriptorStatusSchema,
  headVersionNo: z.number().int(),             // 改义：草稿修订计数
  publishedVersionNo: z.number().int().nullable(),
  hasUnpublishedChanges: z.boolean(),          // D4：草稿是否领先于已发布
  content: z.unknown(),                        // authoring 视图=草稿内容
  createTime: z.number(),
  updateTime: z.number(),
});

/** 已发布版本历史条目（D4：只列已发布版本） */
export const DescriptorVersionSchema = z.object({
  versionNo: z.number().int(),
  createBy: z.string(),
  createTime: z.number(),
  // 列表默认不带 content（按需 GET 单版本）；diff/回滚预览时再取
  content: z.unknown().optional(),
});
```

### 2. 上架 / listing（`listing.ts`）

```ts
export const ListDescriptorRequestSchema = z.object({
  versionNo: z.number().int().positive(), // 必须是已发布版本（D3：发布≠上架，上架需选已发布版本）
});
export const DescriptorListingViewSchema = z.object({
  descriptorId: z.string(),
  listed: z.boolean(),
  sharedVersionNo: z.number().int(),
  publisherUserId: z.string(),
  listedTime: z.number().nullable(),
  unlistedTime: z.number().nullable(),
});
```

### 3. 库浏览（`library.ts`，内容可见性分层 D9）

```ts
export const LibrarySourceTier = z.enum(['tenant', 'system']);

/** 库条目：tenant 层带 content，system 层只给能力说明（不透明） */
export const LibraryItemViewSchema = z.object({
  // 安装用引用：tenant=agt_/skl_，system=裸 name
  ref: z.string(),
  kind: z.enum(['agent', 'skill']),
  tier: LibrarySourceTier,
  displayName: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // 仅 tier='tenant' 且已上架时存在；system 永远 undefined（D9 不透明）
  sharedVersionNo: z.number().int().optional(),
  content: z.unknown().optional(),
});
```

### 4. 安装 / 货架（`shelf.ts`，D1/D5/D6/D7）

```ts
export const ShelfSource = z.enum(['authored', 'ref', 'copy']);

export const InstallRequestSchema = z.object({
  ref: z.string(),                              // 库条目 ref（agt_/skl_/裸 name）
  mode: z.enum(['ref', 'copy']).default('ref'), // copy → 501（D5 口子）
  pin: z.boolean().default(false),              // true=钉版（钉到当前 sharedVersionNo）；false=浮动（默认，D5）
});

export const ShelfEntryViewSchema = z.object({
  id: z.string(),                               // she_
  targetKind: z.enum(['agent', 'skill']),
  targetId: z.string(),
  source: ShelfSource,
  pinVersionNo: z.number().int().nullable(),    // null=浮动
  enabled: z.boolean(),
  // 投影便利字段（join 自 descriptor/listing/registry）：
  displayName: z.string().optional(),
  effectiveVersionNo: z.number().int().nullable(), // 当前会解析到的版本（浮动=sharedVersionNo；钉版=pin；草稿=null）
  runnableStatus: z.enum(['runnable', 'disabled', 'unresolvable']),
});

export const ShelfPatchSchema = z.object({
  enabled: z.boolean().optional(),
  pin: z.boolean().optional(),                  // true→钉到当前 effective；false→转浮动
});
```

### 5. 可用工具（放 `library.ts` 或新 `tool-shelf.ts`，D8）

```ts
export const PluginCatalogItemViewSchema = z.object({
  toolName: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),  // 系统级=只给能力说明（D9 不透明）
  tags: z.array(z.string()).optional(),
  installed: z.boolean(),
});
export const AvailableToolViewSchema = z.object({
  toolName: z.string(),
  enabled: z.boolean(),
});
export const InstallToolRequestSchema = z.object({ toolName: z.string() });
```

---

## engine BC 设计

> 全部住 `packages/agent/engine/src/bc/descriptor/`（避免反向依赖）。仓储沿用「构造接受 `Pool | null`，方法内 `requirePool`」风格；服务沿用 `DescriptorManagementService` 风格；DI 仿 `descriptor-management.provider.ts` 加 `useFactory`。

### A. 版本模型改造（修订 `tenant-descriptor.repository.ts` + service）

`TenantDescriptorRepository` 接口调整 / 新增：

```ts
interface TenantDescriptorRepository {
  // 改义：upsert 写 draft_content_json（覆盖），bump head_version_no（草稿修订计数），不进 versions
  upsert(tenant, kind, name, content, actor, ownerUserId?): Promise<UpsertDescriptorResult>;
  // 改义：返回 content=draft_content_json，附 ownerUserId / hasUnpublishedChanges
  findById(tenant, id): Promise<TenantDescriptorView | null>;
  list(tenant, kind, opts?: { ownerUserId?: string }): Promise<TenantDescriptorView[]>;
  // 改义：把 draft_content_json append 成新版本行（version_no = max(published)+1），置 published_version_no
  publish(tenant, id, actor): Promise<TenantDescriptorView>;
  softDelete(tenant, id, actor): Promise<void>;
  resolvePublished(tenant, id): Promise<TenantDescriptorView | null>; // 不变（读 published 版本）

  // 新增（D4 版本历史 / 回滚 / 运行时按版本解析）
  listVersions(tenant, id): Promise<DescriptorVersion[]>;              // 只列已发布
  getVersionContent(tenant, id, versionNo): Promise<unknown | null>;  // 解析/diff/回滚预览
  rollback(tenant, id, versionNo, actor): Promise<TenantDescriptorView>; // 旧版内容→append 成新版本→置 published
  resolveDraft(tenant, id): Promise<TenantDescriptorView | null>;     // 作者跑草稿用
}
```

要点：
- `upsert`：`INSERT ... ON DUPLICATE`/事务里——新建时写 `owner_user_id=actor`、`draft_content_json=content`、`head_version_no=1`、`published_version_no=NULL`、`status='draft'`；已存在时覆盖 `draft_content_json`、`head_version_no+1`、`status='draft'`。**不再** insert 版本行。
- `publish`：事务里读 `draft_content_json` → `version_no=COALESCE(MAX published,0)+1` → insert `tenant_descriptor_versions` → `UPDATE published_version_no=version_no, status='published'`。
- `rollback(versionNo)`：读旧版本 content → 走 publish 同路径 append 成**新**版本（保留 append-only / 不改历史，D4），并把 `draft_content_json` 同步为该内容（编辑器即时一致）。
- `hasUnpublishedChanges` = `published_version_no IS NULL OR draft 与已发布版本内容不同`（实现可用 `head_version_no` 与「发布时记录的 head」比较；最省事：发布时把 `published_version_no` 对应版本同时记一份 `published_head_rev`，或直接比对 content hash —— 实现窗口择一，建议存 `published_at_head_rev INT`）。

> **写控落点**：owner 校验放 **service 层**（`DescriptorManagementService.update/publish/rollback` 先 `findById` 取 `ownerUserId`，与 `actor`/admin 比对），repository 保持纯数据访问。新增错误码复用 `PERMISSION_DENIED_*`（见 `agentic-error.ts` 闭集；若无合适项，加一个 `PERMISSION_DENIED_DESCRIPTOR_OWNER`）。

### B. 治理 admin scope（新 `descriptor-owner.ts`，仿 `session-owner.ts`）

```ts
import type { DualSubject } from '@cube-ai/contracts';
export const DESCRIPTOR_ADMIN_SCOPE = 'engine.descriptor.admin';
export function isDescriptorAdmin(s: DualSubject): boolean {
  return s.user.scopes.includes(DESCRIPTOR_ADMIN_SCOPE);
}
/** owner 本人或治理 admin（D10：admin 仅用于 下架/软删，不用于 edit/publish）。 */
export function assertOwnerOrAdmin(ownerUserId: string | null, userId: string, admin: boolean): void { ... }
export function assertOwner(ownerUserId: string | null, userId: string): void { ... } // edit/publish/rollback/上架
```

### C. listing 仓储 + service（上架/下架/库读）

- `DescriptorListingRepository`：`get(tenant,id)` / `list(tenant,id,versionNo,actor)`（upsert listed=1）/ `unlist(tenant,id,actor)` / `browseListed(tenant, kind)`（join descriptors 取 displayName/description + 已发布 content）。
- 库读分层（D9）：`LibraryService.browse(tenant, kind)` = `browseListed`（tier='tenant'，带 content）**∪** 系统预置（tier='system'，只 name/description）。系统预置来源：
  - agent：系统 agent 加载器（`descriptor-loader` / `DescriptorLoaderLike.getAgent`）——**只取 displayName/description**，丢弃 prompt 等。
  - skill：`SkillRegistryService.list()` → 只取 `name/description/displayName/tags`。
  - 绝不在 system tier 返回 `content`。
- 上架/下架后写 outbox `descriptor_reload`（payload `{tenant, descriptorId}`）。

### D. shelf 仓储 + service（安装/启用禁用/移除）

- `UserShelfRepository`：`listByUser(tenant,user,kind)` / `findByTarget(tenant,user,targetId)` / `insert(...)` / `patch(id, {enabled?,pin?})` / `softDelete(id)` / `upsertAuthored(tenant,user,descriptorId,kind)`（create 钩子）。
- `ShelfService.install(tenant, user, req)`：
  1. `mode='copy'` → `throw UNIMPLEMENTED`（501，D5 口子）。
  2. 解析 `ref`：裸 name=系统级（tier=system，只能 ref，禁 copy）；`agt_/skl_`=租户级，必须 `listing.listed=1`，否则 `FAILED_PRECONDITION`（未上架不可装）。
  3. 已存在未删条目 → 幂等返回 / `RESOURCE_CONFLICT`（择一，建议幂等）。
  4. `pin=true` → `pin_version_no = listing.sharedVersionNo`（系统级裸 name 无版本，pin 忽略=浮动）；`pin=false` → NULL。
  5. insert `source='ref', enabled=1`。
- `投影`：`ShelfEntryView.effectiveVersionNo / runnableStatus` 由 service join listing/descriptor 计算（见运行时解析同款逻辑）。
- **create descriptor 钩子**：`DescriptorManagementService.create` 成功后调用 `shelf.upsertAuthored(...)`（D1 自动上架到本人货架）。

### E. available-tool 仓储 + service（插件库）

- `UserAvailableToolRepository`：`listByUser` / `findByName` / `insert` / `patch(enabled)` / `softDelete`。
- `PluginCatalogService.catalog(tenant, user)` = `DescriptorRegistryService.listAll()` 投影成 `{toolName, displayName, description}`（**只能力说明**）+ join 用户 `installed` 标志。

### F. 运行时解析投影（核心，session 创建路径）

> 现状：`SessionService.createSession → buildSnapshots({ agentId, tenantResolver, descriptorLoader, ... })`；`agent_version_no` 当前**硬编码 1**（`session.service.ts`）。tenant agent 经 `TenantDescriptorResolver.getAgentRecord`（只 `resolvePublished`）。

改造目标：引入 **`RunnableAgentResolver`**（或扩展 `TenantDescriptorResolver` + 把 userId/isAdmin 传进 `buildSnapshots`），按 §不变量 5 决定**用哪一版内容 + 哪个 versionNo** 冻结进 snapshot：

```
resolveRunnableAgent(tenant, userId, agentRef, isAdmin, opts?: { versionNo? }):
  if 裸 name(无前缀):                      # 系统级
     return { content: descriptorLoader.getAgent(name), versionNo: 0(系统) }
  if agentRef 非 agt_ 前缀: 404
  head = descriptorRepo.headRow(tenant, agentRef)        # owner / published_version_no / draft
  if !head: 404
  if userId == head.owner_user_id || isAdmin:            # 作者(或admin)可跑草稿/指定版本 (D3)
     if opts.versionNo: return { getVersionContent(versionNo), versionNo }
     if head.draft 存在: return { draftContent, versionNo: 0 }   # 0=draft 哨兵
     if head.published_version_no: return { publishedContent, head.published_version_no }
     404
  # 非作者 → 必须装了且启用 (D5)
  shelf = shelfRepo.findByTarget(tenant, userId, agentRef)
  if !shelf or shelf.enabled==0 or shelf.deleted: 404
  listing = listingRepo.get(tenant, agentRef)
  effVer = shelf.pin_version_no ?? listing?.shared_version_no    # 钉版优先；否则浮动跟随 listing（下架已冻结）
  if !effVer: 404
  return { getVersionContent(tenant, agentRef, effVer), versionNo: effVer }
```

- `buildSnapshots` 用解析出的 content 走原有 skill/rule/tool 水合（`hydrateSnapshotSkills/Rules`）。**transitive refs（skillRefs/ruleRefs/availableTools）按会话创建时点解析到各自已发布 head 并冻结进 snapshot**——float/pin 只决定「agent 内容用哪版」，被引技能/规则的版本仍在创建时冻结（v1 取舍，见 OQ-T）。
- `session.service.ts`：`agentVersionNo: 1` 改为解析出的 `versionNo`（草稿=0 哨兵）。
- `SessionController.create` 已有 `subject`（`readSubject`）→ 把 `subject.user.userId` + `isSessionAdmin`（或新 `isDescriptorAdmin`）传进 `createSession`。
- **「我的技能」不改运行时**：agent 的 `skillRefs` 是内容里的显式引用，技能货架只是 authoring 期「可选技能索引 + 归属」，运行时不查货架。

### G. DI 装配

- 新仓储/服务各加 `useFactory` provider（仿 `descriptorManagementServiceProvider`，从 `MYSQL_POOL_TOKEN` 取 pool）。
- 在 `descriptor-management-http.module.ts`（或新 `my-agents.module.ts`）的 `providers/controllers` 注册新控制器与服务；`exports` 暴露给需要的装配点。
- `RunnableAgentResolver` 在 `makeSessionStack`（当前 `new TenantDescriptorResolver(...)` 处，session 装配）注入 shelf/listing/descriptor 仓储；并接进 `SessionService` 构造参数（新增可选依赖，无库时降级到「仅系统级 + 作者草稿不可用」）。

---

## HTTP 端点设计

> 全部控制器 `@Controller('')` + 在 `apps/ai-center/src/assembler/domain-prefix-mounts.ts` 的 `DOMAIN_PREFIX_MOUNTS` 注册 base，与现有 `DescriptorManagementController → /agent/console` 一致。鉴权统一 `readSubject(ctx)` → `tenant/userId/scopes`。SDK 默认前缀 `/agent/console`，故全部挂 `/agent/console/*` 保持前缀统一。

| 面 | 方法 + 路径（含 base） | 说明 | 写控 |
|---|---|---|---|
| 管理(扩展) | `GET /agent/console/agents/:id/versions` | 已发布版本列表（D4） | owner |
| 管理(扩展) | `GET /agent/console/agents/:id/versions/:no` | 单版本内容（diff/预览） | owner |
| 管理(扩展) | `POST /agent/console/agents/:id/rollback` `{versionNo}` | 回滚=旧版内容出新版本 | owner |
| 管理(扩展) | `POST /agent/console/agents/:id/list` `{versionNo}` | 上架到库 | owner |
| 管理(扩展) | `POST /agent/console/agents/:id/unlist` | 下架 | owner/admin |
| 管理(扩展) | `GET /agent/console/agents/:id/listing` | 上架状态 | owner |
| 货架 | `GET /agent/console/my/agents?enabled=&source=` | 我的智能体（含草稿/已装） | self |
| 货架 | `GET /agent/console/my/skills` | 我的技能 | self |
| 货架 | `POST /agent/console/my/agents` `InstallRequest` | 安装（ref 浮动/钉版；copy→501） | self |
| 货架 | `PATCH /agent/console/my/agents/:sheId` `ShelfPatch` | 启用/禁用 / 浮动↔钉版 | self |
| 货架 | `DELETE /agent/console/my/agents/:sheId` | 移除（软删货架条目，204） | self |
| 库 | `GET /agent/console/library/agents?q=&tier=` | 浏览（tenant 透明 + system 不透明） | self |
| 库 | `GET /agent/console/library/agents/:ref` | 详情（system 仅能力说明） | self |
| 库 | `GET /agent/console/library/skills` `/:ref` | 同上（skill） | self |
| 插件 | `GET /agent/console/plugins` | 插件库目录（只能力说明，含 installed） | self |
| 插件 | `GET /agent/console/my/tools` | 我的可用工具集 | self |
| 插件 | `POST /agent/console/my/tools` `{toolName}` | 安装工具 | self |
| 插件 | `PATCH /agent/console/my/tools/:toolName` `{enabled}` | 启用/禁用 | self |
| 插件 | `DELETE /agent/console/my/tools/:toolName` | 移除 | self |

> skill 货架/库端点与 agent 对称（`/my/skills`、`/library/skills`）。skill 不可独立运行，故无运行时解析端点；其安装只决定 authoring 期可见性。`source` 过滤让前端区分「我创作的（authored，可编辑/发布）」vs「已安装（ref）」。

控制器骨架（沿用现有 `requireCtx/readSubject/tenantOf/actorOf`）：

```ts
@Controller('') // mount: /agent/console/my
export class MyShelfController {
  constructor(private readonly shelf: ShelfService) {}
  @GET('/agents')  listAgents() { const ctx=requireCtx(); const s=readSubject(ctx);
    return this.shelf.list(s.tenant, s.user.userId, 'agent', queryOf(ctx)); }
  @POST('/agents') install() { /* InstallRequestSchema.parse → shelf.install */ }
  @PATCH('/agents/:sheId') patch() { /* ShelfPatchSchema */ }
  @DELETE('/agents/:sheId') remove() { /* 204 */ }
  // …/skills 对称；…/tools 走 ToolShelfService
}
```

---

## agent-sdk-console 扩面

> 文件：`packages/agent/sdk-console/src/client.ts`（+ 类型从 `@cube-ai/contracts` 复用），复用 `agentConsoleRequestJson`（`http.ts`）。默认 `pathPrefix='/agent/console'` 不变。仅加方法，不破坏既有 CRUD 签名。

```ts
// 版本/回滚/上架（管理面扩展）
listAgentVersions(id): Promise<DescriptorVersion[]>
getAgentVersion(id, no): Promise<{ content: unknown }>
rollbackAgent(id, versionNo): Promise<TenantDescriptorView>
listAgent(id, versionNo): Promise<DescriptorListingView>     // 上架
unlistAgent(id): Promise<DescriptorListingView>

// 我的智能体 / 技能（货架）
myAgents(opts?): Promise<ShelfEntryView[]>
mySkills(opts?): Promise<ShelfEntryView[]>
installAgent(req: InstallRequest): Promise<ShelfEntryView>
patchShelfAgent(sheId, patch: ShelfPatch): Promise<ShelfEntryView>
removeShelfAgent(sheId): Promise<void>

// 库（商城）
browseLibraryAgents(opts?): Promise<LibraryItemView[]>
getLibraryAgent(ref): Promise<LibraryItemView>
// …skill 对称

// 插件库 / 可用工具
pluginCatalog(): Promise<PluginCatalogItemView[]>
myTools(): Promise<AvailableToolView[]>
installTool(toolName): Promise<AvailableToolView>
patchTool(toolName, enabled): Promise<AvailableToolView>
removeTool(toolName): Promise<void>
```

---

## 里程碑（按依赖顺序；每步 `typecheck && bun test` 全绿）

| M | 标题 | 关键文件 | 退出条件 |
|---|---|---|---|
| **M1** | contracts wire schema | `contracts/src/descriptor/{tenant-descriptor,listing,library,shelf}.ts` + `index.ts` + `*.test.ts` | 新 schema parse/默认值单测绿；`TenantDescriptorView` 加 `ownerUserId/hasUnpublishedChanges` |
| **M2** | migration V005 | `engine/migrations/V005__my_agents_marketplace.sql` | testcontainers：起库跑迁移 → 四处 DDL（1 ALTER + 3 CREATE）成功、幂等可重入 |
| **M3** | 版本模型改造 + owner 写控 + admin scope | `tenant-descriptor.repository.ts` / `descriptor-management.service.ts` / 新 `descriptor-owner.ts` / 改 controller 增 versions/rollback | 草稿覆盖写不增版本、publish 才出版本、rollback、listVersions 单测绿；owner/admin 写控单测绿；既有 descriptor 测试改绿 |
| **M4** | listing + library（分层投影） | 新 `descriptor-listing.repository.ts` / `listing.service.ts` / `library.service.ts` / `LibraryController` + 管理面 list/unlist | 上架需已发布版本、下架冻结 sharedVersion、库 system tier 不返回 content —— 单测 + 1 个 testcontainers 端到端 |
| **M5** | shelf（安装/启用禁用/移除）+ create 自动上架 | 新 `user-shelf.repository.ts` / `shelf.service.ts` / `MyShelfController` + create 钩子 | 浮动/钉版安装、enable/disable、移除不动 descriptor、authored 自动入架 —— 单测绿 |
| **M6** | 运行时解析投影 | 新 `runnable-agent-resolver.ts` / 改 `session.service.ts`(agentVersionNo) / `buildSnapshots` 入参 / `SessionController.create` | 作者跑草稿、非作者必须装且启用、浮动跟随/下架冻结/钉版固定 —— testcontainers 会话创建端到端绿；`agent_version_no` 落实际版本 |
| **M7** | 插件库 + 可用工具 + outbox 失效接线 | 新 `user-available-tool.repository.ts` / `plugin-catalog.service.ts` / `ToolShelfController` + publish/list/unlist/softDelete 写 `descriptor_reload` | 工具目录只给能力说明、安装/启停/移除、resolver 收到 reload 精确失效 —— 单测 + testcontainers |
| **M8** | SDK 扩面（+ 可选 ai-sdk-playground UI） | `sdk-console/src/client.ts`(+test) / `domain-prefix-mounts.ts` 注册新控制器 / `sdk-console` `index.ts` | SDK 方法单测（mock fetch）绿；mounts 注册全；`bun run build` 绿。UI 可后置 |

> M2/M4/M6/M7 的 DB 行为务必落 `*.testcontainers.test.ts`；离线 `bun test` 自动 skip，提交前本地 `bun run test:containers` 至少跑一次相关用例。

---

## 测试与验收约定

**单元（离线 `bun test`）：**
- contracts：schema 默认值 / 拒绝非法（M1）。
- repository（可用 fake pool 或 testcontainers）：版本模型不变量（草稿覆盖、publish append、rollback append-only、listVersions 只列已发布）。
- service：owner 写控矩阵（owner✓ / 他人✗ / admin 仅 unlist+softDelete✓ edit/publish✗）。
- resolver：解析决策表（系统/作者草稿/作者指定版本/非作者未装→404/已装禁用→404/浮动/钉版/下架冻结）——纯函数化，table-driven。

**集成（`*.testcontainers.test.ts`，`bun run test:containers`）：**
- 端到端：作者 create→（自动入架，可跑草稿）→publish→上架→他人 library 见→install(浮动)→他人创建会话解析到 sharedVersion→作者发新版+改上架版本→他人**新**会话跟随新版（浮动）→作者下架→他人仍可跑（冻结）→钉版安装者不受发新版影响。
- 可见性：system tier 库条目 / 插件目录响应**不含** prompt/instructions/凭据字段（断言字段缺失）。
- admin：带 `engine.descriptor.admin` scope 可 unlist/softDelete 他人 descriptor；无 scope 403。

**完成判据：** `bun run typecheck && bun test` 全绿；相关 testcontainers 用例 `bun run test:containers` 绿；`bun run build` 绿（SDK 扩面不破坏浏览器包）。

---

## 风险 / Open Questions（实现中遇到再定，别提前过设计）

- **OQ-V（版本序列回填）**：若 `tenant_descriptor_versions` 已含草稿期版本，新旧 `version_no` 语义冲突。默认按 ADR-0012-addendum fresh-start 处理；若有数据需先清洗/对账（切换前在 cutover-runbook 增一步）。
- **OQ-T（transitive ref 版本跟随）**：v1 被引技能/规则在会话创建时冻结到各自已发布 head；若上游希望「钉版 agent 的被引技能也钉版」，需在 agent content 里携带子引用版本号 + resolver 透传——留作后续。
- **`agent_version_no=0` 哨兵**：表示「跑的是草稿」。回放/审计读 snapshot content 即可，不依赖该号；如审计要区分草稿来源，可在 snapshot 里补 `sourceVersion: 'draft'|number`。
- **幂等 vs 冲突**：重复 install / 重复 enable 采「幂等返回当前态」（建议），减少前端处理。
- **错误码**：若 `agentic-error.ts` 闭集缺 owner/未上架/未安装 语义，新增需走 ADR-0015 流程（保持闭集），不要散落裸 throw。
- **scope 发放**：`engine.descriptor.admin` 同 `engine.session.admin` 由平台侧（ghcloud adapter）签发，engine 只读 `subject.user.scopes`（ADR-0029 模式），本计划不实现签发侧。

---

## 交接提示（给实现窗口）

1. 先读三篇 ADR + CONTEXT 对应段；本文「全局不变量」「数据模型」「运行时解析投影」是落地骨架，逐条对照。
2. 严格按 M1→M8 顺序，**每个里程碑独立可提交**（绿灯门槛见上表），便于拆 PR / review。
3. 改 `tenant-descriptor.repository.ts` 版本语义时，先跑既有 `descriptor-management.service.test.ts` / `tenant-descriptor-resolver.test.ts` 看红，再按 D4 改测试——别静默改契约。
4. 新表/新端点都带 `tenant` + `user_id` 双过滤；owner/admin 写控走 service 层 `descriptor-owner.ts` 助手，别在 controller 里散落判断。
5. 失效广播复用 outbox `descriptor_reload`（`OUTBOX_CHANNELS` 已含、`PubSubDispatcher` 已通）；只在 publish/list/unlist/softDelete 写，货架/工具变更不写。
