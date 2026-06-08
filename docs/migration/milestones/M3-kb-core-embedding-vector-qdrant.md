# M3 — kb-core + embedding + infra/vector-qdrant

> 渐进式披露：先读 [`../README.md`](../README.md) §4/§5(G3)。事实地基：[`../inventory/kb.md`](../inventory/kb.md)（全篇，尤其 §5 检索/§6 向量层分界/§7 embedding/§10 engine 契约/§12 暗坑）、[`../inventory/agent-engine.md`](../inventory/agent-engine.md)（§5 knowledge/vector/memory handler、§6 vector 适配）。

**Goal**：把 kb 整套 copy 进 `kb-core`，并按 ADR-0005 把**向量化抽成 capability `embedding`**、**raw Qdrant 抽成 infra `vector-qdrant`**；坐实 engine 的 `KnowledgeQueryPort` in-repo 适配，让 agent-engine 真正经接缝调 kb。

**Architecture**：`kb-core`（documents/ingestion/retrieval 的 chunk 耦合编排）→ 调 `embedding`（`EmbeddingPort` 回 `{dense,sparse}`）+ 直连 `infra/vector-qdrant`（领域无关 raw 驱动）。租户语义留 kb-core，infra 只收 opaque filter/payload。

**依赖**：M0、M1（embed 经 provider）、M2（engine 接线目标）。 **被依赖**：M5（kb 管理面）、M6（数据迁移）。

## Entry 准则
- M2 Exit 全绿（ai-center 起得来）；M1 的 `embed` 已支持 `{dense,sparse}`（G3）。

## Exit 准则
- `vector-qdrant`/`embedding`/`kb-core` 各包 typecheck 绿；kb-core 离线测试绿（含 `retrieval-evaluation` 回归）。
- engine `knowledge-handler` 经 **in-repo `KnowledgeQueryPort` 适配** 返回正确 hits（替换 M2.T7 占位）。
- 维度三处对齐（embedding 1024 = 请求 dimensions = qdrant vectorSize = collection schema）校验通过；point-id/collection 名/命名向量与历史数据字节级兼容。

---

## Task M3.T1 — 抽 infra/vector-qdrant（领域无关 raw 驱动）

> 来源：`inventory/kb.md §6`（raw vs chunk 分界）、`inventory/agent-engine.md §6`（engine 的 tachu QdrantVectorIndexAdapter）、README §7-4（命名向量/维度必须参数化）。

**Files**: Create `infra/vector-qdrant/src/{client.ts,collection.ts,point-id.ts,index.ts}`

**Steps**
- [ ] copy kb `qdrant.client.ts`（连接惰性单例）+ `build-stable-qdrant-point-id.ts`（sha256→UUIDv4）原样。
- [ ] copy `qdrant-collection.service.ts` 的 `ensureCollection`，**参数化**命名向量集合与维度（支持「dense+sparse@1024」给 kb、「仅 dense@1536」给 engine memory），保留 `hasHybridVectorSchema` 但做成可选校验。
- [ ] 暴露泛型 API：`upsert({id, vectors:{dense, sparse?}, payload})` / `query({dense, sparse?, filter, topK, fusion})` / `delete(filter)` / `ensureCollection(spec)` / `buildPointId(key)`。
- [ ] **不 import `@cube-ai/server-shared`**（租户语义不进 infra，见 T4）。

**验收**：vector-qdrant typecheck 绿；单测（可用 Fake/录制响应）覆盖 upsert/query/delete 形参；grep 该包无 server-shared/kb 业务引用。

## Task M3.T2 — 抽 embedding capability（EmbeddingPort 回 {dense,sparse}）

> 来源：`inventory/kb.md §7/§12-1/§12-2`、`inventory/agent-engine.md §3.2`（EmbeddingPort 已废弃需重建决策，README §7-2）。

**Files**: Create `packages/embedding/src/{embedding.port-impl.ts,doubao-request.ts}`；contracts 侧 `EmbeddingPort`（按 M1.T1 决策，或复用 `LlmProviderPort.embed`）

**Steps**
- [ ] 决策落地（README §7-2）：默认 **embedding 是薄 capability**，对外暴 `EmbeddingPort`（或直接复用 `LlmProviderPort.embed`），内部经 llm-core 调模型。**必须保留 doubao 的 `instructions`/画像语义**（query/document×4 画像）与 `{dense,sparse}` 产出，否则检索质量回归。
- [ ] 把 kb `doubao-embedding.client.ts` 的请求体构造（`multi_embedding`/`sparse_embedding`/`instructions`/`normalizeSparseEmbedding`）迁为 llm-core provider 的 doubao-multimodal 路径（M1.T6 协同）或 embedding 包内特例（记录决策）。
- [ ] 维度（1024）来源参数化（不再构造硬编码），由组合根注入（与 qdrant vectorSize 对齐，T7）。

**验收**：`embedding.embed(['q'],'query',[{retrievalProfile}])` 返回 `{dense:number[1024], sparse:{indices,values}}`；单测（stub 模型）绿；`retrieval-profile`→instructions 映射保真。

## Task M3.T3 — copy kb → kb-core

> 来源：`inventory/kb.md §2/§3/§4/§5`。

**Files**: Create `packages/kb-core/src/{documents,ingestion,retrieval,object-storage,common}/**`

**Steps**
- [ ] copy kb `modules/**` + co-located 单测。
- [ ] **按符号搬运**：`document-chunk.repository.ts`（纯 MySQL chunk 语义）从 `infrastructure/qdrant/` 目录移到 `kb-core/retrieval/`（它与 Qdrant 无关，`inventory/kb.md §6/§12-6`）。
- [ ] retrieval 全流程（词法 LIKE+加权、mergeRecallResults、规则 rerank、文档内归一、section 聚合、召回计数）**整体留 kb-core**（不抽 infra）。
- [ ] 处理顶层 await 装配（`vector-store/ingestion.module` 的 `loadAppConfig()`）——适配新组合根加载顺序（`inventory/kb.md §12-8`）。

**验收**：kb-core 文件就位；暂不要求全绿（依赖换源在 T5）。

## Task M3.T4 — 租户语义上移（infra 领域无关）

> 来源：`inventory/kb.md §6/§12-9`。

**Steps**
- [ ] 把 `qdrant-vector.repository.ts` 里的 `QdrantPointPayload`（业务字段）、`buildSearchFilter/buildDeleteFilter`（documentId/projectId filter）、`getScopedProjectIdForFilter`（读 `currentProjectId`）**留在 kb-core**；kb-core 构造好 opaque filter/payload 传给 `vector-qdrant`。
- [ ] kb-core 调 `vector-qdrant.query({dense,sparse,filter,fusion:'rrf'})`，自己解读 RRF 结果。

**验收**：`vector-qdrant` 不含任何租户/chunk 语义；kb-core 注入 projectId 的逻辑单测绿。

## Task M3.T5 — kb 换源（embedding + vector-qdrant）

> 来源：`inventory/kb.md §2`（EmbeddingProvider 唯一 DI 绑定点）。

**Steps**
- [ ] kb-core 的 `EmbeddingProvider` DI 绑定（原 `useClass: DoubaoEmbeddingClient`）→ 改注入 `embedding`（M3.T2）。
- [ ] kb-core 的 qdrant 机制调用 → 改用 `infra/vector-qdrant`（T1）。
- [ ] 更新 `embedding-provider-di.test.ts`（绑定变了，`inventory/kb.md §11`）。

**验收**：kb-core 离线测试绿（retrieval.service 全 fake 测试、document-chunk fake DB 测试、retrieval-evaluation 回归）。

## Task M3.T6 — 实现 in-repo KnowledgeQueryPort 适配

> 来源：`inventory/kb.md §10`（契约鸿沟）、`inventory/agent-engine.md §5`（knowledge-handler）。

**Files**: Create `packages/kb-core/src/port/knowledge-query.port-impl.ts`

**Steps**
- [ ] 实现 contracts `KnowledgeQueryPort.query(req)`，映射：
  - `tenant:number` → kb `projectId:string`（映射规则待定，参 `inventory/kb.md §13-1`：是否复用 `/search/by-directory`，kbId=directoryId）。
  - `kbIds[]` → kb `directoryId/documentId`。
  - kb `SearchItem`（富字段）→ engine `KnowledgeHit{docId,kbId,title,snippet,score,link}`（取 aggregatedText/text 作 snippet、rankScore 作 score）。
  - `scoreThreshold(engine 默认 0.3)` ↔ kb `similarityThreshold`/归一后 rankScore 语义对齐。
- [ ] 绑定 contracts DI token（替换 M2.T7 的 knowledge 占位）。

**验收**：给定 seed 文档，engine knowledge-handler 经此适配返回正确 hits；映射单测绿（含 tenant/kbId 映射、snippet 取值、阈值对齐）。

## Task M3.T7 — engine 接线（knowledge + vector/memory 维度对齐）

> 来源：`inventory/agent-engine.md §5/§6`、`inventory/kb.md §12-4`。

**Steps**
- [ ] ai-center 组合根：`KnowledgeQueryPort` 绑 kb-core in-repo impl（替占位）。
- [ ] engine vector/memory handler：决定走 `infra/vector-qdrant`（统一）还是保留 engine 自带 tachu adapter——默认统一到 `vector-qdrant`，engine memory 用「仅 dense@1536」collection spec。
- [ ] **维度对齐归组合根**：注入 embedding 维度 = qdrant vectorSize，kb=1024、engine memory=1536，分别建 collection。

**验收**：engine knowledge-handler 端到端返回 hits；memory/vector handler 不因维度不符报错。

## Task M3.T8 — 生成 kb DDL + 数据兼容校验

> 来源：`inventory/kb.md §8/§12-5`（kb 无 .sql；point-id/collection 是已落盘隐式契约）。

**Files**: Create `packages/kb-core/migrations/*.sql`（document_record/directory/import_job/document_chunk 建表 + 词法字段索引评估）

**Steps**
- [ ] 由 ORM 实体反推 DDL（4 表 + `document_chunk` 全字段 + `qdrant_point_id`）。评估 `keywords_text`/`headers_text`/`text_content` 是否加索引（`LIKE %%` 用不上前缀索引，记入偏差区，性能优化非本里程碑必做）。
- [ ] 校验 `buildStableQdrantPointId` 与 `qdrantCollectionName`(默认 `ai_server_documents`)、命名向量 `dense`/`sparse` 与历史数据一致（M6 真实数据迁移前的字节级核对）。

**验收**：DDL 可在本地建库；point-id/collection/命名向量与源仓常量逐一相等（grep 对账）。

## Task M3.T9 — 离线测试 + entry/exit 自检

**Steps**
- [ ] kb-core/embedding/vector-qdrant 全量 typecheck + 离线测试绿；retrieval-evaluation 作为检索质量回归基准跑绿。
- [ ] 勾选 `PROGRESS.md` M3；写会话日志；指针移 M4。

---

## 本里程碑风险
- **sparse 必须贯通（G3）**：embedding `{dense,sparse}` 任一环丢 sparse → RRF 退化为纯 dense → 混合检索失效（`inventory/kb.md §12-1`）。在 T2/T5 用 retrieval-evaluation 夹住。
- **画像指令丢失致检索回归**（`inventory/kb.md §12-2`）：T2 必须保真 doubao instructions。
- **reindex 孤儿向量 bug**（`inventory/kb.md §12-3`）：`indexDocumentChunks` 未删旧点。本里程碑可先按原样迁（保持行为一致），在 M6 数据迁移时一并修；记入偏差区。
- **按目录 vs 按符号搬运**（`inventory/kb.md §12-6`）：`document-chunk.repository` 误划进 infra 会把 chunk MySQL 逻辑拖进 infra——T3 务必按符号切。
- **词法非 BM25**（`inventory/kb.md §12-7`）：勿误标；大表性能优化非本里程碑范围。
- **engine↔kb 映射在仓外**（`inventory/kb.md §13-1`）：tenant→projectId、kbId→directory 的真实规则当前藏 ghcloud 转发层；T6 需确认规则（必要时 resume 勘察 ghcloud `/ai/knowledge/query`）。

## 决策记录
- （T2）embedding 暴 `EmbeddingPort` 还是复用 `LlmProviderPort.embed`：________
- （T6）tenant→projectId / kbId→directory 映射规则：________
- （T7）engine memory 走 vector-qdrant 还是保留 tachu adapter：________
