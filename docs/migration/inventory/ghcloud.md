# Inventory · ghcloud AI 逻辑

> 勘察来源：只读 subagent（agent-id `8175a9ca`）实读 `ghcloud/prod/cube-services/*` 与 `ghcloud/prod/cube/apps/ai-application/*`（`src/*.ts` 非编译产物）。本文是迁移计划 M1(catalog 迁入)/M6(platform-adapter + ai-server 退役 + 数据迁移) 的事实地基。

## 1. 概览

| 包 | 路径 | 角色 | 规模 |
|---|---|---|---|
| `@ghcloud/ai-server` | `cube-services/ai-server` | **唯一可部署进程**：HTTP(3100)+gRPC(3110) 组合根/宿主 | 6 src + Dockerfile |
| `@ghcloud/ai-application` | `cube-services/ai-application` | **全部 AI 业务逻辑**（catalog/flow/kb/agent），lib，被 ai-server 装配 | 86 src |
| `@ghcloud/ai-server-base` | `cube-services/ai-server-base` | 横切库：**security（鉴权/租户）** + nacos + grpc client + config | 30 src |
| `@ghcloud/ai-application-grpc-gen` | `cube-services/ai-application-grpc-gen` | buf 生成物：FlowService 契约 + cube2 平台 client | 18 gen |
| `@ghcloud/cube-ai-application-service` | `cube/apps/ai-application/service` | **gateway façade**（前端 SDK，published 到 nexus） | 3 src |
| ai-application 前端 | `cube/apps/ai-application/app` | qiankun 子应用 | vite app |

**一句话定性**：ai-application **本身不执行 AI**——它是「**编排/投影 + 控制面**」：自有编辑器模型 + catalog + 持久化（MySQL `cube_base_ai_application`），把流程**编译成 cube-ai 的 DSL v2 并推送**，再**转发执行/检索到 cube-ai**。真正 flow/kb/向量运行时在 cube-ai/Langflow。运行时依赖：MySQL、Nacos、RocketMQ、cube2 平台 gRPC(ouaa/dictionary/content/file)、cube-ai HTTP、鉴权中心(JWT 公钥)。

## 2. ai-server（退役判定）

实际职责（比「health+gRPC 壳」多，是组合根/宿主）：`main.ts` 装中间件链 `requestLogging→SessionContext→JwtAuth(公钥来自 jwtKeyUrl)→TenantValidation`+listen+`startFlowGrpcServer()`；`app.module.ts` Config/Logger/Database(MySQL)/ServiceRegistry(nacos)/AiApplicationModule/Swagger；`grpc/flow-grpc-server.ts` 暴露 `FlowServiceGrpc`(runFlow/runFlowStream)；`compile-runtime.ts` `Bun.SQL` 垫片。

**可退役 ✅，但拆分去向**：进程宿主→`apps/ai-center`；**安全中间件**（`createJwtAuthMiddleware`+`createTenantValidationMiddleware`+`createSessionContextMiddleware`，来自 ai-server-base）→**`platform-adapter-ghcloud` 种子（不能丢，§8）**；gRPC FlowService 壳→随 cube-ai 收编退役（§9）。部署单元 = ai-server（唯一 Dockerfile，`build:pkg` 单二进制）。

## 3. ai-application 模块全景表

| 模块/符号 | 路由 | 类别 | 处置 | 关键文件 |
|---|---|---|---|---|
| `LlmCatalogController/Service`+`LlmCatalogProvisioningService`+`LlmTypeAdapterService`+`ModelMetadataInferenceService`+`llm-wire-adapter/*` | `/ai/llm/*` | **catalog** | **收编→`llm-core` catalog BC**（凭据权威，§4） | llm-catalog*.ts、llm-type-adapter.service.ts、model-metadata-inference.service.ts、llm-schema.ts、orm/{system,tenant}-llm-* |
| `FlowController/Service`+`FlowComponentService`+`flow-runtime-mapper` | `/ai/flows/*` | **flow** | **退役/被取代**：编译+DSL 投影由 flow-core DSL v2 承担（§5） | flow.service.ts(2428)、flow-runtime-mapper.ts(2254) |
| `KnowledgeDocument/QueryController`+services | `/ai/knowledge/*` | **kb** | **收编→kb-core**；现状仅 mapping+转发（§6） | knowledge-*.controller、knowledge-document*.service |
| `AiAgentController/Service` | `/ai/agent/*` | **其它(agent)** | **退役**：薄壳（命名+绑 cube-ai flow+转发 run），非真 agent | ai-agent.service.ts |
| `FlowGrpcServiceImpl` | gRPC | flow(gRPC) | 退役（§9） | flow-grpc.service.ts |
| `TenantProjectService`+`TenantProjectSyncService` | — | 平台胶水 | **退役**：为每租户在 cube-ai 远程建 project+API key；收编进程内化即消失 | tenant-project*.ts |
| `TenantInitMqRunner`+`LlmCatalogSyncMqRunner` | RocketMQ | 平台胶水 | 按需保留为 adapter | mq/*.runner.ts |
| `Cube2GrpcClientFactory`+`AiCenterClientFactory`+`AiCenterSystemConfigProvider` | — | 平台/远程客户端 | cube2 gRPC 保留为 platform adapter；ai-center client 退役 | grpc/cube2-grpc-client.factory.ts |

## 4. llm-catalog 深挖（llm-core catalog 迁移来源，最重点）

**最有价值资产 + 凭据单一权威真实来源**。两层模型：系统模板 → 租户副本（租户副本持凭据）。库 `cube_base_ai_application`。

**系统层（seed）**：`ai_system_llm_provider_type`(code/display_name/sort/enabled)、`ai_system_llm_provider`(provider_code/type_code/name/icon)、`ai_system_llm_model`(model_code/display_name/api_base_url/`endpoint_type`/`model_types`CSV/is_free/supports_test)、`ai_system_llm_model_match_rule`(match_type exact/prefix/contains/regex、pattern、native_family、`endpoint_type`、`adapter_key`、`request_schema_json`/`response_schema_json`/`dsl_schema_json`、model_types、priority — **模型自动分类/元数据推断规则表**)。

**租户层（per-tenant + 凭据）**：`ai_application_tenant_llm_provider`(tenant:number、system_provider_id?、provider_code、type_code、name、**`api_key`(nullable ← vendor 凭据)**、api_base_url、enabled、is_custom)、`ai_application_tenant_llm_model`(tenant、tenant_provider_id、system_model_id?、model_code、endpoint_type、request/response/dsl schema_json、model_types、is_free、supports_test)。

**Schema 类型**（`llm-schema.ts`）：`LlmRequestSchema.requestShape ∈ openai_chat_compatible/dashscope_multimodal_generation/openai_images_generation`；`LlmResponseSchema.responseShape ∈ dashscope_async_image_task/...`（含 polling）；`LlmDslSchema.nodeKind ∈ language_model/image_generation`。`endpointType` 枚举：openai/openai_response/dashscope_text2image/anthropic/gemini/azure_openai/new_api/openai_image/jina_rerank/volcengine_ark/geekai。

**凭据存储（ADR-0003 收口目标）**：

```46:67:/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-application/src/infrastructure/orm/tenant-llm-provider.entity.ts
  @Column()
  tenant!: number
  @Column({ nullable: true })
  api_key!: string | null
```

- vendor key = `ai_application_tenant_llm_provider.api_key`（明文列，per-tenant）。读路径 `maskProviderApiKey()` 脱敏；但 **`getModelRuntimeConfig()` 返回原文 key**（`llm-catalog.service.ts:712`），出口 `GET /ai/llm/providers/:id/models/:modelCode/runtime-config`——**运行时凭据解析出口**（agent-engine catalog adapter 正是消费此端点）。

**逻辑（迁移工作量远超「一张表」）**：Provider/Model CRUD（`listProviders` 首访空租户**懒触发** provisioning）；**连通测试** `testConnection/testModel`→`LlmTypeAdapterService`(6 类 adapter OpenAiCompatible/Azure/Anthropic/Gemini/Ollama/Dashscope 直连 vendor)；**远程同步** fetchRemoteModels→adapter fetchModels→`ModelMetadataInferenceService.inferRemoteModels` 富化→upsert；**provisioning** `syncTenantCatalog` 把系统模板复制成租户副本(api_key=null,enabled=false)（懒加载 + RocketMQ 触发）；**元数据推断** match rule + system-model 命中 + 启发式 fallback 推断 modelTypes(reasoning/vision/embedding/rerank/image_generation/...)+nativeFamily+`adapterKey`；**wire-adapter 注册表**（`encodeRequest`，⚠️ **生产路径无调用方、仅测试调用**——真实 wire 逻辑被烤进 flow 生成的 DSL v2 Python，§5）。

## 5. flow compile/DSL 映射（与 cube-ai DSL v2 的重复/取代）

`flow.service.ts`+`flow-runtime-mapper.ts` 是重量级「自有编辑器图→cube-ai 运行时图+DSL v2」**编译器+远程转发器**，**不自执行**。编译链：editorFlowJson→`buildCompiledFlow`→`buildCubeFlowGraph`→cube-ai `cube.lf.*` 节点+语义边；`expandEditorFlowForCubeAi` 为 smart-router/agent 注入伴侣 LLM 节点 + agent 注入 MCP 节点 + multimodal-merge；`flow-runtime-mapper` 把 language-model/image-generation/knowledge-retrieval/multimodal-merge 节点**生成内联 `cube_dsl`（cube-ai DSL v2，大段嵌入式 Python）**。租户端点解析 `resolveLanguageModelRuntimeForModelId` 读 catalog 把 chat_url/api_key/model_code **烤进推送 cube-ai 的节点 config**（占位符 sync 时填真值）。同步经 `AiCenterClient` 对租户 cube-ai 项目 createFlow/updateFlow+createCustomComponentTemplate。执行/监控 `runFlow/runFlowStream/debugFlow/getFlowMonitor*` **全转发 cube-ai**。

**= 严重重复**：cube-ai flow 已自带 DSL v2（`custom-component/`）。ai-application 是**第二个 DSL v2 作者**。收编后 flow-core 原生 DSL v2 承担，**整层投影/转发消失**。持久化表 `ai_application_flow*`。engine→flow 调用边：

```122:129:/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-application/src/controllers/flow.controller.ts
    const engineCaller = ctx.getHeader('x-engine-caller')
    if (engineCaller === 'cube-agentic-engine') {
      return this.flowService.runFlowForEngine(flowId, body)
    }
    return this.flowService.runFlow(flowId, body)
```

`runFlowForEngine` 返回 `{scheduled,jobId,statusUrl:/v1/jobs/...}` 异步 job 信封。

## 6. kb 转发层

`knowledge-document.service.ts` = **纯 mapping+转发到 cube-ai，无向量/embedding/chunk 逻辑**。所有操作经 `AiCenterClient`(upload/delete/listChunks/preview/updateChunk/searchByDocuments)。自有持久化仅两映射表 `ai_application_knowledge_{document,directory}_mapping`(biz_id↔ai_center_id)。**源文件桥**（`knowledge-document-source.service.ts`）：经 cube2 gRPC 从 cube 平台知识库取原始文档再上传进 cube-ai（链路 cube 平台 KB(Java)→ai-application→cube-ai KB）。`/ai/knowledge/query` 转发 searchByDocuments+score 过滤。**处置**：收编后 kb-core 持 chunk/向量/检索，转发层塌缩；唯一保留「从平台取源文档」桥→platform-adapter。

## 7. gateway façade（退役）

`@ghcloud/cube-ai-application-service`（vite 库，published nexus）= 纯 HTTP 客户端 SDK，经 `CubeGateway` 打 `${BASE_API}/aiApplication/ai/llm|flows|knowledge/...`，与 ai-application 控制器 1:1。前端 `new CubeAiApplicationService(authStore)` 经 `GatewayProxy.createProxiedInstance`（**ADR-0008 要退役的 gateway façade**）。bff-gw（`cube-services/gateway`）控制器仅 ouaa/auth/dictionary/video-monitor/metadata/safety——**无 AI 控制器**（印证 ADR-0009「bff-gw 只承载非 AI 流量」）。处置：退役，拆 `llm-sdk-console`/`flow-sdk-{client,console}`/`kb-sdk-{client,console}`，单 origin 领域路由。

## 8. 身份/租户解析（→ platform-adapter-ghcloud）

保留项落点 = `ai-server-base/src/security/*` + `grpc/connect-handler-session.ts` + ai-server main.ts 接线。

| 职责 | 文件 | 符号 |
|---|---|---|
| 会话上下文（header 取 tenant/authorization/domain/terminal 存 ALS） | `security/session-context.ts`(+middleware) | `SessionContextHolder`、`createSessionContextMiddleware` |
| **token 校验**（Bearer JWT RS256，公钥来自 `jwtKeyUrl`→鉴权中心；payload→principal{id,type,admin,name}） | `security/jwt-auth.middleware.ts`+`jwt-key-loader.ts`+`jwt-crypto.ts` | `createJwtAuthMiddleware`、`verifyJwtRs256`、`securityContextHolder` |
| **租户授权**（header tenant ∈ JWT tenants[]，否则 401） | `security/tenant-validation.middleware.ts` | `createTenantValidationMiddleware` |
| gRPC 同源身份（connect metadata 建同一 SessionContext + 内部签名校验） | `grpc/connect-handler-session.ts` | `buildSessionContextFromConnectHeaders`、`validateConnectInnerInvoke` |

租户是中枢身份原语（每个 AI service 都 `sessionContextHolder.getContext()?.tenant`）。jwtKeyUrl 实证：`ai-server/config/app.json`→`http://192.168.0.133:4009/oauth2/jwt.key`。**恰是 ADR-0009「ghcloud 退化为薄平台 adapter：仅鉴权/租户，实现平台身份 port」**——收编时把 cube-ai 现状身份源（flow 的 reader/lookup）的注入源换成此 adapter，三域本体不改。

## 9. gRPC（grpc-gen 去留）

`@ghcloud/ai-application-grpc-gen`（buf，`@bufbuild/protobuf`+`@connectrpc/connect`）。导出两类：**AI 自有契约** `FlowServiceGrpc`（RunFlow/RunFlowStream）→ **退役**（engine→flow 收编后走进程内 `FlowInvokerPort`）；**平台 client 契约**（OUAA TenantService、File FileCore/Ref/Operate、SysDictionary、content KnowledgeBaseService）→ **保留**（platform-adapter 访问 cube2 的通道）。建议拆「AI 契约（退役）」与「平台 client（留 adapter）」。

## 10. 深相对 import 泄漏点（ADR-0008 消除）

`grep '../../../../'` 命中**全在前端** `cube/apps/ai-application/app/`（戳兄弟应用 knowledge-document）：`app/src/api/service.ts:4`（运行时 `../../../../knowledge-document/service/src/service`，正是 ADR-0008 点名的）；3 个 views 的 type import。**后端 ai-application 内部无深相对 import**（均走 workspace `@ghcloud/*`）。处置：新前端不携带，改走 `kb-sdk-*`。

## 11. 凭据散落点（ADR-0003 收归输入）

| # | 位置 | 凭据 | 形态 |
|---|---|---|---|
| 1 | `ai_application_tenant_llm_provider.api_key` | **vendor key**(per-tenant) | MySQL 明文列（**→llm-core catalog**） |
| 2 | `llm-catalog.service.ts:712` getModelRuntimeConfig | vendor key 原文出口 | `/runtime-config` 返回 |
| 3 | `flow.service.ts`/`flow-runtime-mapper.ts`(api_key/secret_str DSL) | vendor key 烤进 cube-ai DSL 节点 | 推送 graph |
| 4 | `llm-type-adapter.service.ts` | vendor key（连通测试） | 直连 vendor |
| 5 | `llm-wire-adapter/adapters/*` | vendor key | 仅测试路径活跃 |
| 6 | `ai_application_tenant_project.ai_center_api_key` | **cube-ai 项目 API key**（第二类凭据） | MySQL 明文列 |
| 7 | `ai-center-system-config.provider.ts` | **cube-ai 系统主 key+baseUrl** | 来自 cube2 dictionary gRPC |
| 8 | `app.config.ts` internalInvokeSecretKey/ouaaRegistrationClientSecret | 内部 RPC 签名/OUAA | env/config |
| 9 | `config/app.json` mysqlPassword（明文） | DB 口令 | ⚠️ 明文部署配置 |

**关键**：ghcloud 持**两类 AI 凭据**——vendor key（→llm-core）+ cube-ai 项目 key（`ai_center_api_key`，远程拆分产物，收编后**删除**不是迁移）。

## 12. 依赖/部署/调用链（几跳）

部署：唯一 Dockerfile(ai-server)，`bun build --compile` 单二进制，PORT 3100/GRPC 3110。运行依赖 MySQL/Nacos/RocketMQ(可选)/cube2 gRPC/cube-ai HTTP/鉴权中心。**调用链（ADR-0009 要消除的多跳）**：前端→flow 执行 ≈4–5 跳（Frontend→CubeGateway→`/aiApplication/...`→ai-server→ai-application→cube-ai→Langflow）；engine→flow（cube-agentic-engine→ai-application HTTP `x-engine-caller` 或 gRPC→cube-ai→Langflow）；ai-application→cube2（Nacos gRPC ouaa/dictionary/content/file）；平台→ai-application（RocketMQ 租户初始化/catalog 同步）。收编目标（4 跳→1 跳）：Frontend→ai-center（进程内 agent/flow/kb/llm），ghcloud 退旁路只做鉴权。

## 13. 迁移风险与暗坑

1. **flow 不是引擎、是投影器**：迁移价值在「flow-core DSL v2 是否覆盖 ai-application 的 cube.lf.* 语义」——伴侣节点注入(smart-router/agent/MCP)、multimodal-merge、knowledge-retrieval DSL、`enable_thinking` 透传、smart-router routes 补行。不等价则功能回退（M4/数据迁移须逐项对表）。
2. **DSL v2 双源 + 内嵌 Python**：合并须确认以哪边 DSL v2 为准。
3. **凭据双类、一类删不是迁**：vendor key→catalog（迁）；cube-ai 项目 key→收编后**删除**。
4. **wire 知识双份**：注册表 encodeRequest（生产无调用）vs DSL Python（真逻辑）。迁 llm-core 须二选一/合一，否则迁死代码或漏真逻辑。
5. **catalog 富逻辑易低估**（match-rule+11 endpointType+6 连通 adapter+schema 描述符+两层 provisioning）。
6. **租户隔离贯穿一切**：HTTP+gRPC 两条上下文构建都要接新 platform port，漏 gRPC 路径丢租户。
7. **平台耦合是硬依赖**：cube-ai 系统配置藏 cube2 dictionary、源文档在 cube2 content/file——收编后仍需 platform-adapter 经 gRPC，**保留别连根拔**。
8. RocketMQ 事件契约（租户初始化/catalog 同步）去留待定。
9. ai-agent 退役但有数据（`ai_application_agent` 表绑 cube-ai flow_id）。
10. app.json 明文口令，复制仓勿带入版本库。

## 14. 开放问题

1. flow-core DSL v2 是否已覆盖 ai-application 全部 cube.lf.* 编译语义（逐项对表）？
2. `runtime-config` 端点消费者是谁？决定 catalog BC 是否仍需「解析原文 key」出口，还是改 `LlmProviderPort` 进程内解析。
3. engine→flow 真实协议（HTTP `x-engine-caller` 还是 gRPC）？决定 gRPC 契约能否直接退役。
4. cube-ai 收编范围：远程 project+ai-center-sdk+tenant_project 是否 100% 删除还是过渡期双写？
5. wire 逻辑归一（注册表 vs DSL 生成器）。
6. RocketMQ 事件改平台身份 port 主动拉取还是保留 MQ adapter？
7. 数据迁移：`ai_system_llm_*`/`ai_application_tenant_llm_*`→llm-core catalog 一次性脚本（含 system_model_id/match_rule 关联保真）。
8. `knowledge-document`（cube 平台子应用）边界：新前端 kb 文档来源走哪个 SDK/服务？
