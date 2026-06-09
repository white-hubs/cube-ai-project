# ADR-0014: flow-editor 投影层临时复刻为 `packages/flow/studio`（B→C 北极星）

- **Status**: Accepted
- **Date**: 2026-06-09
- **Deciders**: 架构组（用户裁决「本期走最快路径，从原仓直接复刻，后续再优化」；经 `/grill-with-docs` 逐项确认）
- **Tags**: flow, flow-editor, dsl-compile, projection-layer, frontend-seam, ai-application, migration, temporary-deviation

## Context

ghcloud 前端 `cube/apps/ai-application/app`（qiankun 子应用，x6 流程编辑器）经 gateway façade `@ghcloud/cube-ai-application-service` 消费 ai-application 后端的 `/ai/flows` **editor-model 控制面**：以 `editorFlowJson`（高层 `componentKey` 画布：`agent`/`smart-router`/`language-model`/`image-generation`/`knowledge-retrieval`/`chat-input`）为创作模型，保存时由后端 `FlowService`（~2400 行）**编译**成 cube.lf.* 的 `CubeFlowGraph` 再推送给 cube-ai。编译期承担：伴侣语言模型节点注入（smart-router/agent）、agent 的 MCP 合成节点、多模态 message-merge 展开、语义端口 `cube.sp/...`、smart-router routes 补行、租户模型→运行时 URL 解析 + custom-component-template DSL upsert、校验、draft/compiled/linked/published 生命周期、资源引用追踪、发布快照。

收编后，本仓库已迁入的是 cube-ai **引擎侧**：`flow-core` 直接以**已编译的 `CubeFlowGraph`（schemaVersion=1）** 为输入，并自带 DSL v2 custom-component（含 `message_merge` 算子）+ custom-component-templates 控制器。**但 ai-application 的"高层 componentKey 编辑器 → cube.lf.* 图"投影/编译层在本仓库无等价物**。

`CONTEXT.md` 现有领域语言明确排斥这层：
- 「**Flow 运行时**」 _Avoid_: `ghcloud flow.service, DSL 映射层`
- 「**DSL 编译**」 _Avoid_: `ghcloud DSL 映射层, 跨 cube-ai/ghcloud 切两半的编译`
- inventory 定性：ai-application 是「**第二个 DSL v2 作者**」「收编后 flow-core 原生 DSL v2 承担、整层投影/转发消失」。

即**目标态（北极星 C）= 不存在独立投影层，高层抽象下沉为 flow-core 原生组件/模板，编辑器直接编排原生组件**。但 C 需要把伴侣注入/多模态合并/补行等做成 flow-core 原生能力 + 新编辑器，工作量大、本期不具备条件。

## Decision

### D1 — 本期走 B（复刻），北极星仍是 C

本期**直接从原仓复刻** ai-application 的 editor 模型 + 编译器 + 生命周期，以最快路径让前端 flow-editor 在新栈跑通。**这是对 `CONTEXT.md`「避免 DSL 映射层」与 inventory「投影层消失」的有意、临时偏离**；**不修改 `CONTEXT.md` 目标语言**——目标态依旧是 C。

### D2 — 落点：独立包 `packages/flow/studio`，flow-core 保持干净

- 复刻物落 **`packages/flow/studio`**（"flow 编排/投影 + 控制面"），自带等价持久化表（`flow_studio_*`，对应原 `ai_application_flow` / `*_resource_ref` / `*_release`）。
- **禁止**把投影/编译/生命周期塞进 `flow-core`——能力核须保持「无映射层」，以便后续 C 下沉时 studio 可整体优化/删除而不伤 flow-core。
- `flow-sdk-{client,console}` 暴露 **editor-model API**（`editorFlowJson` 的 create/save/validate/debug/publish/listFlowComponents/listFlowsPage/uploadFlowFile/monitor），由 studio 后端承载，供 ghcloud 前端原地接入。

### D3 — 横切换源：不复制已收编的权威

复刻须把原仓的本地横切**换源**到本仓库既有权威，**不得**在 studio 重建第二份：
- **运行时模型解析**：studio **直接读 `llm-core` catalog 仓储/admin service**（按 `tenant`+`modelId` 取全字段实体：endpointType / apiBaseUrl / apiKey / dslSchema(nodeKind) / request·response schema / modelTypes / typeCode），原样复刻 `resolveLanguageModelRuntimeForModelId` / `resolveImageGenerationRuntimeForModelId`；**不改 llm-core**、不走 thin `LlmCatalogPort`（其字段不足）。
- **身份/租户**：经 host `platform-adapter-ghcloud` 注入（ADR-0012），studio 不自管鉴权。
- **执行/检索**：经 `flow-core`（推 `CubeFlowGraph` + custom-component-templates）与 `kb-core`，studio 不内嵌引擎。

### D4 — 1:1 兼容兜底：golden 对表测试

编译产物与 flow-core 契约**字段级同构**（`CubeFlowNode{lfNodeId,cubeType}` / `CubeFlowEdge{sourcePort,targetPort}` / `schemaVersion=1` / DSL v2 `message_merge` 等——flow-core 即 ai-application 当年对接的 cube-ai 迁入版），故 1:1 风险低。但**须建 golden 兼容性对表测试**：取 `agent` / `smart-router` / 多模态 / 文生图 / `knowledge-retrieval` 各一例 editorFlowJson，跑 studio 编译器，断言产物经 flow-core `custom-component-templates/validate` + `flows import|PUT` 被接受；不等价处 fix-forward。

### D5 — 范围边界（本期）

- **复刻**：仅 flow-editor 投影层（studio）+ `flow-sdk` editor-model 面。
- **不复刻**：model-management（ghcloud 前端直接接本仓库 `llm-sdk-console`，后端 `llm-catalog-admin` 已全等）；KB 分段/检索（= `kb-core` 原生，**segment=chunk 1:1 语义**，前端走 `kb-sdk-*`）；**智能体(Agent) CRUD**（本前端无此视图）。
- **平台库浏览**（list/tree/detail/status）属 cube **平台** KB 域、非 AI 中台——**前端仍直连 cube2**；现 `cube2-content` 桥只覆盖 import 取源。
- **前端**：留在 ghcloud（不复刻、不迁移），仅把 SDK 由 gateway façade 换成本仓库领域 SDK。

## Consequences

- **Positive**：前端 flow-editor 以最快路径在新栈跑通；编译语义 1:1 复刻 + golden 护栏，回归功能不丢；投影层隔离在 studio，能力核 `flow-core` 不被污染，C 下沉路径开放。
- **Negative**：本仓库**临时**存在一层被目标语言排斥的"第二 DSL 作者"；studio 复刻体量大（~2400 行编译器 + 生命周期 + 等价表）；前端原期望 gateway façade 的 DTO 形状，`flow-sdk` 须对齐或前端微调。
- **Neutral**：studio 表 fresh-start 空起（与 ADR-0010/数据迁移决策一致）；C 下沉为独立后续议题（届时 studio 整体优化/删除）。

## Options Considered

- **A 低层原生编辑器**（前端直编 cube.lf.*，弃高层抽象）：符合词条、最省，但**非 1:1**（用户失去 agent/smart-router 自动伴侣等 UX）。**否**——本期要 1:1。
- **C 高层抽象下沉为 flow-core 原生组件**（北极星）：既 1:1 又无独立投影层，但需重做 flow-core 原生能力 + 新编辑器，本期不具备条件。**推迟**为目标态。
- **B 复刻投影层（本 ADR）**：1:1 最快，代价是临时偏离词条。**采纳（本期）**。
- **塞进 flow-core**：最省事但把临时层焊进能力核，违词条且 C 难拆。**否**。
- **studio 自带 `tenant_llm_*` 本地表**（连模型管理一起复刻）：最像原仓，但与「catalog 权威在 llm-core」冲突、双源。**否**——D3 换源。

## Open Questions

- studio 复刻的 WS 拆分与 golden 对表覆盖清单排期（另开实现计划）。
- C 下沉触发条件与时点（何时把伴侣注入/多模态合并等做成 flow-core 原生组件、退役 studio 编译层）。
- `flow-sdk` editor-model DTO 与 ghcloud 前端期望（原 façade 形状）的逐字段对齐清单。

## References

- [`../migration/2026-06-09-ai-application-sdk-migration-gap.md`](../migration/2026-06-09-ai-application-sdk-migration-gap.md) — 前端消费面排查 + 本 ADR 的 grill 裁决表
- [`../migration/inventory/ghcloud.md`](../migration/inventory/ghcloud.md) — ai-application 定性「第二 DSL 作者 / 投影层消失」
- ADR-0004（flow 收编与 DSL 编译归 flow-core）
- ADR-0008 / addendum（前端消费 seam、领域 SDK 家族、退役 gateway façade）
- ADR-0012 / addendum（运行时单一真源；tenant 单一隔离、project 退役；换源不动本体）
- `CONTEXT.md`「Flow 运行时」「DSL 编译」（_Avoid_ DSL 映射层——本 ADR 为其**临时偏离**，目标语言不变）

## Supersedes / Clarifies

- **不修改** `CONTEXT.md` 目标语言：`packages/flow/studio` 是**显式登记的临时偏离**，非目标态；目标态仍为 C（无投影层、高层抽象下沉 flow-core 原生组件）。
- **澄清** inventory「投影层消失」：消失是**北极星**；本期以 studio 临时承载，待 C 落地后退役。
