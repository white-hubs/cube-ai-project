# Cutover Runbook — ghcloud → ai-center 单 origin

> M6 务实子集：身份切换 + catalog 迁移骨架 + 灰度/回滚步骤。不含真实生产 cutover 执行。

## 1. 前置条件

| 项 | 验收 |
|---|---|
| M1–M5 exit 绿 | `bun run typecheck` + 各域离线测试 |
| ai-center 单进程 | `/health` 200；agent/flow/kb/llm 路由可达 |
| 鉴权中心 JWT 公钥 | `JWT_KEY_URL` 可达（例：`http://<oauth-host>/oauth2/jwt.key`） |
| catalog 迁移导出 | ghcloud `cube_base_ai_application` 六表 JSON/SQL 导出就绪 |

## 2. 身份切换（host 注入）

### 2.1 开发/预发验证

```bash
export USE_GHCLOUD_IDENTITY=1
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
unset USE_GHCLOUD_IDENTITY
# 或 USE_GHCLOUD_IDENTITY=0
# 重启 ai-center → 恢复 flow opaque token（createFlowAccessTokenReader）
```

无需改三域本体；仅组合根 reader/中间件换源。

## 3. Catalog 数据迁移

### 3.1 导出 ghcloud 源表

从 `cube_base_ai_application` 导出（JSON 推荐）：

- `ai_system_llm_provider_type`
- `ai_system_llm_provider`
- `ai_system_llm_model`
- `ai_system_llm_model_match_rule`
- `ai_application_tenant_llm_provider`（含 `api_key` vendor 凭据）
- `ai_application_tenant_llm_model`

**勿迁移** `ai_application_tenant_project.ai_center_api_key`（cube-ai 项目 key，收编后删除）。

### 3.2 Dry-run

```bash
bun tools/migration/catalog-migrate.ts \
  --source /path/to/ghcloud-catalog-export.json \
  --dry-run
```

输出 `counts` + `warnings`（如 contracts-only `endpoint_type` 对账）。

### 3.3 执行（M6 骨架）

当前 skeleton 支持 **memory 映射验证**；SQLite/MySQL 写入待运维窗口实现：

```bash
# 验证映射 → InMemoryCatalogStore（见 catalog-migrate.test.ts）
bun test tools/migration

# 生产写入：待接 llm-core SQLite/MySQL seed（M6.T4 完整版）
# bun tools/migration/catalog-migrate.ts --source ... --target sqlite --sqlite /path/to/llm-catalog.db
```

幂等策略（完整版）：按 `id`/`tenant+provider_code`/`tenant+model_code` upsert；重跑前备份目标库。

### 3.4 迁移后抽样校验

对若干租户调用 `resolveModelRuntime(tenant, modelCode)`，与旧 ghcloud `GET /ai/llm/providers/:id/models/:modelCode/runtime-config` 对比 `api_base_url`/`model_code`/key 存在性（**勿在日志中打印 key 原文**）。

## 4. 流量 Cutover（单 origin）

### 4.1 目标路由

| 旧（多跳） | 新（ai-center 单 origin） |
|---|---|
| `${BASE_API}/aiApplication/ai/agent/*` | `/agent/*` |
| `${BASE_API}/aiApplication/ai/flows/*` | `/flow/*`（FlowModule SSE 独立） |
| `${BASE_API}/aiApplication/ai/knowledge/*` | `/kb/*` |
| `${BASE_API}/aiApplication/ai/llm/*` | `/llm/*` |

### 4.2 灰度建议

1. **网关路由**：按租户或 `%` 流量把 `/aiApplication/ai/*` 镜像到新 origin；对比错误率/延迟。
2. **身份**：先 `USE_GHCLOUD_IDENTITY=1` 在预发全量；生产与旧 ai-server 并行一段窗口。
3. **数据**：catalog dry-run → 预发写入 → 抽样 runtime 对账 → 生产写入（维护窗口）。

### 4.3 一键回滚

| 层级 | 动作 |
|---|---|
| 网关 | 路由切回 `${BASE_API}/aiApplication/...` |
| 身份 | `USE_GHCLOUD_IDENTITY=0`，重启 ai-center |
| 数据 | 保留 ghcloud MySQL 只读副本；catalog 迁移脚本幂等，可重跑 |

旧链路保留期建议 ≥ 1 个发布周期；监控：HTTP 5xx、P95 延迟、kb retrieval-evaluation 通过率。

## 5. 退役清单（文档化，非本轮执行）

| 组件 | 处置 |
|---|---|
| `@ghcloud/ai-server` 进程 | 宿主职能 → `apps/ai-center` |
| ai-application catalog/flow/kb/agent 逻辑 | 已收编 llm/flow/kb/agent-engine |
| gRPC `FlowServiceGrpc` | 退役；engine→flow 进程内 `FlowInvokerPort` |
| `TenantProjectService` / `ai_center_api_key` | **删除**，不迁移 |
| `@ghcloud/cube-ai-application-service` gateway façade | M5 前端/SDK 替代 |
| RocketMQ 租户初始化/catalog 同步 | 待定：platform port 主动拉取 vs MQ adapter（见 M6 决策记录） |

`platform-adapter-ghcloud` **保留**：JWT/tenant/session + 未来 cube2 gRPC 源文档桥。

## 6. 相关命令

```bash
bun run --filter @cube-ai/platform-adapter-ghcloud typecheck
bun test platform-adapter-ghcloud tools/migration
bun run typecheck
```
