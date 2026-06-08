# Inventory · cube-ai 平台/组合层

> 勘察来源：只读 subagent（agent-id `4d78c74b`）实读 `/Users/dg/work-dg/cube-ai/redesign/cube-ai`（服务拆分后）。本文是迁移计划 M0(workspaces/组合根)/M2(身份注入 seam)/M4(assistant 剔除) 的事实地基。

## 1. monorepo 结构

框架基线：全栈 `@dangao/bun-server`（catalog 锁 **2.3.0**，NestJS 风格 DI）。根 workspaces：`["shared","server","server/server-base","server/server-mock","server/server-shared","server/flow","server/bootstrap","server/kb","server/assistant","web"]`；`catalogs.bun-server: {"@dangao/bun-server":"2.3.0"}`。

| 包 | 角色 | 依赖 | single 端口 |
|---|---|---|---|
| `@cube-ai/bootstrap` | **组合根/单进程宿主**：装 AssistantModule+AiKbModule、Config/Logger/Database/Swagger/Noop-registry、5 中间件、health | assistant, flow, kb, server-base, server-mock | **3210** |
| `@cube-ai/server-base` | 横切**库**：`loadAppConfig`、3 安全中间件工厂、`AccessTokenReader`/`DeveloperApiKeyReader`/`ProjectLookup` **port 接口**、`access-context`、`UnifiedErrorFilter`、snowflake | server-shared | 库 |
| `@cube-ai/server-shared` | 身份**载体库**：3 ALS（projectContext/authenticatedUser/developerApi）+ `currentProjectId`/`isGlobalAccessEnabled` + 租户 id 工具 | （零运行时依赖） | 库 |
| `@cube-ai/server-mock` | mock 拦截器：`@MockableEndpoint`+`MockInterceptor`+env 开关 `CUBE_AI_MOCK` | bun-server | 库 |
| `@cube-ai/assistant` | **玩具副驾**（不迁，§4） | **flow**, server-mock | 3321 |
| `@cube-ai/flow` / `@cube-ai/kb` | 域（见各自 inventory） | server-base, server-shared, shared | 3320 / 3322 |

依赖图：`bootstrap→assistant→flow→{server-base,server-shared,shared}`；`bootstrap→kb`；`server-base→server-shared`。⚠️ **`app.module.ts` 只 imports `[AssistantModule, AiKbModule]`，未直接挂 FlowModule**——FlowModule 经 AssistantModule 传递性进入；但 `bootstrap/main.ts` 又直接 import flow 的 3 个 reader 工厂装中间件。**assistant 不迁后，flow 必须由组合根显式 imports**（§9 高风险）。

## 2. 组合根装配（启动序列，main.ts:41-105）

```ts
import './load-env'                  // ① 注入 server/.env
import 'reflect-metadata'
const config = await loadAppConfig()           // ②
await tryInitCubeTelemetry(config)             // ③ 可选 OTel
ExceptionFilterRegistry.getInstance().register(new UnifiedErrorFilter())  // ④
const app = new Application({ port, hostname, idleTimeout, sseKeepAlive:{intervalMs:15_000} })
registerMockInterceptor(app.getContainer())    // ⑤
app.use(createCorsMiddleware({...}))            // CORS
app.use(createRequestLoggingMiddleware({...}))  // 日志
app.registerModule(AppModule)                  // ⑥ 挂控制器
// —— 身份注入 seam（reader/lookup 全来自 @cube-ai/flow）——
app.use(createExecutionAuthMiddleware({ accessTokenReader: createFlowAccessTokenReader(),
  apiKeyReader: createFlowDeveloperApiKeyReader(), projectLookup: createFlowProjectLookup() }))
app.use(createDeveloperRateLimitMiddleware({ maxPerMin: config.devApiRateLimitPerMin }))
app.use(createProjectContextMiddleware({ projectLookup: createFlowProjectLookup() }))
await app.listen()
```

中间件链：`CORS→日志→[registerModule]→execution-auth(Bearer/x-api-key)→developer-rate-limit→project-context`。`AppModule` imports：ConfigModule/LoggerModule/DatabaseModule(localDev?sqlite:mysql)/**NoopServiceRegistryModule**/SwaggerModule/AssistantModule/AiKbModule；controllers HealthController；providers DatabaseConnectionBootstrap(`OnModuleInit` 显式 initialize)。

⚠️ **两套中间件副本**：server-base 与 flow/src/middleware 各有 `createProjectContextMiddleware`+`createDeveloperRateLimitMiddleware`；bootstrap 用 server-base 版、flow single 用 flow 版。需裁定 host 权威版。project 解析重复：execution-auth 已写 projectContextAls，后置 project-context 主要服务管理面（skipPrefixes 跳 `/run/ /webhook/ /search /documents /projects /components /oauth2/ /auth/`）。

## 3. 身份注入 seam 清单（D2/D3「换源不动本体」核心）

身份三层：① **port 接口**（契约）② **ALS 载体**（请求上下文）③ **flow 提供的实现**（当前源，可换）。

| # | 注入点符号 | 文件 | 类型 | 谁提供（当前源） |
|---|---|---|---|---|
| 1 | `createExecutionAuthMiddleware({accessTokenReader,apiKeyReader,projectLookup})` | `server-base/.../execution-auth.middleware.ts:109` | 工厂/注入点 | bootstrap/main.ts:84 注入 3 flow 工厂 |
| 2 | `AccessTokenReader.verifyAccessToken` | `middleware-types.ts:11` | port 接口 | `createFlowAccessTokenReader()`→`flowRepo.verifyAccessToken` |
| 3 | `DeveloperApiKeyReader.verifyApiKeyRaw` | `middleware-types.ts:24` | port 接口 | `createFlowDeveloperApiKeyReader()`→`flowRepo.verifyApiKeyRaw` |
| 4 | `ProjectLookup.{listProjectIds,hasProject}` | `middleware-types.ts:28` | port 接口 | `createFlowProjectLookup()`→`projectRepo` |
| 5 | `createProjectContextMiddleware({projectLookup})` | `server-base/.../project-context.middleware.ts:26` | 工厂/注入点 | bootstrap/main.ts:100 |
| 6 | `projectContextAls` | `server-shared/src/project-context.ts:10` | ALS 载体 | 中间件 `.run()` 填充 |
| 7 | `authenticatedUserAls` | `server-shared/src/auth-context.ts:11` | ALS 载体 | execution-auth Bearer 分支 |
| 8 | `developerApiAls`(apiKeyId/flowIdScope/allowedTools/accessLevel/projectId) | `server-shared/src/developer-api-context.ts:17` | ALS 载体 | execution-auth x-api-key 分支 |
| 9 | `currentProjectId()`/`isGlobalAccessEnabled()` | `server-shared/src/access-scope.ts:3` | 只读消费 API | （读 #6） |

**换源实证**：`AccessTokenReader`/`DeveloperApiKeyReader`/`ProjectLookup` 是纯接口（`middleware-types.ts`），中间件只 import 接口、不 import flow——收编后 host 只换 3 工厂实现，main 装配/中间件/ALS/消费方一行不改：

```ts
app.use(createExecutionAuthMiddleware({
  accessTokenReader: createGhcloudAccessTokenReader(platformAdapter),  // ← 换 host 源
  apiKeyReader:      createHostPatReader(platformAdapter),             // ← PAT 归 host
  projectLookup:     createFlowProjectLookup(),                        // projects-as-container 留 flow
}))
```

当前源：flow 自带 opaque-token OAuth2（`auth/auth.service.ts`：grant_type=password|refresh_token，自发 `atk_`/`rtk_`，存 flow DB，TTL 2h/14d，isSuperAdmin=role==='super_admin'）；3 个 `createFlow*` 工厂经 `getSharedRepositories()`（模块级 memoized 单例，非 DI）拿 flowRepo/projectRepo。compose 里 `JWT_KEY_URL`/`OUAA_*` 被显式置空（外部 OAuth2/JWT 接入预留位，当前未走）。

## 4. assistant 玩具细节 + 耦合残留

模块：`assistant.module.ts` `imports:[FlowModule]`（**反模式①直连 flow**）；`assistant.controller.ts /assistant` 路由 sessions/messages(SSE)/apply-proposal/optimize-prompt-template。**自带 OpenAI 客户端（反模式②）**：`llm-config.ts` 读 `ASSISTANT_API_KEY`/`ASSISTANT_MODEL_BASE_URL`(默认 openai)/`ASSISTANT_MODEL`(gpt-4o-mini)；`llm-openai.ts` 手写 fetch 流式 + tool_calls 累积；`llm-image.ts` 出图。**session 存 flow 的 repo（反模式③）**：`AssistantService` 构造注入 `FlowsService`+`FlowRepository`，session/消息/提案/审计全落 flow repo（14 方法）。工具（`assistant-tools.ts`）：list_flows/get_flow_summary/chat_with_configured_flow（转发 flow Playground SSE）/optimize_flow_prompt_template/generate_image/search_help/**search_knowledge（硬编码 unavailable）**/propose_flow_update。

**flow repo 残留（供 flow 剔除）**：`FlowRepository` 契约焊 14 assistant 方法（`repository-contracts.ts:71-94`）；sqlite/mysql/placeholder 均带；4 张表 DDL（`sqlite.ts:111/124/143/160`）+ 重置/迁移清单引用 + `assistant.mock.ts`。剔除后 assistant 整包不迁。⚠️ assistant↔kb **零集成**（search_knowledge 假桩），迁移无需考虑这条边。

## 5. DB/中间件初始化

**sqlite↔mysql 双模**（`config.localDev` 切换）：① `DatabaseModule.forRootAsync`（localDev→sqlite，否则 mysql+pool{max10,timeout30s,retry3}+healthcheck）② `DatabaseConnectionBootstrap` OnModuleInit 显式 `initialize()`（mysql 还 `SET time_zone='Asia/Shanghai'`）③ flow 侧另有 `getSharedRepositories()` **自建 DatabaseService 单例**用于中间件 reader——与 DI DatabaseModule **是两条初始化路径**（潜在双连接，§9）。**Redis：无**（组合层零 Redis/BullMQ，rate-limit 是进程内 Map）。**Nacos noop**：`NoopServiceRegistryModule` 提供 `SERVICE_REGISTRY_TOKEN`，全空实现。其它有状态依赖（经 AppConfig）：MySQL/Qdrant/MinIO/Docling/Langflow/Embedding。

## 6. 配置/env

`loadAppConfig()`（记忆化），优先级 CLI `--flag` > `config/app.json` > env > 默认。`load-env.ts` 在所有 import 前注入 `server/.env`。关键 env：`PORT`(3210)、`CUBE_LOCAL_DEV`(→sqlite+noop)、MySQL(`MYSQL_*`,db=ai)、`LANGFLOW_BASE_URL`/`_API_KEY`、`QDRANT_BASE_URL`(:6333)/`_COLLECTION_NAME`(ai_server_documents)/`_VECTOR_SIZE`(1024)、`EMBEDDING_BASE_URL`(volces ark)/`_API_KEY`/`_MODEL`(doubao-embedding-vision-251215)、`RETRIEVAL_SCORE_THRESHOLD`(0.25)、`DOCLING_BASE_URL`(:5001)、`MINIO_*`、`CUBE_SUPER_ADMIN_*`(admin/ChangeMe123!)、`CUBE_AI_BUILTIN_SYSTEM_API_KEY`(sk_cube_builtin_system_…)、`CUBE_WEBHOOK_HMAC_SECRET`、`CUBE_DEV_API_RATE_LIMIT_PER_MIN`(60)、`OTEL_*`、assistant(`ASSISTANT_*`,不迁)、mock(`CUBE_AI_MOCK*`)、预留未用(`JWT_KEY_URL`/`OUAA_*`)。⚠️ `builtinSystemApiKey`/`superAdmin*` 是 flow seed 进 DB 的内置凭据，收编后认证源应迁 host。

## 7. docker/compose

镜像（`docker/server/Dockerfile`，单进程单二进制）：builder（nexus.guhecloud.com:5000/ghcloud/bun-ci）→ git clone → `bun install --frozen-lockfile --production` → `bun --cwd=server/bootstrap run build:pkg`（`bun build src/main.ts --target bun --outfile dist/cube-ai-bootstrap`）；runtime（oven/bun:1.3.12）拷单二进制+预置 `/app/data/`（langflow-api-all.json、cube-component-catalog.json、help-docs）。**整个后端打成一个进程**（合 ADR-0009）。compose：生产仅 2 service（server:3210 + web nginx）；**MySQL/Qdrant/MinIO/Langflow/Nacos 均不在 compose 内**（运维注入）。**无 Redis**。

## 8. 命名对照（→ ADR-0011）

`@cube-ai/flow`→**`flow-core`**；`kb`→**`kb-core`**；`bootstrap`→**`apps/ai-center`**；`server-base`（中间件/UnifiedErrorFilter/snowflake/loadAppConfig）→host + **`infra/bun-server-ext-*`**，port 接口入 `contracts`；`server-shared`（ALS+currentProjectId+租户原语）→host/**`contracts`** 身份上下文原语；`server-mock`→**`infra/bun-server-ext-mock`** 或 `*-sdk-*-mock`；`createFlow*Reader/Lookup`→**`platform-adapter-ghcloud`**（实现身份 port）；flow `model-providers`→**`llm-core`**；kb embedding→**`embedding`**；Qdrant 驱动→**`infra/vector-qdrant`**；Nacos noop→`infra/bun-server-ext-nacos`；`@cube-ai/assistant`→**无对应包**（不迁）。

## 9. 迁移风险与暗坑

1. **flow 显式 imports 缺口（高）**：app.module 不直接 imports FlowModule（经 assistant 传递性）。assistant 不迁后 FlowModule 失去挂载入口——`apps/ai-center` 必须显式装 FlowModule。
2. **两套中间件副本（中）**：server-base vs flow/middleware，需裁定 host 权威版，逐字比对 skipPrefixes。
3. **god-repo `FlowRepository`（高）**：flows/playground/api-keys/auth-users/access-tokens/kv/webhook/custom-template + assistant 14 方法焊同一接口。剔 assistant = 改契约+两实现+placeholder+表+迁移清单，牵一发动多处；「先整包跑绿、后逐方法删」+ flow 自带测试夹住。
4. **双 DB 初始化路径（中）**：DI DatabaseModule vs flow `getSharedRepositories()` 单例（绕 DI），单进程内可能两条连接/两 pool，迁 host 须统一。
5. **身份源耦合 flow DB（高，但 seam 已隔离）**：access-token/refresh/super_admin/builtin-system-key seed 在 flow DB；换 host 源时 `isSuperAdmin`/`bypassProjectIsolation` 管理面语义须在 host adapter 等价实现。
6. `search_knowledge` 假桩（assistant↔kb 零集成）。
7. OUAA/JWT 预留位（当前未用，host 接鉴权中心的落点）。
8. rate-limit 进程内 Map（多 worker 时各算各的，ADR-0009 已知）。

## 10. 开放问题

1. FlowModule 在 ai-center 装配形态（直接 imports vs 经 port）？reader 工厂仍由 flow 导出，还是 platform-adapter 提供、flow 只留 ProjectLookup？
2. `createProjectContextMiddleware`/`createDeveloperRateLimitMiddleware` 谁权威（server-base vs flow）？归 `infra/bun-server-ext`？
3. DB 连接统一：flow `getSharedRepositories()` 单例是否退役改吃 DI？sqlite localDev 在 monorepo 下与 kb/engine 同库还是分库？
4. super_admin/builtin-system-key 语义迁移：`isSuperAdmin`→`bypassProjectIsolation` 全局视图，host 如何表达（角色/scope）？developer key `access_level`+`scopes_json`+`allowed_tools_json` 如何拆「认证归 host / grant 留 flow」？
5. `x-project-id`/`project_id` 头约定：projects-as-container 留 flow 后，host 注入「租户」与 flow `projects.project_id` 如何对齐（同 id 空间还是映射）？
6. assistant 价值重建（chat_with_configured_flow/generate_image/optimize_prompt/propose_flow_update）以 agent-engine preset 重建走哪些 port、排期？
7. mock 体系去留（`@MockableEndpoint`+`CUBE_AI_MOCK_*`）保留为测试夹具还是弃用？
