# Cutover Runbook — ghcloud → ai-center 单 origin

> 生产切换/回滚操作手册：身份切换 + catalog 数据迁移 + 灰度/回滚步骤。生产 cutover 待运维窗口执行（见 [docs/backlog.md](../backlog.md)）。

## 1. 前置条件

| 项                | 验收                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仓库基线绿        | `bun run typecheck` + `bun test`                                                                                                                                     |
| ai-center 单进程  | `/health` 200；agent/flow/kb/llm 路由可达                                                                                                                            |
| 鉴权中心 JWT 公钥 | `JWT_KEY_URL` 可达（例：`http://<oauth-host>/oauth2/jwt.key`）                                                                                                       |
| catalog 迁移导出  | ghcloud `cube_base_ai_application` **租户两表**（`ai_application_tenant_llm_provider/model`，含凭据）JSON/SQL 导出就绪；系统目录四表已随启动 seed（见 §3），无需导出 |

## 2. 身份切换（host 注入）

### 2.1 开发/预发验证

> **WS3 之后（默认启用）：** 无需再设 `USE_GHCLOUD_IDENTITY=1`；只需配 `JWT_KEY_URL` 即可启用 ghcloud 身份。
> 本地开发/测试无 JWT 服务时，设 `USE_GHCLOUD_IDENTITY=0` 退回 mock 身份。

```bash
export JWT_KEY_URL=http://<oauth-host>/oauth2/jwt.key
# 请求须带 Authorization: Bearer <JWT> + tenant: <tenantId>
bun run --filter @cube-ai/ai-center dev
```

中间件链（与 ai-server 对齐）：

1. `createSessionContextMiddleware` — 解析 `tenant`/`authorization` 等 header
2. `createJwtAuthMiddleware` — RS256 验签（公钥来自 `JWT_KEY_URL`）
3. `createTenantValidationMiddleware` — header `tenant` ∈ JWT `tenants[]`
4. `createExecutionAuthMiddleware` — `createGhcloudAccessTokenReader` 映射 principal → `AccessTokenRecord`；`projectLookup` **仍用 flow**

`isSuperAdmin` 等价：JWT payload `admin=true` → `bypassProjectIsolation`（与 ghcloud principal.admin 一致）。

### 2.2 回滚（身份）

```bash
export USE_GHCLOUD_IDENTITY=0
# 重启 ai-center → 恢复 flow opaque token（createFlowAccessTokenReader）
```

无需改三域本体；仅组合根 reader/中间件换源。

## 3. Catalog 数据迁移

> **系统目录已 seed 化（2026-06-22 起）**：`ai_system_llm_provider_type / ai_system_llm_provider / ai_system_llm_model / ai_system_llm_model_match_rule` 四张系统表的全量目录（共 **754** 个系统模型：极客智坊 666 + 火山方舟 41 + 阿里云百炼 37 + 通用 10）已作为 S 类 seed 随程序启动幂等灌入（`packages/llm/core/migrations/S001..S004`，ADR-0017）。**这四表不再需要从旧库迁移**——迁了也会被下次启动的 seed 覆盖。本节迁移现仅针对**租户两表 + 凭据**。

### 3.1 导出 ghcloud 源表

从 `cube_base_ai_application` 导出（JSON 推荐）：

- `ai_application_tenant_llm_provider`（含 `api_key` vendor 凭据）
- `ai_application_tenant_llm_model`

> 系统目录四表（`ai_system_llm_*`）**无需导出/迁移**：由启动 seed 权威管理。即便导出，`catalog:migrate` 对其为幂等 upsert，但属冗余且可能与 seed 版本不一致，不建议。

**勿迁移** `ai_application_tenant_project.ai_center_api_key`（cube-ai 项目 key，收编后删除）。

### 3.2 Dry-run

```bash
bun tools/migration/catalog-migrate.ts \
  --source /path/to/ghcloud-catalog-export.json \
  --dry-run
```

输出 `counts` + `warnings`（如 contracts-only `endpoint_type` 对账）。

### 3.3 执行

脚本支持 memory 映射验证与 MySQL 写入（`--target mysql`）；生产写入安排在运维窗口执行：

```bash
# 验证映射 → InMemoryCatalogStore（见 catalog-migrate.test.ts）
bun test tools/migration

# 生产写入：与 engine/flow 同库 MySQL（cube_ai_center 的 llm_catalog_* 表）
bun run catalog:migrate -- --source ... --target mysql --mysql-url mysql://user:pass@host:3306/cube_ai_center
# （--mysql-url 缺省读 AGENTIC_ENGINE_MYSQL_URL）
```

> 注：`catalog:migrate` 当前仍会 upsert 系统四表，但其权威源已是启动 seed（§3 顶部）；运维窗口实质只需确认**租户两表**落库与凭据可用，系统目录由启动自动对齐。

幂等策略（完整版）：按 `id`/`tenant+provider_code`/`tenant+model_code` upsert；重跑前备份目标库。

### 3.4 迁移后抽样校验

对若干租户调用 `resolveModelRuntime(tenant, modelCode)`，与旧 ghcloud `GET /ai/llm/providers/:id/models/:modelCode/runtime-config` 对比 `api_base_url`/`model_code`/key 存在性（**勿在日志中打印 key 原文**）。

## 4. 流量 Cutover（单 origin）

### 4.1 目标路由

| 旧（多跳）                                 | 新（ai-center 单 origin）        |
| ------------------------------------------ | -------------------------------- |
| `${BASE_API}/aiApplication/ai/agent/*`     | `/agent/*`                       |
| `${BASE_API}/aiApplication/ai/flows/*`     | `/flow/*`（FlowModule SSE 独立） |
| `${BASE_API}/aiApplication/ai/knowledge/*` | `/kb/*`                          |
| `${BASE_API}/aiApplication/ai/llm/*`       | `/llm/*`                         |

### 4.2 灰度建议

1. **网关路由**：按租户或 `%` 流量把 `/aiApplication/ai/*` 镜像到新 origin；对比错误率/延迟。
2. **身份**：先 `USE_GHCLOUD_IDENTITY=1` 在预发全量；生产与旧 ai-server 并行一段窗口。
3. **数据**：catalog dry-run → 预发写入 → 抽样 runtime 对账 → 生产写入（维护窗口）。

### 4.3 一键回滚

| 层级 | 动作                                                           |
| ---- | -------------------------------------------------------------- |
| 网关 | 路由切回 `${BASE_API}/aiApplication/...`                       |
| 身份 | `USE_GHCLOUD_IDENTITY=0` 重启 ai-center → mock 身份（opt-out） |
| 数据 | 保留 ghcloud MySQL 只读副本；catalog 迁移脚本幂等，可重跑      |

旧链路保留期建议 ≥ 1 个发布周期；监控：HTTP 5xx、P95 延迟、kb retrieval-evaluation 通过率。

## 5. 退役清单（文档化，非本轮执行）

| 组件                                                  | 处置                                                                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ghcloud/ai-server` 进程                             | 宿主职能 → `apps/ai-center`                                                                                                                                                                                                |
| ai-application catalog/flow/kb/agent 逻辑             | 已收编 llm/flow/kb/agent-engine                                                                                                                                                                                            |
| gRPC `FlowServiceGrpc`（仅旧仓 ai-server 进程实例）   | **不退役能力面，仅退役旧实例**；该面是**平台服务间调用面**（兄弟后端经 gRPC + Nacos 发现），在 `apps/ai-center` host 重建（ADR-0028）。注意：engine→flow 走进程内 `FlowInvokerPort` 是**另一条路**，不替代本对外 gRPC 面。 |
| `TenantProjectService` / `ai_center_api_key`          | **删除**，不迁移                                                                                                                                                                                                           |
| `@ghcloud/cube-ai-application-service` gateway façade | M5 前端/SDK 替代                                                                                                                                                                                                           |
| RocketMQ 租户初始化/catalog 同步                      | 待定：platform port 主动拉取 vs MQ adapter（见 M6 决策记录）                                                                                                                                                               |

`platform-adapter-ghcloud` **保留**：JWT/tenant/session + 未来 cube2 gRPC 源文档桥。

## 6. 相关命令

```bash
bun run --filter @cube-ai/platform-adapter-ghcloud typecheck
bun test platform-adapter-ghcloud tools/migration
bun run typecheck
```
