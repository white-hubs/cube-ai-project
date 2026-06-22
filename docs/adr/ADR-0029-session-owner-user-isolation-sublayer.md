# ADR-0029: 会话归属（session owner）—— tenant 之下的用户级隔离子层（session 锚定资源）

- **Status**: Accepted
- **Date**: 2026-06-18
- **Parent / Amends**: [ADR-0012 Addendum — tenant 单一隔离主键](./ADR-0012-addendum-tenant-single-isolation-no-project.md)（收紧其 D1「唯一隔离主键」措辞）
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛；隔离语义 / 范围 / admin 旁路由用户裁决）
- **Tags**: identity, tenant, user, session, authz, isolation
- **Extended by**: [ADR-0030](./ADR-0030-my-agents-library-and-marketplace-shelf-projection.md)（把「user 是 tenant 之下子层」模式从 session 锚定资源扩展到 descriptor 货架 / 作者归属 / 治理 admin）

## Context

ADR-0012-addendum D1 宣告「系统**唯一隔离主键 = tenant**」。但代码现状与该措辞存在张力：

- `sessions` 表早有 `user_id VARCHAR(64) NOT NULL`，`createSession(tenant, userId, …)` 始终落库 owner。
- `GET /sessions`（`listByOwner(tenant, userId)`）与 `GET /sessions/:id/messages`（`existing.userId !== userId → 404`）**已按 owner 过滤**。
- 但 `GET/PATCH/DELETE /sessions/:id` 仅按 tenant（`findById(tenant, id)` 不带 `user_id`；`deleteSession` 的 `userId` 只是审计 actor）。→ **列表看不到别人的，但拿到 id 即可读/改/删同租户任何人的会话。**
- dev/mock 模式 `userId` 在缺真实 token 时塌缩为常量 `'mock-user'`（`MockOboService.fakeSubject`），全租户共用一个 owner → **UI 历史会话「看起来是租户级」的根因**。
- `CONTEXT.md` 词条 + 全部 ADR + backlog 对 user/owner **零定义**——这是个游离、半实现、未进入领域语言的概念。

需要一次明确裁决：user 究竟是**安全隔离边界**，还是仅**可见性过滤**？以及其**范围**、**admin 旁路**、**执行方式**。

## Decision

### D1 — user 是 tenant 之下的隔离子层（语义 = 隔离，非仅可见性）

session 及其**派生资源**归属于创建它的 user（身份取自 `subject.user.userId`，即 OAuth2 `user_name`/`sub`）。**同租户内跨 user 访问 session 锚定资源即越权**，不是「产品上默认不展示」。tenant 仍是贯穿三域的**主隔离键**；user 是其下、**仅作用于 session 锚定资源**的第二隔离层。

### D2 — 范围 = session 锚定（不外溢跨域、不复活 project）

- 一致按 owner：`sessions`（list + get + patch + delete）+ `messages`。
- 派生资源随 session 归属：经某 session 的 jobs / files / memory，按其 session 的 owner 判定（不各自独立存 owner）。
- **独立按 id 访问的非 session 锚定资源**（裸 `GET /jobs/:id`）本轮**仍为 tenant 级**，留待后续按需收紧。
- `grants` 本就 per-user（ADR-0011 user-grant-model，`subject_user_id` + `subjectMatches`），不变。
- 能力包 `kb-core` / `flow-core` / `llm-core` **不引入 user 隔离**——user 不是跨域隔离键。

### D3 — 管理员旁路（仅读）

带 admin 标记的 principal 可**读**本租户全部会话：`listSessions` 不按 owner 过滤、`getSession` / `listSessionMessages` 放行。**写操作（PATCH/DELETE）的 admin 旁路本轮不开**，另议（避免管理员误删他人会话的半成品授权）。

### D4 — admin 信号 = scope 驱动

admin = `subject.user.scopes` 含管理权限 scope（约定 `engine.session.admin`）。**`DualSubject` 结构不改**，复用现有 scopes 通道；依赖平台签发 token 时携带该 scope。引擎 introspection 路径当前不携 `Principal.admin`，故不走 ghcloud JWT 的 admin 字段。

### D5 — 执行下沉仓储 + 越权 404

- 新增 owner 感知读取入口 `SessionRepository.findByIdAsOwner(tenant, id, userId, { admin })`：非 admin 时 SQL `WHERE id=? AND tenant=? AND user_id=?`；admin 时退化为 tenant-only。
- **保留**现有 tenant-only `findById(tenant, id)` 给**引擎内部系统流程**（turn 处理 / session GC / outbox 投影），这些无「操作用户」语境，不受 owner 检查影响。
- user-facing `getSession` / `patchSession` / `deleteSession` / `listSessionMessages` 改走 owner 入口；越权统一返回 **404 `RESOURCE_NOT_FOUND_SESSION`**（不泄露存在性，与现有 list/messages 口径一致），非 403。
- `listSessions({ tenant, userId, admin })`：admin → 列本租户全部；否则 `listByOwner`。

### D6 — fresh-start + 补索引 + mock 收口

- `user_id` 列已存在，**无列级 schema 迁移**（对齐 ADR-0012-addendum D4 fresh-start）。
- 新增 `V004` migration 补 `KEY idx_tenant_user_active (tenant, user_id, last_active_time, deleted)`——当前 `sessions` 仅 `idx_tenant_deleted`，`listByOwner` 走不到好索引。
- 生产 introspection 路径已对缺失 userId 硬失败（401），保持；mock 的 `'mock-user'` 共享兜底**严格 dev-only**，确保 mock introspection 不能在 production 启用（env 门控 fail-fast）。

## Consequences

- **Positive**：隔离语义明确且五个入口同口径；UI 拿到真用户级历史会话；`listByOwner` 索引补齐；admin 读旁路留口；与既有 owner 代码（list/messages/grants）顺接，改动面小。
- **Negative**：收紧 ADR-0012-addendum D1「唯一隔离主键」措辞（tenant 降为「主隔离键」+ session 锚定 user 子层）；新增对平台下发 `engine.session.admin` scope 的依赖；写操作 admin 旁路留缺口待补；dev mock 共享 `'mock-user'` 仍是脚枪，仅靠 dev-only 约束兜底。
- **Neutral**：派生资源经 session owner 间接判定，非各自存 owner；裸 `/jobs/:id` 暂 tenant 级；`messages` 表无 `user_id`，owner 经 `findByIdAsOwner` 取 session 判定。

## Options Considered

- **S1 仅可见性过滤**（list/messages 按 owner，但 get/patch/delete 仍 tenant，跨 user 不算越权）：最低改动，但拿到 id 即可跨用户读写——不满足「user 是安全边界」。否。
- **S2 全量用户级**（所有用户资源含裸 `/jobs/:id`、files 独立访问一次性按 owner）：一步到位，但超出当下需求、改动面大、jobs/files 各自需接 owner 与 admin 旁路。缓。
- **S3 session 锚定隔离 + admin 读旁路 + scope 信号 + 仓储 404（本 ADR）**：语义清晰、范围可控、与现有 owner 代码顺接。是。

## Open Questions

- 写操作（PATCH/DELETE）是否需要 admin 旁路？（D3 暂不开）
- 裸 `GET /jobs/:id` 等非 session 锚定资源何时收紧到 owner？（D2 暂 tenant 级）
- 平台 token 携带 `engine.session.admin` scope 的发放与口径由谁定义？（D4 依赖平台）

## References

- [ADR-0012-addendum](./ADR-0012-addendum-tenant-single-isolation-no-project.md) — 被本 ADR 收紧的「唯一隔离主键」
- [ADR-0012](./ADR-0012-runtime-single-source-and-three-domain-topology.md) — host 身份权威、三域平级
- [ADR-0011 user-grant-model] — grants 既有 per-user 语义（代码注释引用，未在本索引建档）
- `CONTEXT.md` — 词条「会话归属 (session owner)」「租户隔离主键 (tenant)」
