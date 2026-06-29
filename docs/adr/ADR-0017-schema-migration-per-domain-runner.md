# ADR-0017: Schema Migration —— 域自持 migrations/ + 独立 history 表 + 共享 infra runner，ai-center 启动时协调

- **Status**: Accepted
- **Date**: 2026-06-12
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: mysql, migration, schema, infra, deploy

## Context

现状：`deploy/docker-compose/mysql/init/*.sql` 是 5 个域的全量 DDL + seed，仅靠 MySQL docker-entrypoint 在首次建卷时自动执行。线上（非 compose）须手工 `mysql < *.sql` 按顺序跑，存在三类痛点：

1. **首次初始化**：5 个文件顺序、字符集容易出错（今日已修复字符集问题）
2. **Schema 演进**：无 migration history 表，不知道线上实例跑到哪个版本，`ALTER TABLE` 无法安全自动化
3. **Seed 数据**：系统级 `INSERT INTO` 混在 DDL 里，无幂等重跑机制

部署模型：手工 `docker compose pull && up`，无 CI/CD 流水线。后续可能按域拆微服务。

## Decision

### 1. 文件分类（V / S 两轨）

- `V{NNN}__{description}.sql`：DDL schema 变更，不可重跑，runner 按版本号顺序执行一次后记录
- `S{NNN}__{description}.sql`：Seed 数据，必须幂等（`INSERT ... ON DUPLICATE KEY UPDATE` / `INSERT IGNORE`），可重跑；runner 每次启动都重跑

### 2. 文件位置：域自持

每个能力包自己维护 `migrations/` 目录：

```
packages/agent/engine/migrations/
packages/flow/core/migrations/
packages/llm/core/migrations/
packages/kb/core/migrations/       ← 已有 001_kb_core_schema.sql，迁入
packages/flow/studio/migrations/
```

`deploy/docker-compose/mysql/init/` 精简为仅保留建库脚本（`CREATE DATABASE IF NOT EXISTS cube_ai_center; SET NAMES utf8mb4;`），不再承载 DDL/seed。

### 3. History 表：每域独立

每个域各有一张 `{domain}_schema_migrations(version VARCHAR(16), applied_at DATETIME)`，互不干扰。拆服务时该域带走自己的表和 runner，无需切分共享表。

### 4. 共享 runner：`infra/mysql-migration/`

与 `infra/test-infra`、`infra/vector-qdrant` 平级的纯工具包，导出 `createMigrationRunner(opts)`：

```ts
interface MigrationRunnerOpts {
  mysqlUrl: string;
  migrationsDir: string; // 绝对路径，指向域内 migrations/
  historyTable: string; // e.g. 'engine_schema_migrations'
}
```

runner 逻辑：

1. `CREATE TABLE IF NOT EXISTS {historyTable}` 确保 history 表存在
2. 扫 `migrationsDir` 下 `V*.sql` 按版本号排序，跳过已记录的，顺序执行，写入 history
3. 扫 `S*.sql` 按版本号排序，每次全量重跑（幂等）
4. 所有操作在独立连接中执行，单文件出错即抛出阻断启动

### 5. 协调者：`apps/ai-center/src/bootstrap.ts`

启动时按固定顺序调各域 runner（顺序保证跨域外键/依赖）：

```
engine → flow → llm-catalog → kb → flow-studio
```

runner 串行执行，全部通过后才启动 HTTP server。

### 6. 现有文件迁移

| 原文件                             | 迁移目标                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `mysql/init/01-agentic-engine.sql` | `packages/agent/engine/migrations/V001__init.sql`                                 |
| `mysql/init/02-flow.sql`           | `packages/flow/core/migrations/V001__init.sql`                                    |
| `mysql/init/03-llm-catalog.sql`    | `packages/llm/core/migrations/V001__init.sql` + `S001__system_seed.sql`           |
| `mysql/init/04-kb.sql`             | `packages/kb/core/migrations/V001__init.sql`（替换现有 `001_kb_core_schema.sql`） |
| `mysql/init/05-flow-studio.sql`    | `packages/flow/studio/migrations/V001__init.sql`                                  |

> **Seed 内容补充（2026-06-22）**：llm-catalog 域的 S 类不止 `S001__system_seed.sql`（10 个通用兜底模型 + providers/types）。系统全量 vendor 目录已落为同域 S 类启动 seed——`S002__seed_aliyun_bailian_models.sql`（37）、`S003__seed_volcengine_ark_models.sql`（41）、`S004__seed_geekai_models.sql`（666）——合计 **754** 个系统模型，随启动幂等灌入（数据源为 cube-services 旧 `seed_*.sql`，逐字节迁入）。因此 cutover 不再迁移系统目录四表（`ai_system_llm_*`），详见 [cutover-runbook §3](../operations/cutover-runbook.md)。

## Consequences

**正面**

- 线上初始化与演进统一为一个命令（`docker compose up`），无手工干预
- 每域 migration 状态完全自包含，拆服务时零改动
- V/S 分轨解决 seed 幂等问题
- 无外部 Java/Go 依赖，Bun + mysql2 原生

**负面 / 权衡**

- 需实现约 80 行 `infra/mysql-migration/` runner（一次性）
- 需迁移 5 个 init SQL 文件到各域 `migrations/`（一次性）
- 全新环境首次 `docker compose up` 时 runner 会跑 V001（等价于原 init SQL），稍慢于直接 entrypoint 执行，但可接受
- `S*.sql` 每次启动重跑：要求 seed 文件严格幂等，否则启动失败——写 seed 时必须遵守

## Options Considered

| 方案                                           | 排除原因                                      |
| ---------------------------------------------- | --------------------------------------------- |
| Flyway / Liquibase                             | 需 Java 镜像或 Docker sidecar，compose 复杂化 |
| golang-migrate                                 | 外部 Go 二进制，脱离 Bun 生态                 |
| Umzug                                          | 可用，但自写 runner 更轻量且无新增依赖        |
| 集中 `deploy/docker-compose/mysql/migrations/` | 绑死中心，拆服务时要手工切分文件              |
| 共享单张 `schema_migrations` 表                | 拆服务时要切分行，域边界不清晰                |
