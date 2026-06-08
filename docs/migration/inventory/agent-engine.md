# Inventory · agent-engine（cube-agentic-engine）

> 勘察来源：只读 subagent（agent-id `78a276fe`）实读 `/Users/dg/work-dg/cube-ai/cube-agentic-engine`。LOC 由逐文件行数实测。本文是迁移计划 M0/M1/M2 的事实地基；如与记忆冲突，以本文为准。

## 1. 概览

| 项 | 值 |
|---|---|
| 路径 | `/Users/dg/work-dg/cube-ai/cube-agentic-engine` |
| 根包 | `cube-agentic-engine`（private；`type:module`；`engines.bun >=1.3.12 <2`） |
| workspace 包数 | **13**（`packages/*`） |
| `.ts` 文件数 | ≈555（engine 309 = 279 src + 30 test；contracts 80；adapters 66；…） |
| 实现 / 测试 LOC | ≈37.4K / ≈31.3K（合计 ≈68.7K） |
| 运行时底座 | `@dangao/bun-server ^3.1.0`（NestJS 风格 DI/HTTP）驱动 **`@tachu/core 1.0.0-rc.0`**（agent 运行时内核）+ `@tachu/extensions` + `@tachu/host-defaults` |

**命令**：`bun install`（根有 `patchedDependencies: @dangao/nacos-client@0.1.1`）；`bun run dev`（`--filter @cube-ai/agent-engine dev` → `bun run --hot src/main.ts`，默认 `AGENTIC_ENGINE_PORT=3000`）；`bun run build`（contracts/adapters/ext/ghcloud 的 build 是 `echo` 占位＝TS 源直跑、不产 dist；仅 sdk-* 真 build）；`bun run typecheck`；`bun test`（容器测试 env 门控默认跳过）；`bun run test:containers`（`USE_TESTCONTAINERS=1`）。

**catalog（迁移须带）**：`zod ^3.23.8`、`@dangao/bun-server ^3.1.0`、`@dangao/nacos-client ^0.1.1`(patched)、`@tachu/{core,extensions,host-defaults} 1.0.0-rc.0`、`bullmq ^5.21`、`ioredis ^5.4`、`mysql2 ^3.11`、`@qdrant/js-client-rest 1.17.0`、`openai ^4.68`、`@anthropic-ai/sdk ^0.30`、`openapi-fetch ^0.13.8`、`pino`、`prom-client`、`jose`、`lru-cache`、`yaml`、`vue ^3.4`、`@opentelemetry/*`。

## 2. packages 地图（全 `private`，版本统一 `0.0.0-m2-skeleton-c`）

| 包（现名） | 角色 | LOC (impl/test) | 文件 | workspace 依赖 |
|---|---|---|---|---|
| `@cube-ai/agent-engine` | **运行时锚点**：BC 分层 app + 组合根 | 20689 / 13900＋6239 | 309 | adapters, contracts, platform-adapters-ghcloud, ext-{sse,outbox,nacos}; @tachu/*, @dangao/bun-server |
| `@cube-ai/agentic-contracts` | **M0 接缝内核**：zod schema + port 接口 + 错误码 | 3468 / 2519 | 80 | zod（被所有人依赖） |
| `@cube-ai/agentic-adapters` | `@tachu/core` 6 Port 实现 + embedding | 4638 / 3461 | 66 | contracts, **ext-nacos**; openai, anthropic, qdrant, bullmq, mysql2 |
| `@cube-ai/platform-adapters-ghcloud` | 中台 Port 的 HTTP 适配（Flow/Knowledge/LLM-Catalog/Flow-Catalog） | 1139 / 854 | 19 | contracts; lru-cache, pino |
| `@cube-ai/agentic-sdk-core` | 框架无关 HTTP/SSE 客户端 | 1388 / 1225 | 18 | contracts, zod |
| `@cube-ai/agentic-sdk-assistant` | 应用域 SDK（AssistantStore/reasoning-tree/IDB） | 2572 / 1470 | 16 | contracts, sdk-core |
| `@cube-ai/agentic-sdk-vue` | Vue3 composables | 633 / 144 | 10 | contracts, sdk-core, **sdk-assistant**; peer vue |
| `@cube-ai/agentic-sdk-mock` | 进程内 mock engine | 624 / 91 | 4 | contracts |
| `@cube-ai/bun-server-ext-sse` | SSE drain + replay-buffer | 750 / 694 | 13 | ioredis |
| `@cube-ai/bun-server-ext-outbox` | Outbox relay 选主 + dispatcher | 1344 / 690 | 13 | contracts, mysql2, bullmq, ioredis |
| `@cube-ai/bun-server-ext-nacos` | Nacos 热配置 Observer | 148 / 0 | 4 | peer bun-server |
| `@cube-ai/test-infra` | testcontainers 夹具（mysql/qdrant/redis） | 小 | 2-3 | testcontainers, mysql2 |

依赖方向（实读）：`engine` 唯一汇聚点；`adapters→contracts(+ext-nacos)`；`ghcloud→contracts`；`sdk-*→contracts(+sdk-core)`，**只走 HTTP/SSE、不 import 后端包**。无环。

## 3. contracts 接缝内核（M0 关键）

### 3.1 已有 Port（全在 `src/platform/`）

| Port | 文件 | 方法签名 | 目标域 |
|---|---|---|---|
| `FlowInvokerPort` | `platform/flow-invoker.ts` | `invoke(req, signal): Promise<FlowInvokeSyncResponse>` | flow-core(M4) |
| `FlowCatalogPort` | `platform/flow-catalog.ts` | `list(req, signal): Promise<FlowCatalogListResponse>` | flow-core(M4) |
| `KnowledgeQueryPort` | `platform/knowledge-query.ts` | `query(req, signal): Promise<KnowledgeQueryResponse>` | kb-core(M3) |
| `LlmCatalogPort` | `platform/llm-catalog.ts` | `listProviders(tenant, signal)`；`resolveModelRuntime(tenant, modelCode, signal): Promise<LlmModelRuntimeConfig\|null>` | **llm-core catalog(M1)** |

**DI tokens**（`platform/tokens.ts`，`Symbol.for('agentic.adapter.platform.*')`，contracts 持身份）；ghcloud `tokens.ts` 仅 re-export。

### 3.2 目标 Port 缺口（grep 全仓实证）

- **`LlmProviderPort` 不存在**：模型调用走 `@tachu/core` 的 `ProviderAdapter`（`chat/chatStream/embed/listAvailableModels`）。M1 需决策：定义 contracts `LlmProviderPort`，还是把 tachu ProviderAdapter 当引擎内实现、对外只暴 `LlmCatalogPort`。
- **`EmbeddingPort` 已废弃**（源码注释 "replaces retired EmbeddingPort"）：改用 tachu `EmbeddingRuntime`（`agentic-adapters/embedding/turn-aware-embedding-runtime.ts`，委托 `ProviderAdapter.embed`）。**与 ADR-0005/0011「embedding=capability + EmbeddingPort」冲突**。
- **`VectorStorePort` 不存在**（符合 ADR-0005）：向量经 tachu `VectorIndexAdapter`（token `TACHU_VECTOR_INDEX_TOKEN`）直连 Qdrant。

### 3.3 wire schema / 错误码

- 平台 schema：`FlowInvoke*`、`KnowledgeQuery*`、`LlmProviderSummary/LlmModelRuntimeConfig`（+`LlmEndpointType` 13 枚举：openai/openai_response/anthropic/gemini/azure_openai/new_api/openai_image/jina_rerank/ollama/geekai/dashscope/dashscope_text2image/volcengine_ark）、`FlowCatalog*`。
- 会话/SSE：`session/*`、`sse/events.ts`(329)。工具：`tools/descriptor.ts`(291)、`tools/handler-kinds.ts`（13 闭集）。数据：`outbox/`、`usage/`、`jobs/`、`auth/`、`authz/`、`audit/`。
- 错误码（`errors/code.ts`）：17 `ERROR_CATEGORY` + `DEFAULT_HTTP_STATUS` + `categoryOf()` + `KNOWN_ERROR_CODES`；子码 `{CATEGORY}_{SUBJECT}_{REASON}`。
- ⚠️ 自述「skeleton 只代表性 schema，全量待 M1.C Phase3」——M0 落档前需对账 wire schema 完备清单。

## 4. engine 包结构（M2 锚点）

**BC（`src/bc/*`，impl/test LOC）**：`session` 3917/3163（turn.service 772、tachu-sse-mapper 795、session.controller 500、session.service 498、repo 427/255、turn-lock 188、snapshot 110）；`tools` 3278/1765（mcp-bridge 701、tool.service 541、13 handlers）；`tachu` 2033/1786（engine-factory 905、assemble-tachu-runtime 307、host-turn-policy 188）；`jobs` 1735/949（BullMQ 调度/worker/4 processors）；`descriptor` 1462/794；`authz` 1521/1025（grant.service 566、authz-gateway 205、consent-policy 168）；`auth` 961/441（oauth2-introspection 421、mock-obo 257）；`files` 457/221；`tool-activation` 306/621；`skill-activation` 301/85；`usage` 188/213；`safety` 169/164；`platform` 11/0（**空骨架**，真平台集成在 ghcloud 包）。

**infra（`src/infra/*`，impl 3867/test 2673）**：errors、observability(otel/metrics/logger.factory)、**rate-limit**(redis 令牌桶)、**idempotency**(redis store)、tenant-guard(ALS)、secrets(nacos)、lifecycle(graceful-shutdown)、health、audit、mysql(pool)、sfid(雪花)、memory-projection、generated-media、api(version-negotiation)。

**组合根**（`assembler/engine-assembler.ts` 150 + `bootstrap.ts` 238 + `main.ts` 94）：`EngineAssembler.assemble()` 按 ADR-0018 固定顺序 registerModule：Foundations(Sfid/TenantGuard/Errors) → Nacos/Secrets → Mysql → Observability → SseExt → Lifecycle → OutboxExt → Audit → Platform → 6×Tachu adapter → **3×Ghcloud(FlowInvoker/KnowledgeQuery/LlmCatalog)** → 7×BC(Descriptor/Auth/Authz/Usage/Jobs/Tools/Session) → Idempotency/RateLimit。`bootstrap()`：`bindCatalogPortGlobal()`（塞 `globalThis.__agenticLlmCatalogPort`）→ Secrets fail-fast → DescriptorLoader.start + MCP 发现 → 中间件链 `traceId→versionNegotiation→http-metrics→oauth2-introspection→idempotency→tenant-context→rateLimit→errorResponse` → listen。`main.ts`：OTel 最先 import；按 env 选启 BullMQ workers / memory-projection relay / outbox relay。

**SSE/jobs/outbox**：SSE 由 `ext-sse` 的 `SessionSseEmitter`+`DrainService`；`TurnService.runLlmPhase` 把 tachu chunk 经 `tachu-sse-mapper` 翻译为 SSE（唯一权威）。jobs：tachu ExecutionBackend=`bullmq-backend`（队列前缀 `agentic-engine-`），LONG_RUNNING 工具入队。outbox：`ext-outbox` 的 `OutboxWriter`（事务内单行 INSERT）+ relay 选主。

## 5. tool handlers 表（`src/bc/tools/handlers/*`，13 个）

| handler(LOC) | 消费 port/能力 | M2 可否立即接线 | 依赖里程碑 |
|---|---|---|---|
| `flow-handler`(111) | `FlowInvokerPort` | ⚠️ 需绑 Flow 适配 | **M4**（或暂用 ghcloud） |
| `flow-list-handler`(113) | `FlowCatalogPort` | ⚠️ 同上 | **M4** |
| `knowledge-handler`(119) | `KnowledgeQueryPort`（强制 turn 绑定 kbIds 子集） | ⚠️ 需绑 KB 适配 | **M3**（或暂用 ghcloud） |
| `llm-handler`(88) | tachu `ProviderAdapter` | ⚠️ 需 provider | **M1** |
| `vector-handler`(132) | tachu `VectorIndexAdapter` + `TurnAwareEmbeddingRuntime` | ⚠️ 需 Qdrant+embedding | M3 + 随 M2 adapter |
| `memory-handler`(216) | `MemorySystem` + VectorIndex + EmbeddingRuntime | ⚠️ 同上 | 随 M2（tachu adapter） |
| `mcp-handler`(44) | `McpBridgeService`(701，stdio/sse JSON-RPC 子进程池) | ✅ 引擎自带 | M2 自足 |
| `sql-handler`(121) | **无 port**：`mysql2` 直连（`AGENTIC_ENGINE_SQL_DATASOURCE_*_URL`，写白名单门控） | ✅ | M2（安全面） |
| `http-handler`(176) | **无 port**：`fetch`（超时/重试/脱敏） | ✅ | M2 |
| `openapi-handler`(200) | **无 port**：`openapi-fetch` | ✅ | M2 |
| `shell-handler`(153) | **无 port**：`Bun.spawn`+黑名单+safety | ✅ | M2（安全面） |
| `clock-handler`(33) | **无 port**：UTC | ✅ | M2 |
| `qwen-image-handler`(195) | **无 port**：DashScope HTTP，**key 直读 env `DASHSCOPE_API_KEY`**（绕 catalog） | ✅ 能跑 | M2（凭据应收归 catalog） |

→ **7 个 M2 即可接线**（mcp/sql/http/openapi/shell/clock/qwenImage）；**6 个**（flow/flowList/knowledge/llm/vector/memory）需对应能力，但 port 已在 M0，可先用 ghcloud 适配或 noop 跑通。

## 6. agentic-adapters 去向表

| adapter（LOC） | 喂给 | 说明 |
|---|---|---|
| `provider/openai-compat-provider`(491)、`anthropic-provider`(460)、`catalog-driven-provider`(411)、`catalog-provider-routing`(59)、`noop-provider`(54) | **llm-core(M1)** | `CatalogDrivenProvider` 消费 `LlmCatalogPort` 解析 `{endpointType,apiBaseUrl,apiKey}` 分发到内层 provider |
| `provider/dashscope-text2image`(204)、`geekai-nano-banana-image`(190) | **llm-core(M1)** | 文生图 provider |
| `vector/cube-qdrant-memory-index`(107)、`qdrant-point-id`(45)、`vector-store-errors`(64) | **infra/vector-qdrant** | `implements VectorIndexAdapter`，内含 `@tachu/extensions` 的 `QdrantVectorIndexAdapter`（raw 向量 + tenant payload，**不设 port**） |
| `embedding/turn-aware-embedding-runtime`(93) | **embedding / engine？** | `implements EmbeddingRuntime`，委托 `ProviderAdapter.embed`。≠ ADR-0011 `EmbeddingPort`——**待决** |
| `memory/*`（redis/in-memory/noop/projected/mysql-projection-outbox） | **agent-engine 内置**（tachu MemorySystem） | |
| `backend/bullmq-backend`(210) | **agent-engine 内置**（tachu ExecutionBackend） | |
| `safety/baseline-safety`(350)+policies | **agent-engine 内置**（tachu SafetyModule） | engine 用 `EngineSafetyModule` 包一层加 Nacos 热黑名单+审计 |
| `observability/pino-observability`(122)、`otel-tracer`(94) | **agent-engine 内置** | |

→ adapters **按 seam 拆散**，非整包改名：provider/image→llm-core；vector→vector-qdrant；embedding→embedding/engine；memory/backend/safety/observability→随 M2 锚点整体 copy。

## 7. LLM 调用 & catalog 现状（M1 输入）

`TachuProviderModule` 按 env `AGENTIC_ENGINE_PROVIDER` 选 provider：`noop`(默认)/`openai-compat`/`anthropic`（凭据直读 env），或 **`agentic-platform-llm-catalog`**（取 `globalThis.__agenticLlmCatalogPort` 构造 `CatalogDrivenProvider`）。catalog 模式：`chat/embed` 按 `ctx.tenant`+`modelCode` 调 `LlmCatalogPort.resolveModelRuntime()` → `{endpointType,apiBaseUrl,apiKey,modelTypes}` → 按 endpointType 映射到 OpenAICompat/Anthropic/Gemini/DashScope/VolcengineArk/文生图，带 `(tenant:model:hash)` LRU 缓存。vendor key 来自中台 HTTP（`GhcloudLlmCatalogAdapter`：`GET {baseUrl}/ai/llm/providers/{id}/models/{modelCode}/runtime-config` 返回 apiKey，N+1，LRU）。

## 8. 包重命名映射（→ ADR-0011）

`@cube-ai/agent-engine`→**`agent-engine`**；`agentic-contracts`→**`contracts`**；`agentic-adapters`→**按 seam 拆**（provider/image→`llm-core`，vector→`vector-qdrant`(infra)，embedding→`embedding`/engine，memory/backend/safety/observability→`agent-engine`）；`platform-adapters-ghcloud`→**`platform-adapter-ghcloud`**；`agentic-sdk-core`→**`agent-sdk-client`**，`-vue/-assistant/-mock`→`agent-sdk-client-{vue,assistant,mock}`；`bun-server-ext-*`→`infra/bun-server-ext/*`；`test-infra`→`infra/test-infra`。DI token 命名空间 `agentic.*` 是否迁 `agent.*` 待定。

## 9. 测试现状

co-located 单测 **161** + engine `test/integration/` **30**（18 testcontainers + 12 integration）≈191 测试文件、≈31.3K LOC。命令 `bun test`（容器测试 env 门控自动跳过）。**可离线子集（copy 后跑绿）**：所有 co-located `*.test.ts` 纯 `bun test` 不起容器——contracts、adapters 非容器项、engine 各 BC 单测、sdk-*、ext-sse/outbox 单测。容器测试需 Docker（mysql/redis/qdrant/nacos/ollama）。

## 10. 外部依赖与关键 env

MySQL(`AGENTIC_ENGINE_MYSQL_URL`)、Redis(`…REDIS_URL`)、Qdrant(`…QDRANT_URL`/`…MEMORY_VECTOR_SIZE=1536`)、Nacos(patched client)、OTel、平台(`…PLATFORM_API_BASE_URL`/`…PLATFORM_SERVICE_TOKEN`)、Auth(`…AUTH_MODE=mock|oauth2`)、Provider(`…PROVIDER`/OpenAI/Anthropic key/`DASHSCOPE_API_KEY`)、运行开关(`…ENABLE_JOB_WORKERS`/`…ENABLE_OUTBOX_RELAY`/`…ENABLE_MEMORY_PROJECTION_RELAY`)。deploy/：docker-compose(profiles) + k8s(deployment/service/hpa/configmap) + `buildkit/nexus-guhecloud.toml.example`（**私有 Nexus，@tachu/@dangao 来源**）。

## 11. 迁移风险与暗坑

1. **`@tachu/*` 是硬底座**（私有 Nexus）。agent-engine 是 tachu Engine 的 host，provider/vector/memory/safety/observability 全实现 tachu Port。**新 monorepo catalog 必须能拉到 @tachu，否则一行不能编译**（M2 前置）。
2. **patchedDependencies**：`@dangao/nacos-client@0.1.1` 补丁必须连 `patches/` 一起搬。
3. **`globalThis.__agenticLlmCatalogPort` 全局耦合**（provider.module + bootstrap）：M1 拆 llm-core 须改 DI 注入。
4. **provider 选择是模块级 env 常量**（注册期固化、不可热切）。
5. **embedding 与 ADR 偏差**（§3.2）：落 embedding 包须决定是否重建 EmbeddingPort。
6. **凭据多源残留**：catalog 模式方向对；但 `qwen-image-handler` 直读 `DASHSCOPE_API_KEY`、provider.module 直读 OpenAI/Anthropic env——M1 须清旁路。
7. **engine→ghcloud 包硬依赖**：`engine/package.json` 直依 `platform-adapters-ghcloud`；新仓应 token 改从 `contracts` 直引、flow/kb/llm 由各 core 实现 port、组合根装配，ghcloud 退为可选适配。
8. **ghcloud 中台 DTO 强耦合**：硬编码头 `terminal:'bimops-manage-web'`、N+1 找 runtime-config、tenant 为 number+19 位 SFID。
9. **bun-server-ext-* 是回流目标**（将上游化为官方 `@dangao/bun-server-*`），注意 API 漂移。
10. **adapters→ext-nacos 耦合**：拆 llm-core/vector-qdrant 时勿误带 nacos 依赖进纯能力包。
11. **contracts 非完备**（skeleton 代表性 schema）。
12. **安全面随 M2 入账**：sql-handler（任意 SQL，仅白名单）、shell-handler（Bun.spawn）、http/openapi（SSRF 面）。
13. handler kind 强转 `as unknown as`。多副本暗坑：qwen-image 落盘需粘滞/单实例；relay 靠 Redis 选主。

## 12. 开放问题

1. embedding 形态：保留 tachu EmbeddingRuntime（走 catalog），还是按 ADR 重建 `embedding` + `EmbeddingPort`？
2. provider 调用面是否需 contracts `LlmProviderPort`（满足「跨域唯一接缝=contracts port」）？
3. flow/kb port 由 flow-core/kb-core 原生实现，还是长期保留 ghcloud HTTP 适配？
4. 文生图统一为 catalog 驱动（消 qwen-image env 旁路）？
5. **@tachu/* 新仓 catalog 能否访问私有 Nexus**？需 vendoring？（M2 编译前置）
6. DI token 命名空间是否随 ADR-0011 迁 `agent.*`？
7. contracts 全量 schema 边界（哪些 skeleton/哪些终态）？
8. CI 是否提供 Docker 跑容器测试，还是仅离线子集做 copy 验证？
