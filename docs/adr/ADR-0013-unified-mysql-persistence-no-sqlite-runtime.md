# ADR-0013: 领域关系型持久化统一 MySQL —— 绝对禁止 SQLite

- **Status**: Accepted
- **Date**: 2026-06-09（2026-06-09 修订：测试夹具例外废止，绝对禁止）
- **Deciders**: 架构组（prebuilt 启动修复后用户裁决；对齐 llm-catalog 已落 MySQL 的先例）
- **Tags**: persistence, mysql, sqlite, flow, kb, llm-catalog, agent-engine, deployment, prebuilt, testing

## Context

ADR-0009 已定运行时拓扑：单进程 `ai-center` + compose 编排 **MySQL / Redis / Qdrant** 等有状态中间件。ADR-0005 假定 kb 检索叠 **MySQL 词法**（BM25 / `recall_count` 等）——元数据与 chunk 行级数据本就在 MySQL（源仓 `@Entity` 四表：`document_record` / `document_directory_record` / `document_import_job` / `document_chunk`）。

迁移期却残留多条 **SQLite 旁路**，与 ghcloud / cube-ai 生产形态（MySQL）及 ADR-0009 拓扑不一致：

| 领域 | 源仓权威 | 迁移期现状（2026-06-09 前） | 问题 |
|---|---|---|---|
| **llm-catalog** | MySQL `llm_catalog_*` | 曾 warm-load 独立 SQLite 文件 | 多数据源、无写回、与 ghcloud 不对齐 → **已改 MySQL 并删 `sqlite-catalog.store`** |
| **flow** | MySQL（`02-flow.sql`） | `CUBE_LOCAL_DEV=1` 或 prebuilt 下 `@dangao/bun-server` 动态 `createRequire('mysql2/promise')` 失败时回退 SQLite | prebuilt/compose 不应走 SQLite；flow 已改 **静态 `mysql2/promise` 适配器** |
| **kb** | MySQL（四表 ORM） | `KbDatabaseBootstrap` 执行 `KB_SQLITE_SCHEMA`；prebuilt compose 设 `KB_LOCAL_DEV=1` + 本地 `kb.sqlite` | **与 flow/engine/catalog 同栈分裂**；README 误将此描述为「合理例外」 |

engine（agent-engine）与 llm-catalog **早已只认 MySQL**（`AGENTIC_ENGINE_MYSQL_URL` / `MYSQL_POOL_TOKEN` → 库 `cube_ai_center`）。flow 在 compose / prebuilt 下也已强制 MySQL。**kb 单独 SQLite 无架构依据**——仅是 bootstrap 尚未提供 MySQL DDL + 静态 mysql2 路径的过渡债。

源仓与迁移期代码中仍有 **`bun:sqlite` / `KB_SQLITE_SCHEMA` / `flow/db/sqlite.ts` / `CUBE_LOCAL_DEV` / `applyAiCenterTestEnv(*.sqlite)`** 等路径。早期 ADR-0013 草案曾允许测试夹具使用 SQLite——**用户裁决废止该例外**：SQLite 在本仓 **无任何合法用途**，测试与 runtime 均须遵守。

## Decision

### D1 — 单一关系型真源：MySQL `cube_ai_center`

- **flow / kb / llm-catalog / engine 会话·作业等关系型数据** 一律持久化在 **同一 MySQL 实例、同一逻辑库 `cube_ai_center`**（表前缀 / 命名空间区分域，见 `deploy/docker-compose/mysql/init/*.sql`）。
- **禁止** 为任一领域配置 SQLite 文件路径、内存 SQLite、或 `bun:sqlite` / `better-sqlite3` 等 SQLite 驱动作为关系型数据源——**无论 runtime、本地开发、CI、单元测试、集成测试**。
- Qdrant / Redis / 对象存储 仍按 ADR-0005 / ADR-0009 各自独立；本 ADR 只约束 **关系型元数据**。

### D2 — 绝对禁止 SQLite（无例外）

**本仓任何代码路径、任何环境、任何测试**，均 **不得** 使用 SQLite 作为关系型持久化（含 `:memory:` 与临时文件）。

具体禁令（非穷举）：

1. **不得** 引入、保留或调用 `bun:sqlite`、`Database` from `bun:sqlite`、`KB_SQLITE_SCHEMA`、`flow/db/sqlite.ts` 及一切 SQLite repository / bootstrap。
2. **不得** 使用环境变量 `CUBE_LOCAL_DEV`、`KB_LOCAL_DEV`、`CUBE_AI_SQLITE_PATH`、`KB_SQLITE_PATH` 或任何等价 flag 切换 SQLite。
3. **不得** 在 compose / prebuilt / 生产 / 本地开发 / CI 中为 kb 或 flow 挂载 `*.sqlite` 卷或路径。
4. flow / kb 访问 MySQL 时 **须** 静态 import `mysql2/promise`（与 flow prebuilt 修复一致）；**禁止** 因 `@dangao/bun-server` 动态 `createRequire` 失败而回退 SQLite——回退是缺陷，不是策略。
5. kb bootstrap **须** 提供 MySQL DDL（`mysql/init/04-kb.sql`，与 ORM 实体对齐）；**删除** `KB_SQLITE_SCHEMA` 及所有 SQLite bootstrap 代码。
6. flow **须** 删除 `config.localDev → sqlite` 分支及 `flow/db/sqlite.ts` 运行时/测试引用；MySQL repository 为唯一实现。
7. **测试**：需要真实 DB 时 **必须** 使用 MySQL（Testcontainers / compose deps / 共享 test-infra）；不需要真实 DB 时 **必须** mock `DatabaseService` / repository 替身——**禁止** SQLite 夹具（含 `applyAiCenterTestEnv(temp.sqlite)` 模式）。

### D3 — 与 llm-catalog 判例一致

llm-catalog 从 SQLite warm-load 迁 MySQL 的动因（单库、写回可见、多实例一致、对齐 ghcloud）**同样适用于 kb 与 flow**。catalog 已执行；kb / flow SQLite 残留为 **待偿还技术债**，须按本 ADR 清除。

### D4 — 合规验收

以下任一出现即 **违反本 ADR**：

- 源码中 `bun:sqlite` / `KB_SQLITE_SCHEMA` / `sqlitePath` 用于关系型持久化（mock 类型名含 sqlite 但无真实 SQLite 连接除外，且应尽快 rename）
- compose / env 示例中出现 `*_SQLITE_*` 或 `CUBE_LOCAL_DEV` 指向 SQLite
- 测试依赖临时 `.sqlite` 文件或 `:memory:`

## Consequences

- **Positive**：全仓 **单一关系型真源**；runtime / 测试 / 生产行为一致；消除第二持久化栈带来的语义漂移（类型、时区、DDL 方言）；对齐 ADR-0005 检索中 MySQL 词法路径。
- **Negative**：须补 kb MySQL DDL + 静态 mysql2 bootstrap；flow/kb/ai-center **大量测试** 须迁 Testcontainers MySQL 或 mock；删除 SQLite 代码前 prebuilt 若仍挂 `KB_LOCAL_DEV` 则 **显式违规**，须优先偿还。
- **Neutral**：CI 须保证 deps MySQL 可用（已有 `test:containers` / compose profile 可复用）；`packages/flow/core` 等包内 `*.test.ts` 迁完前可暂红，但 **不得新增** SQLite 用法。

## Options Considered

- **prebuilt 下仅 kb 继续 SQLite**（2026-06-09 临时 workaround）：改动最小，但固化第二关系型真源。**否**。
- **测试允许 SQLite 夹具**（ADR-0013 初稿 D3）：降低测试成本，但允许第二 DDL 方言与生产分叉，且易回渗 runtime。**否**——用户裁决绝对禁止。
- **kb 独立 MySQL 库 / 实例**：与 engine/flow/catalog 同库惯例冲突。**否**（除非未来有独立扩展 seam）。
- **全局 `CUBE_LOCAL_DEV` 让 flow+kb 一起 SQLite**：与 ghcloud 生产不对齐。**否**。
- **保留 bun-server 动态 mysql2，失败则 SQLite fallback**：掩盖 compiled binary 缺陷。**否**——修适配器，不回退。

## Open Questions

- kb MySQL DDL 与 ghcloud 存量 `document_*` 数据的 **cutover / 双写** 窗口（ADR-0010 总切换的子项）——DDL 落地后另开 migration runbook 条目。
- flow/kb 测试迁 MySQL testcontainers 的 **批次顺序**（flow-core 212 测 / kb-core 117 测 / ai-center 路由测）——本 ADR 不排期，但禁止新增 SQLite 债务。

## References

- ADR-0004（flow 收编；源仓双库——**本 ADR 废止 SQLite 分支**）
- ADR-0005（kb 检索叠 MySQL 词法）
- ADR-0009（compose MySQL 中间件）
- ADR-0010（有状态数据迁移总议题）
- 迁移勘察 `docs/migration/inventory/kb.md §8`（kb 四表 MySQL 权威；已随迁移收尾移除，git 历史可溯）
- `deploy/docker-compose/mysql/init/` — engine / flow / llm-catalog DDL；kb 待增

## Supersedes / Clarifies

- **废止** ADR-0004 Context「flow **双库**：sqlite + mysql」中的 SQLite 分支——本仓 **仅 MySQL**；源仓 sqlite 代码为迁移待删债务，非可选后端。
- **废止** `deploy/docker-compose/README.md` 中「prebuilt 下只对 KB 使用本地 SQLite」及一切 SQLite 目标态描述。
- **废止** 迁移文档中「localDev SQLite 单路径」作为合法开发模式（如 PROGRESS M4.T9）——以本 ADR 为准，须改文档跟进。
