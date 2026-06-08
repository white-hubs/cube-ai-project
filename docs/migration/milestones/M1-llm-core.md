# M1 — llm-core（provider + catalog）

> 渐进式披露：先读 [`../README.md`](../README.md) §4/§5(G3)。事实地基：[`../inventory/ghcloud.md`](../inventory/ghcloud.md)（§4/§11，catalog 数据模型与凭据）、[`../inventory/agent-engine.md`](../inventory/agent-engine.md)（§6/§7，provider 适配与调用现状）、[`../inventory/flow.md`](../inventory/flow.md)（§7，节点 key）、[`../inventory/kb.md`](../inventory/kb.md)（§7/§12-1，embed{dense,sparse}）。

**Goal**：建立 `llm-core` 单包（两个 BC：`provider` 调用 + `catalog` 注册/凭据），成为 **LLM 模型注册与 vendor 凭据的单一权威**，并验证「跨域唯一接缝 = contracts port」在最高频路径上成立（ADR-0010 C1）。

**Architecture**：`catalog` 持系统/租户两层模型 + 推断 + provisioning，实现 contracts 的 `LlmCatalogPort`；`provider` 消费 `LlmCatalogPort` 解析 `{endpointType,apiBaseUrl,apiKey}` 并实现 `LlmProviderPort`（chat/stream/embed/image）。凭据只在此包出口。

**依赖**：M0。 **被依赖**：M2（provider 换源）、M3（embedding 经 provider.embed）、M4（flow LLM 换源）、M6（catalog 数据迁移）。

## Entry 准则
- M0 Exit 全绿；contracts 可用；G2 基线已定。

## Exit 准则
- `bun run --filter @cube-ai/llm-core typecheck` 绿；llm-core 离线单测绿。
- 冒烟：给定 `(tenant, modelCode)`，经 `LlmCatalogPort.resolveModelRuntime` 解析出 runtime config，再经 `LlmProviderPort.chat` 完成一次（可对 mock vendor）调用；`embed` 返回 `{dense,sparse}`（G3 验证，至少对 doubao multimodal 形态）。
- README §7 第 2/3 条 ADR 修正（EmbeddingPort / LlmProviderPort）已决策并回填 ADR-0003/0005。

---

## Task M1.T1 — 定义 `LlmProviderPort`（含 embed{dense,sparse}，G3）

> 决策点（README §7-2/3）：engine 现用 tachu `ProviderAdapter`、无 contracts `LlmProviderPort`；`EmbeddingPort` 已废弃。本计划默认：**在 contracts 定义 `LlmProviderPort` 作为跨域接缝**，provider BC 实现它，engine 内部仍可保留 tachu ProviderAdapter 作为实现细节（二者通过 adapter 衔接）。

**Files**
- Create: `packages/contracts/src/platform/llm-provider.ts`（port + wire schema）
- Modify: `packages/contracts/src/index.ts`（导出）

**Steps**
- [ ] 定义接口（签名对齐 tachu `ProviderAdapter` 以便 engine 衔接，并满足 kb 稀疏需求）：
```ts
export interface LlmProviderPort {
  chat(req: LlmChatRequest, signal?: AbortSignal): Promise<LlmChatResponse>
  chatStream(req: LlmChatRequest, signal?: AbortSignal): AsyncIterable<LlmStreamChunk>
  embed(req: LlmEmbedRequest, signal?: AbortSignal): Promise<LlmEmbedResult[]>
  listAvailableModels?(tenant: TenantId, signal?: AbortSignal): Promise<string[]>
}
// G3：embed 返回 dense + 可选 sparse（doubao multimodal 一次产出两者）
export interface LlmEmbedResult { dense: number[]; sparse?: { indices: number[]; values: number[] } | null }
export interface LlmEmbedRequest { tenant: TenantId; modelCode: string; input: string[]; purpose?: 'query'|'document'; contexts?: Array<{ retrievalProfile?: string }> }
```
- [ ] wire schema（zod）+ 错误码沿用 contracts `errors/`（`UPSTREAM_LLM_*`）。
- [ ] 回填 ADR-0003（确认 `LlmProviderPort` 为新建 contracts port）、ADR-0005（embed 携 sparse）。

**验收**：contracts typecheck 绿；新增 schema 单测绿。

## Task M1.T2 — catalog BC：数据模型（系统/租户两层）

> 来源：`inventory/ghcloud.md §4.1`。

**Files**
- Create: `packages/llm-core/src/catalog/entities/*`（`system-llm-provider-type/provider/model/model-match-rule`、`tenant-llm-provider/model`）
- Create: `packages/llm-core/src/catalog/schema/*`（`LlmRequestSchema/ResponseSchema/DslSchema` 描述符，迁自 ghcloud `llm-schema.ts`）

**Steps**
- [ ] 迁实体字段（保真 ghcloud 列名与语义，尤其 `endpoint_type`/`model_types`/`request_schema_json`/`response_schema_json`/`dsl_schema_json`/`api_key`）。
- [ ] 迁 `endpointType` 枚举（11 值，与 contracts `LlmEndpointType` 13 值对齐——核对差集并统一）。
- [ ] 不引入 ghcloud 框架耦合；ORM 用本仓 `@dangao/bun-server` ORM。

**验收**：实体/schema typecheck 绿；`endpointType` 枚举与 contracts 对账一致（差集记入偏差区）。

## Task M1.T3 — catalog BC：provisioning + 元数据推断

> 来源：`inventory/ghcloud.md §4`（`syncTenantCatalog`、`ModelMetadataInferenceService`、`adapterKey` inferWireDefaults）。

**Files**: Create `packages/llm-core/src/catalog/provisioning.service.ts`、`metadata-inference.service.ts`、`model-match-rule.ts`

**Steps**
- [ ] 迁 `syncTenantCatalog`（系统模板 type→provider→model 复制成租户副本，`api_key=null,enabled=false`）。
- [ ] 迁 match-rule 推断（exact/prefix/contains/regex）+ system-model 命中 + 启发式 fallback；推断 modelTypes（reasoning/vision/embedding/rerank/image_generation/...）+ nativeFamily + `adapterKey`。
- [ ] 单测覆盖推断分支（迁 ghcloud 既有测试若有）。

**验收**：provisioning/推断离线单测绿。

## Task M1.T4 — catalog BC：连通测试 + 远程同步

> 来源：`inventory/ghcloud.md §4`（`LlmTypeAdapterService` 6 类、`fetchRemoteModels`）。

**Files**: Create `packages/llm-core/src/catalog/connectivity/*`（OpenAiCompatible/Azure/Anthropic/Gemini/Ollama/Dashscope adapter）、`remote-sync.service.ts`

**Steps**
- [ ] 迁 6 类连通 adapter（`testConnection`/`testModelConnection`，直连 vendor 用 api_key）。
- [ ] 迁 `fetchRemoteModels`→adapter `fetchModels`→推断富化→upsert。
- [ ] 网络调用在测试中 stub（参照 kb/ghcloud 既有 fetch stub 风格）。

**验收**：连通/同步逻辑离线单测（fetch stub）绿。

## Task M1.T5 — 实现 `LlmCatalogPort`（in-repo）

> 替代 engine 现在用的 `GhcloudLlmCatalogAdapter`（HTTP）。来源：`inventory/agent-engine.md §3.1/§7`、`inventory/ghcloud.md §4.2`（`getModelRuntimeConfig` 返回原文 key）。

**Files**: Create `packages/llm-core/src/catalog/llm-catalog.port-impl.ts`

**Steps**
- [ ] 实现 `listProviders(tenant)` 与 `resolveModelRuntime(tenant, modelCode)`：从租户副本读 `{endpointType,apiBaseUrl,apiKey,modelTypes}`（in-repo 直读 DB，不再 HTTP）。
- [ ] 绑定 contracts DI token（`AGENTIC_PLATFORM_LLM_CATALOG_TOKEN`，命名空间按 M0.T6）。
- [ ] 视觉/能力按 `modelTypes` 推断（沿用 engine 既有逻辑）。

**验收**：给定 seed 租户副本，`resolveModelRuntime` 返回正确 runtime config（含 apiKey）；单测绿。

## Task M1.T6 — provider BC：实现 `LlmProviderPort`

> 来源：`inventory/agent-engine.md §6`（provider 适配清单）。

**Files**: Create `packages/llm-core/src/provider/*`（openai-compat、anthropic、catalog-driven、catalog-provider-routing、image：dashscope-text2image/geekai、noop）

**Steps**
- [ ] copy engine `agentic-adapters/provider/*` → `llm-core/provider/*`，剥离 tachu `ProviderAdapter` 直接依赖处，改实现本仓 `LlmProviderPort`（或保留 tachu 形态 + 一层 `LlmProviderPort` adapter——二选一，记录决策）。
- [ ] `CatalogDrivenProvider` 经 DI 注入 `LlmCatalogPort`（**不再用 `globalThis`**，见 T7）解析后分发到内层 provider；保留 `(tenant:model:hash)` LRU。
- [ ] `embed` 落地 `{dense,sparse}`（G3）：openai-compat 路径回 dense；doubao multimodal 路径回 dense+sparse（迁自 kb 的请求体形态，见 M3.T2 协同）。

**验收**：provider 离线单测绿；catalog-driven 路径能用 mock catalog 解析并调用 mock vendor。

## Task M1.T7 — 去全局耦合（globalThis → DI）

> 来源：`inventory/agent-engine.md §11.3/§11.4`。

**Files**: Modify provider 模块装配（去 `globalThis.__agenticLlmCatalogPort`、去模块级 env provider 常量）

**Steps**
- [ ] 用 DI 注入 `LlmCatalogPort` 替换 `globalThis` 读取。
- [ ] provider 选择改为可注入配置（去注册期固化的 env 常量）。
- [ ] 该改动会影响 engine 组合根装配——在 M2.T5 联调；此处先保证 llm-core 自身可注入。

**验收**：llm-core 不再出现 `globalThis.__agentic*`；typecheck 绿。

## Task M1.T8 — 凭据收束（软过渡，仅接口层）

> 来源：`inventory/flow.md §7`（节点 key、model-providers app_kv）、`inventory/agent-engine.md §11.6`（qwen-image env 旁路）。**数据迁移本体在 M6**，此处只立「软过渡」机制。

**Steps**
- [ ] 定义 `modelRef`（tenant+modelCode）解析优先级：catalog 优先；若调用方仍带 legacy 字面量 key，则**软 fallback**（直用该 key + 记 deprecation 日志/指标），不报错。
- [ ] 暴露给 flow（M4.T7）与 qwen-image（M2.T5）统一走此入口。

**验收**：软 fallback 单测（带 key / 不带 key 两路）绿。

## Task M1.T9 — entry/exit 自检 + 冒烟

**Steps**
- [ ] llm-core 全量 typecheck + 离线测试绿。
- [ ] 冒烟脚本：seed 一个租户副本 → `resolveModelRuntime` → `LlmProviderPort.chat`（mock vendor）→ `embed` 返回 `{dense,sparse}`。
- [ ] 勾选 `PROGRESS.md` M1；写会话日志；指针移 M2。

---

## 本里程碑风险
- **catalog 富逻辑易低估**（`inventory/ghcloud.md §13-5`）：match-rule + 11 endpointType + 6 连通 adapter + schema 描述符 + 两层 provisioning，工作量远超「一张 model 表」。按 T2→T3→T4 分步、各自跑绿。
- **wire 知识双份**（`inventory/ghcloud.md §13-4`）：ghcloud 的 `llm-wire-adapter` 注册表生产无调用、真逻辑在 DSL Python。M1 以**注册表 + provider 实现**为准；DSL 生成器侧逻辑归 M4 flow-core，二者别各自漂移（记入决策）。
- **endpointType 枚举差集**：contracts 13 值 vs ghcloud 11 值，对账统一，别遗漏 `ollama`/`jina_rerank` 等。
- **G3 稀疏向量**：embed 的 `{dense,sparse}` 形态必须在本里程碑定死，M3 的混合检索完全依赖它。

## 决策记录
- （T1）LlmProviderPort 与 tachu ProviderAdapter 的衔接方式：________
- （T6）provider 实现是否保留 tachu 形态：________
