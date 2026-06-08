# Inventory · flow（redesign/cube-ai/server/flow）

> 勘察来源：只读 subagent（agent-id `96deab78`）实读 `/Users/dg/work-dg/cube-ai/redesign/cube-ai/server/flow`，验证并深化 `cube-ai-current-state.md §3`。LOC 取 Read 末行号。本文是迁移计划 M4 的事实地基。

## 1. 概览

| 项 | 值 |
|---|---|
| 路径 | `…/redesign/cube-ai/server/flow` |
| 包名 | `@cube-ai/flow`（private，exports `.` + `./mock`） |
| 文件数 | **114** |
| 实现 / 测试 LOC | ≈16,600 / ≈5,174（19 个 `*.test.ts`） |
| SQL | `scripts/init_mysql.sql` 339 + 3 迁移脚本 |
| 框架 | `@dangao/bun-server` **2.3.0**（⚠️ 与 engine 的 ^3.1 大版本不一致） |
| 独立启动 | `bun run dev:single` → `src/single.ts`（默认 3320，仅挂 FlowModule） |
| 运行依赖 | `@cube-ai/{server-base,server-shared,shared}`、`@modelcontextprotocol/sdk`、`zod` |
| 构建期产物 | `cube-component-catalog.json`（`bun run sync-components`）+ Langflow `api-all.json` |

最大文件：`langflow/graph-translator.ts` 2342 · `db/sqlite.ts` 1816 · `db/mysql-repositories.ts` 1115 · `flows/flows.controller.ts` 844 · `flows/flow-langflow-sync.service.ts` 790。

## 2. 模块全景表

| 模块 | 本体/横切 | 关键文件·LOC | 处置 |
|---|---|---|---|
| `engine/` | 本体 | cube-linear-engine 182 · openai-compat-chat 137 · linear-chain 60 | 迁 flow-core；openai-compat-chat 软过渡到 `LlmProviderPort` |
| `langflow/` | 本体 | graph-translator 2342 · langflow-client 535 · lf-sse-stream 296 · build-event-mapper 232 · lf-mcp-server-sync 187 · lf-mcp-tool-options-enrich 123 | 整体迁 flow-core |
| `custom-component/`(DSL) | 本体 | compile-v2 258 · dsl-to-cube-schema 290 · transpile 356 · workflow-emit-v2 341 · operators 351 · lf-template-from-dsl 197 · dsl-v2.schema 146 | **DSL 编译收口权威**，整体迁 |
| `flows/` | 本体 | flow-langflow-sync.service 790 · flows.controller 844 · flow-files.controller 358 · flow-crud.service 314 · cube-sse-enrich 275 · flow-playground.service 234 · flow-execution.service 146 | 迁 flow-core（剔 assistant 残留） |
| `components/` | 本体 | components.controller 264 · component-schema.service 217 · component-catalog.service 42 | 迁（依赖 api-all + catalog 产物） |
| `custom-component-templates/` | 本体 | controller 236 · service 110 | 迁 |
| `run/` | 本体 | run.controller 80 | 迁 |
| `webhook/` | 本体 | webhook.controller 135 · webhook-hmac 15 | 迁 |
| `guardrails/` | 本体 | guardrails 74 | 迁 |
| `observability/` | 本体 | execution-metrics 152（**纯内存**）· controller 64 | 迁 |
| `mcp/` | 本体（**客户端**） | mcp-list-tools-sdk 158 · mcp-tools.controller 113 | 迁；**非 MCP server**，是探测外部 MCP 的客户端 |
| `http/` | 本体 | sse-response 32 | 迁 |
| `contracts/` | 本体 | cube-run 191 · cube-flow 67 | 迁 |
| `projects/` | 横切→留本体(容器) | projects.controller 198 · projects.service 93 | projects-as-container 留 flow-core；身份解析换 host |
| `auth/` | 横切 | users.controller 160 · auth.service 142 · auth.controller 71 · flow-auth-adapters 42 | 鉴权收归 host；只留 `flow-auth-adapters` seam |
| `api-keys/` | 横切 | api-keys.controller 137 · api-keys.service 145 | 认证收归 host；留 key→flows grant |
| `settings/` | 横切 | model-providers.controller 151 | **退役**，凭据迁 llm-core catalog |
| `middleware/` | 横切 seam | project-context.middleware 19 · project-lookup-cache 18 | 注入式 seam，换源不动本体 |
| `db/` | 本体+横切混 | sqlite 1816 · mysql-repositories 1115 · shared-repositories 220 · repository-contracts 173 | 迁；剔 assistant 表/方法；MySQL 实现需核 |

## 3. 执行引擎 & 双后端

**cube-linear-engine**（仅线性链 `ChatInput*→LLM`，`linear-chain.ts` 强制单入边无分支）。LLM 调用 → `engine/openai-compat-chat.ts`（裸 `fetch`，手解析 SSE）。**凭据来源（硬编码优先级）**：① 节点 `config['api_key']`/`['openai_api_base']`/`['model_name']` ② env `OPENAI_API_KEY`/`OPENAI_API_BASE`/`OPENAI_MODEL` ③ 缺 → `HttpException(503, 'CUBE_ENGINE_LLM_CONFIG')`。⚠️ **cube engine 不读 `model_provider:` app_kv**——节点 key 与 model-providers mini-catalog 服务端互不连通。

**双后端**（`flow-execution.service` + `flow-playground.service`）：env `EXP_USE_CUBE_FLOW_ENGINE` 真值 → cube engine 优先；否则 Langflow 优先。**窄回退** `shouldFallbackCubeEngine`：仅当 env `CUBE_AI_CUBE_ENGINE_FALLBACK` 真值 **且** 错误 `HttpException(503)` 且 `details.code==='EXECUTION_UNAVAILABLE'`（LF 未绑/不可用）才回退；LF 运行期普通错误不回退。

## 4. Langflow 集成

**client**（535）：getFlow/patchFlow/runFlow/openRunStream/startBuildFlow/openBuildEventsStream + `listMcpV2Servers/addMcpV2Server` + 文件 API；认证 `x-api-key` 或 Bearer；`rejectIfHtmlMaskedAsOk` 检测 base_url 配错。**双向翻译**（`graph-translator.ts` 2342，真引擎；`cube-to-lf`/`lf-to-cube` 仅 9/10 行壳）：Cube→LF `cubeGraphToLfFlowData`（模板合并+动态字段注入+Agent 模型连接+CustomComponent DSL 编译）；LF→Cube `lfFlowDocumentToCubeGraph`。`normalizeLoadFromDbInlineLiteralsDeep` 把字面量 key 焊进 LF flow doc。**LF MCP 同步**：`lf-mcp-server-sync.ts` 推送前把 MCPTools 节点幂等 `POST /api/v2/mcp/servers` 注册进 LF；`lf-mcp-tool-options-enrich.ts` 填实时工具列表。`LANGFLOW_BASE_URL` 未配 → `lf=null`，LF 路径抛 `EXECUTION_UNAVAILABLE`。

## 5. DSL v2 编译

Schema 权威 `dsl-v2.schema.ts`（Zod）：控制流 `op`/`if`/`foreach`，`op.action ∈ {assign,http_request,json_parse,template_render,http,transform,message_merge,message_to_openai_content}`，递归 `conditionSchema`。`compile-v2.ts` → 生成 Langflow Component Python 源码；`workflow-emit-v2.ts` 发射 if/foreach Python；`operators.ts` 8 个 op 算子；`lf-template-from-dsl.ts` DSL→LF template；`dsl-to-cube-schema.ts`（`parseDslStrict` 检测 v1/v2）→ `CubeComponentSchemaV1`（设计器渲染）。黄金对齐 `lf-code-golden.ts` + 测试比对 `generated/cube-component-catalog.json`。

## 6. 本体模块细节

flows：`FlowsService` 门面；`/flows` CRUD + import/export + import-from-langflow；文件 BC；监控代理转 LF。components：catalog 读 JSON（缺则 503 提示 `bun run sync-components`）。playground：会话/消息 CRUD，`teeCubeSseWithPersistence` 边流边落库。webhook：`POST /webhook/:flowId` + 可选 HMAC，落 `webhook_invocations`。guardrails：`CUBE_GUARDRAIL_BLOCKLIST`/`_MAX_INPUT_CHARS`。observability：**纯内存环形缓冲**（`MAX_RECENT=2000`，进程级、不落库）。**mcp：`/mcp/tools-list` 探测外部 MCP**（StreamableHTTP/SSE），**flow 不暴露 MCP server**（grep `McpServer`/`setRequestHandler`/`registerTool`=0）。

## 7. 横切凭据源（ADR-0003 输入）

**(a) model-providers app_kv**（`settings/model-providers.controller.ts`）：存 `app_kv` key=`model_provider:{id}` value `{apiKey明文, orgId?}`；GET 用 `maskApiKey` 脱敏。⚠️ grep 实证 `model_provider:` 前缀**只**在该 controller，**服务端无路径注入 graph/engine** → 是 UI 侧 mini-catalog，值由前端复制进节点 config。退役风险低（无服务端耦合），需数据迁移到 catalog + 前端切 llm console。

**(b) 节点 config 焊 key（两消费点）**：① cube-linear-engine 读 `config['api_key']`；② graph-translator 把节点 config 的 `api_key`（SecretStr）写 LF 槽并置 `load_from_db:false` → **key 字面量焊进 LF flow doc**，随 patchFlow 落 LF。`api_key` 出现文件：cube-linear-engine、graph-translator、flow-langflow-sync.service、flows.controller、operators、langflow-client、db/sqlite、db/mysql-repositories。

## 8. 身份/租户注入点（D3 换源输入）

**注入式 seam（工厂+中间件，换源不动本体）**——`single.ts:28-36` 装配现场：

```28:36:/Users/dg/work-dg/cube-ai/redesign/cube-ai/server/flow/src/single.ts
  app.use(
    createExecutionAuthMiddleware({
      accessTokenReader: createFlowAccessTokenReader(),
      apiKeyReader: createFlowDeveloperApiKeyReader(),
      projectLookup: createFlowProjectLookup(),
    }),
  )
```

| Seam | 工厂（`auth/flow-auth-adapters.ts`） | 当前委托 | 换 host 源点 |
|---|---|---|---|
| `AccessTokenReader` | `createFlowAccessTokenReader()` | `flowRepo.verifyAccessToken` | host token reader |
| `DeveloperApiKeyReader` | `createFlowDeveloperApiKeyReader()` | `flowRepo.verifyApiKeyRaw` | host PAT reader |
| `ProjectLookup` | `createFlowProjectLookup()` | `projectRepo.listProjects/getProject` | host 租户目录 |

**本体只读身份符号**（`@cube-ai/server-shared`，ALS）：`currentProjectId()`、`isGlobalAccessEnabled()`、`developerApiAls`、`authenticatedUserAls`。消费本体文件（D3 改造面）：webhook.controller、observability、lf-sse-stream、flow-crud.service、api-keys.service、auth.service、users.controller、custom-component-templates.service、db/mysql-repositories。**flow 自持的源（最重收归项）**：`auth/auth.service.ts`（OAuth2 password/refresh 全套，落 `auth_users`/`oauth_*_tokens`）。

## 9. api-keys（签发/校验/grant）

`api-keys.service.ts` list/create/revoke，落 `api_keys` 表。字段：`project_id`(null=全局)、`key_hash`、`key_prefix`、`flow_id?`(绑定单 flow)、`scopes_json`、`allowed_tools_json`、`access_level`(project/system)、`expires_at`。签发 `randomApiKeySecret`+`hashApiKey`；校验经 `createFlowDeveloperApiKeyReader` seam。**三层授权**：① flow_id 限定可跑 flow；② scopes 限定操作；③ allowed_tools 在 `lf-sse-stream.ts:applyToolCallPolicy` 用 `developerApiAls.allowedTools` 在 SSE 流内拦 tool_call。**迁移**：认证收 host PAT；flow 只留 key→flows grant。

## 10. 双库

`shared-repositories.ts` 按 `config.localDev` 选 SQLite/MySQL；`repository-contracts.ts` 定义 `FlowRepository`/`ProjectRepository`。**16 张表**（SQLite `sqlite.ts` / MySQL `init_mysql.sql` 同构）：projects · flows · flow_graphs · playground_sessions · playground_messages · custom_component_templates · api_keys · auth_users · oauth_access_tokens · oauth_refresh_tokens · webhook_invocations · app_kv · **+4 assistant 残留**。迁移脚本 3 个。⚠️ **MySQL 实现真伪需核**：`mysql-repositories.ts`（1115，有实体）vs `shared-repositories.ts` 的 `MysqlFlowRepositoryPlaceholder` 对 assistant 方法+kv 标 `unsupported(...)`——须确认生产走哪条。

## 11. 独立 SSE 直达

`http/sse-response.ts` 标准 SSE 头；`cube-sse-enrich.ts` 注入 workflow_start/finished；`cube-sse-tap.ts` `teeCubeSseWithPersistence` 分流落库；`lf-sse-stream.ts` LF SSE→Cube 事件 + `applyToolCallPolicy`。直达入口：`run.controller.ts /run/:flowId`、playground messages、webhook（`stream=true` 返回 `createSseResponse`）。→ 独立 SSE 直达成立，与 engine 编排正交（ADR-0004 双消费）。

## 12. assistant 残留清单（迁移剔除，谨慎）

DB 4 表（`platform_assistant_sessions/messages`、`assistant_proposals`、`assistant_audit_log`）+ `repository-contracts` ~14 方法 + sqlite/mysql/placeholder 实现 + `flow-crud.service`（`ASSISTANT_VISIBLE_CONFIG_KEYS` 等）+ flow.module 导出注释 + test-helper `assistantHelpDocsPath`。⚠️ **`drainCubeSseAccumulateAssistant`/`onAssistantComplete` 服务 playground 落库（本体功能），仅命名带 assistant——应改名保留，非删除**。务必区分「玩具 assistant」与「playground bot 回复持久化」。

## 13. 测试现状

19 个 `*.test.ts` ≈5,174 LOC，`bun test`。最大：graph-translator 2760、dsl-v2 494、component-schema 339。**可离线子集 ≈ 全部**：SQLite 用内嵌 `bun:sqlite`、LF 测试 parse/mock、MCP mock 化。两项依赖构建产物 fixture（api-all/catalog JSON）。MySQL 仓储**无测试覆盖**。→ 强支撑「先 copy 跑绿、再逐处换源」。

## 14. 迁移风险与暗坑

1. **目标 ports 全缺**（grep `LlmProviderPort`/`modelRef`/`FlowInvokerPort`/`llm-core`=0），均 greenfield。
2. **MySQL 实现真伪**（mysql-repositories vs placeholder `unsupported`）必须确认。
3. **凭据三处散落**（节点 config + graph-translator 焊 LF + env），`normalizeLoadFromDbInlineLiteralsDeep` 把 key 焊进 LF doc，收归需清洗历史 flow doc。
4. **LF 自直连 vendor**（langflow-client 直传 key），ADR-0003 长期例外。
5. **assistant 残留贯穿 DB/服务/SSE 三层**，误删 playground 落库会伤本体。
6. **横切耦合方向**：auth.service 依赖 flowRepo；剥离时保留 `flow-auth-adapters` seam 形态、只换实现。
7. **observability 仅内存**（重启即失、不跨实例）。
8. **构建期产物依赖**（cube-component-catalog.json + api-all.json + sync-components），copy 须一并迁。

## 15. 开放问题

1. MySQL 仓储是否完整覆盖契约并被实际装配？`ensureBootstrapData` 在 MySQL 路径如何落？
2. 节点 config key → modelRef 软过渡期，历史 flow doc 焊死的字面量 key 如何批量清洗/回填 catalog？
3. `FlowInvokerPort` 与 flow「独立 SSE 直达」如何并存？engine 编排时 SSE 透传还是二次封装？
4. `api-all.json`/catalog 产物与 Langflow 版本耦合如何管理？
5. model-providers 退役切换：前端 llm console 接管前，节点 key 预填是否仍依赖 app_kv？
6. observability 内存 metrics 是否升级为持久化/OTel，还是交平台层统一观测？

## 16. 与 ADR 的需修正点

- ADR-0004/0006 称 flow「对外 MCP server / 暴露 MCP tools」**不准确**：flow 没有 MCP server（grep=0），其 mcp 是 **MCP 客户端 + 把 MCP 配置同步进 Langflow**。M4/ADR 措辞需据此修正（见 M4 文档与计划 README 的「待回填 ADR 修正」）。
