# 前端 ai-application/app → 本仓库 SDK 迁移可行性排查

> 日期：2026-06-09（v2，已修正框定）
> 范围：以**前端** `ghcloud/prod/cube/apps/ai-application/app`（qiankun 子应用，x6 流程编辑器 + 模型管理 + 知识 + assistant）为消费方基准，排查本仓库（cube-ai-project）现有 SDK 家族能否 **0 成本迁移**承接其全部要求。
> 结论一句话：**不能 0 成本迁移**。后端 AI 引擎能力（flow 执行 / kb / llm catalog）确已并入本仓库；但 ① 新 SDK 仍是冒烟壳；② 前端 **flow-editor 消费的是已退役的 editor-model 契约**（`editorFlowJson`/componentKey + validate/debug/publish），与 flow-core 原生 `CubeFlowGraph` 模型不一致——这是硬阻断，需评估重写风险。

---

## 0. 框定修正（重要）

- **后端投影层不是缺口，是设计性退役。** 见 [`inventory/ghcloud.md`](inventory/ghcloud.md)：ai-application **后端本身不执行 AI**，是「编排/投影 + 控制面」「**第二个 DSL v2 作者**」，「**收编后 flow-core 原生 DSL v2 承担，整层投影/转发消失**」。因此 ai-application 后端的 `FlowService` 编译器/生命周期**不需要迁入**。
- **真正的迁移对象是前端 `app`。** 它经 gateway façade SDK 消费 ai-application 的 `/ai/*` 控制面 API。问题是：本仓库的 SDK 家族能否承接前端这些调用。

---

## 1. 前端消费面（要求集）

前端 `app/src/api/service.ts` 经两个 façade：
- `@ghcloud/cube-ai-application-service`（`CubeAiApplicationService`，与 `/ai/*` 控制器 1:1，**ADR-0008 要退役的 gateway façade**）
- `CubeKnowledgeDocumentService`（深相对 import，平台 KB）

实际调用方法（按前端模块归类）：

| 前端模块 | 调用方法 | 后端归属 |
|---|---|---|
| **flow-editor / flow-list** | `listFlows` `listFlowsPage` `getFlow` `createFlow` `saveFlow` `deleteFlow` `validateFlow` `debugFlow` `publishFlow` `uploadFlowFile` `listFlowComponents` | ai-application **editor 模型**（`editorFlowJson`/componentKey） |
| **model-management** | `listProviderTypes` `listEndpointTypes` `listProviders` `getProvider` `createProvider` `updateProvider` `deleteProvider` `updateProviderSettings` `testModelConnection` `listModelGroups` `createModel` `updateModel` `deleteModel` `previewRemoteModels` `importRemoteModels` `listTenantModels` | llm catalog 管理 |
| **knowledge-document / segmentation / retrieval-test** | `segmentKnowledgeDocument` `previewKnowledgeDocumentSegments` `updateKnowledgeDocumentSegment` `testKnowledgeDocumentRetrieval` + `getKnowledgeDocumentList` `getKnowledgeTypeTreeList` `getKnowledgeDocumentDetails` `switchKnowledgeDocumentStatus` | kb-core（chunk/search）+ 平台 KB(cube2 content) |
| **assistant**（对话/agentic：grants 同意、token 用量、生成图、模型菜单、多模态） | agentic engine 会话/turn/工具/授权（非上面 façade） | agent-engine |

---

## 2. 本仓库 SDK 承接度（按前端模块）

| 前端模块 | 本仓库对应 | 0 成本？ | 成本/风险 |
|---|---|---|---|
| **assistant** | `agent-sdk-client`（session/tools/jobs/grants/files，8 方法）**基本覆盖** | 接近 | 低-中：需核对 SSE turn 流式、token 用量、生成媒体(图)、模型菜单契约 |
| **model-management** | 后端 `llm-catalog-admin` **19 路由全等**；`llm-sdk-console` 仅 2 方法 | 否 | **低**：补 SDK 一层即可 |
| **knowledge** | `kb-core`（documents/chunks/search/directories）+ 已迁 `cube2-content-client` 桥；`kb-sdk-*` 薄 | 否 | **中低**：补 SDK + segment↔chunk/bizId 语义适配 |
| **flow-editor / flow-list** | flow-core 只认 `CubeFlowGraph` 原生模型；无 `validateFlow/debugFlow/publishFlow`、无 editor 契约、`listFlowComponents` 组件模型不同 | **否（硬阻断）** | **高**：需评估前端重写到原生模型的可行性与 1:1 能力还原（见 §3） |

---

## 3. flow-editor 硬阻断：editor 模型 vs 原生模型

ai-application 的编辑器是**高层抽象编辑器**：画布节点是 componentKey（`agent`/`smart-router`/`language-model`/`image-generation`/`knowledge-retrieval`/`chat-input`…），保存时由后端 `FlowService` **编译**成 cube.lf.* 图（`CubeFlowGraph`）：
- 伴侣语言模型节点注入（smart-router / agent）
- agent 的 MCP 合成节点注入
- 多模态消息合并节点展开（vision LM）
- 语义端口 `cube.sp/i|o/...` 生成
- smart-router 路由最小行补齐
- 租户模型→运行时 URL 解析 + custom-component-template DSL upsert

flow-core 原生模型是**低层 cube.lf.* 全图**：前端若直接面向它，需要么在编辑器侧重建这些"展开/抽象"，要么由 flow-core 提供等价能力。**这正是迁移价值与风险的核心**（inventory 亦点名：flow-core DSL v2 是否覆盖 ai-application 全部 cube.lf.* 编译语义需逐项对表）。

### 3.1 grill 裁决（2026-06-09）

| 决策 | 结论 |
|---|---|
| **路径** | **B 复刻最快路径**：从原仓直接复刻 editor 模型+编译器+生命周期；后续再优化下沉到 C（原生组件）。**临时偏离** `CONTEXT.md`「避免 DSL 映射层」，北极星仍是 C |
| **落点** | **独立新包 `packages/flow/studio`**（编排/投影+控制面）+ 自带 `flow_studio_*` 等价表；**flow-core 保持干净** |
| **运行时解析换源** | studio **直接读 llm-core catalog 仓储/admin service**（按 tenant+modelId 取全字段实体：endpointType/apiBaseUrl/apiKey/dslSchema/request·response schema/modelTypes），原样复刻解析逻辑；**不改 llm-core**、不走 thin `LlmCatalogPort` |
| **编译产物兼容** | flow-core 的 `CubeFlowGraph{lfNodeId,cubeType,sourcePort,targetPort,schemaVersion=1}` + DSL v2 actions(`message_merge`…) 与 ai-application 编译器产物**字段级同构**（flow-core 就是当年对接的 cube-ai 迁入版）→ **1:1 风险低**。兜底：建 **golden 兼容性对表测试**（agent/smart-router/多模态/文生图/knowledge-retrieval 各一例，断言 flow-core `custom-component-templates/validate`+`flows import/PUT` 接受） |
| **前端** | **留在 ghcloud（qiankun `app`），不复刻不迁移**；仅把 SDK 由 gateway façade 换成本仓库领域 SDK |
| **model-management** | 不复刻；ghcloud 前端直接接本仓库 `llm-sdk-console`（后端 `llm-catalog-admin` 19 路由全等）；补 SDK 方法面 + 对齐 DTO |
| **KB** | 不复刻；分段/检索 = kb-core 原生（**segment=chunk 1:1 语义**），前端走 `kb-sdk-*` 接 kb-core；**平台库浏览（list/tree/detail/status）仍前端直连 cube2**（属平台 KB 域，非 AI 中台；现 `cube2-content` 桥只覆盖 import 取源） |
| **assistant** | 已由 `agent-sdk-client`（session/turn/grants/tools/files）覆盖；仅核对 SSE turn/token 用量/生成媒体/模型菜单契约 |
| **智能体 CRUD** | 本前端无此视图 → **不做** |

### 3.2 flow-editor 1:1 还原风险结论

**可 1:1 还原，整体中等风险**——因为是"复刻同一套编译器"，其产物本就被同一后端（flow-core 的前身 cube-ai）接受：
- **低**：编译产物契约（字段级同构 + golden 对表兜底）。
- **中**：复刻体量（~2400 行编译器 + 生命周期 + 4 等价表）；catalog 换源接线；前端 SDK/DTO 契约对齐（前端原期望 gateway façade 的 DTO 形状，新 SDK 需对齐或前端微调）。
- **逐项对表清单**（golden 覆盖）：componentKey→cube.lf.* 映射、伴侣 LLM 注入(smart-router/agent)、agent+MCP 合成节点、多模态 message-merge、语义端口 `cube.sp/...`、smart-router routes 补行、knowledge-retrieval DSL、custom-component-template DSL upsert(OpenAI/Azure/文生图)、`enable_thinking` 透传。

---

## 4. 结论与下一步

1. **0 成本？否。** 后端引擎已并入；前端 flow-editor 依赖的 editor-model 控制面需在本仓库**复刻为 studio 后端层**（临时偏离词条，北极星 C）；model-management/KB 仅"接新 SDK"，前端留 ghcloud。
2. **成本分层**：
   - **硬复刻（中）**：`packages/flow/studio`（editor 模型+编译器+生命周期+4 表）+ `flow-sdk` 暴露 editor-model API + golden 对表测试。
   - **低**：补 `llm-sdk-console`（+~16 方法）、`kb-sdk-*`（+~10 方法）；ghcloud 前端换 SDK import。
   - **不做**：智能体 CRUD；KB 映射层；平台库浏览（留 cube2）。
3. **下一步**：① 是否就"临时投影层（studio）偏离 CONTEXT.md"落一条 ADR（记录 B→C 北极星）；② 排 studio 复刻 + golden 对表的实现计划（WS 模式）。
