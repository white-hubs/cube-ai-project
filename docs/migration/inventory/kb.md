# Inventory · kb（redesign/cube-ai/server/kb）

> 勘察来源：只读 subagent（agent-id `32eeaf63`）实读 `/Users/dg/work-dg/cube-ai/redesign/cube-ai/server/kb`。本文是迁移计划 M3 的事实地基。

## 1. 概览

| 项 | 值 |
|---|---|
| 路径 | `…/redesign/cube-ai/server/kb`，包名 `@cube-ai/kb` |
| 文件数 | 98 `.ts`（68 实现 + 30 测试） |
| 实现 / 测试 LOC | ≈7,651 / ≈4,609 |
| 独立启动 | `src/single.ts`（默认 3322，仅挂 AiKbModule） |
| 运行依赖 | `@qdrant/js-client-rest`、`@aws-sdk/client-s3`(MinIO)、`mammoth`/`xlsx`/`jszip`、`@dangao/bun-server`、`@cube-ai/{server-base,server-shared,server-mock}` |
| 配置真源 | `server-base/src/config/app.config.ts`（qdrant/embedding/retrieval/docling/minio/mysql 键全在此） |

模块 LOC：documents ≈2,539 / vector-store ≈2,285 / ingestion ≈2,282 / common 175 / object-storage 129。

## 2. 模块全景表

| 模块 | 职责 | 关键文件·LOC | 处置 |
|---|---|---|---|
| `modules/documents` | 知识库目录 + 文档 CRUD/上传/预览/重建索引/分段编辑 | document.controller 619 · document-directory.controller 441 · document.service 495 | **kb-core** |
| `modules/ingestion` | 解析(15 parser+docling)/分块(4 chunker)/向量化文本规范化/import-job | ingestion.service 250 · embedding-text-normalizer 53 · docling.client 262 | **kb-core**（normalizer 归属见 §7） |
| `…/vector-store/services` | 检索编排 + 向量化编排 | retrieval.service 670 · vectorization.service 113 | **kb-core** |
| `…/infrastructure/qdrant` | Qdrant 驱动 + chunk MySQL 仓储 + point-id | qdrant.client 29 · qdrant-collection.service 67 · qdrant-vector.repository 227 · document-chunk.repository 370 · build-stable-qdrant-point-id 24 | **拆**：raw→`vector-qdrant`；payload/lexical/scope→kb-core |
| `…/infrastructure/embeddings` | doubao 向量化 client + 契约 + 检索画像 | doubao-embedding.client 168 · embedding-provider 25 · retrieval-profile 75 | **embedding**（client+契约）；profile 待判 |
| `…/vector-store/controllers` | `/search` HTTP | search.controller 350 | **kb-core** |
| `modules/object-storage` | MinIO/S3 文件存储 | object-storage.service 115 | **kb-core**（infra 细节，非向量） |
| `modules/common` | 共享类型(chunk/payload/SearchItem)+时间 | document-types 165 | **kb-core**（部分随 embedding 切出） |

装配：`AiKbModule`→`DocumentModule`(imports OrmDatabase/ObjectStorage/Ingestion/VectorStore)。⚠️ `vector-store.module`/`ingestion.module` 用**顶层 await `loadAppConfig()`** 注入 `APP_CONFIG_TOKEN`（迁移注意 ESM 顶层 await）。**`EmbeddingProvider` Symbol → `useClass: DoubaoEmbeddingClient`** = 唯一绑定点（§7 抽取 seam）。

## 3. 文档管理

两类聚合：`document_directory_record`（目录，一层）→ `document_record`（文档，挂 directory_id）。`DocumentService` 编排 upload(MinIO→建 document+import-job→ingest→回写 status)/preview/listChunks/updateChunk(增量重向量化)/reindex(从 MinIO 取回重摄入)/delete(删 MinIO→`qdrantVectorRepository.deleteByDocument`→MySQL 逻辑删)。文件存 MinIO（`@aws-sdk/client-s3`，桶 `kb-documents`）。租户经 `currentProjectId()`/`isGlobalAccessEnabled()` 注入 project_id 过滤；审计 `getAuditInfo()` **硬编码 by:'system'**（横切收归点）。

## 4. 摄入 ingestion

**解析**（`ParserRegistryService` 按扩展名/MIME 路由 primary+fallback）：主力 = docling 服务（`docling.client.ts` HTTP `POST {doclingBaseUrl}/v1/chunk/hybrid/file`），fallback 本地 15 parser。docling 产 chunk：headings→headingPath、page_numbers→pageNo、`inferChunkType`(table/picture/list/paragraph)、`buildSectionId`。**分块**：`overlap-text.chunker`（通用，overlap 滑窗，默认 1000/200）、`table-row-window.chunker`（表格按行/窗口，产 headers/keywords/sheetName/tableId/rowStart/End）、`vtt-window`（字幕）、`properties-group`。**向量化文本规范化**（`embedding-text-normalizer.ts`）按画像产 `embeddingText`（面向文档结构的领域规范化 → 留 kb-core）。

**chunk 结构**（`common/document-types.ts` `TextChunkRecord`）：`chunkId(=${documentId}-${chunkIndex})`、documentId、chunkIndex、text、embeddingText、projectId、sourceType、fileName、sectionId、headingPath[]、pageNo、chunkType、orderInSection、captionText、pictureDescription + 语义元数据（sheetName/tableId/rowStart/End/headers[]/keywords[]/startTime/endTime/cueIndex/propertyNamespace/retrievalProfile）。`retrievalProfile` 摄入期算出、随 chunk 入库（MySQL+Qdrant payload 双写）。

## 5. 检索 retrieval 全流程拆解（`retrieval.service.ts`）

单次 `search()`：① `normalizeQuery`（压空白+截 200）② query 画像 `resolveQueryRetrievalProfile`（timeline/navigation/entity-lookup/semantic-qa）③ query 向量化 `embeddingProvider.embed([q],'query',[{profile}])` 得 `{dense,sparse}` ④ **向量检索 dense+sparse + RRF**（`QdrantVectorRepository.search` → Qdrant `query`，dense/sparse 各作 prefetch，`query:{fusion:'rrf'}` **服务端融合**）⑤ **词法检索**（`searchLexicalChunks`——**非 FULLTEXT/BM25**，是 `LOWER(col) LIKE %term%` 9 字段召回 + `calculateLexicalScore` 字段加权 + CJK 2-gram）⑥ **融合**（`mergeRecallResults` 按 chunkId 合并，词法独有命中从 MySQL 重建 payload，**lexical 不进 RRF**、按 `LEXICAL_SCORE_WEIGHT=0.08` 加权）⑦ **规则 rerank**（`calculateRankScore`：基分 vectorScore+lexical*0.08，叠 heading/text/table/画像 boost；非 rerank 模型；`retrievalRerankEnabled` 开关）⑧ 文档内归一 `normalizeRankScoresPerDocument` ⑨ 阈值过滤 ⑩ **section 聚合**（`buildSearchItem` 对 paragraph/list/text 按 `orderInSection±1` 取同 section chunk 拼 aggregatedText）⑪ 召回计数回写。

→ **dense/sparse+RRF = Qdrant 服务端能力（通用 infra）**；其余（词法、合并、rerank、归一、section 聚合、计数）= **kb 领域编排，留 kb-core**。

## 6. 向量存储层拆解（raw vs chunk 耦合分界）

**→ infra `vector-qdrant`（领域无关 raw）**：`qdrant.client.ts`（连接惰性单例，`checkCompatibility:false`）；`qdrant-collection.service.ts`（bootstrap：建 `vectors.dense{size,Cosine}`+`sparse_vectors.sparse{}`，`hasHybridVectorSchema` 校验；命名向量常量 `dense`/`sparse`）；`build-stable-qdrant-point-id.ts`（sha256→确定性 UUIDv4）；`qdrant-vector.repository.ts` 的**机制**（upsert 命名向量、search dense/sparse prefetch+RRF、deleteByDocument 的 count+delete）。

**→ 留 kb-core（chunk 语义耦合）**（同在 qdrant-vector.repository.ts）：`QdrantPointPayload`（焊 documentId/chunkId/sectionId/headingPath/chunkType/orderInSection/retrievalProfile/projectId — 业务字段）；`buildSearchFilter`/`buildDeleteFilter`（按 documentId/projectId 构 filter，含数字/字符串两形兼容）；`getScopedProjectIdForFilter`（依赖 server-shared `currentProjectId`/`isGlobalAccessEnabled` — 租户语义）。

```20:47:/Users/dg/work-dg/cube-ai/redesign/cube-ai/server/kb/src/modules/vector-store/infrastructure/qdrant/qdrant-vector.repository.ts
export interface QdrantPointPayload extends Record<string, unknown> {
  documentId: string
  chunkId: string
  chunkIndex: number
  ...
  retrievalProfile?: string | null
  projectId?: string | null
}
```

**分界建议**：`vector-qdrant` 暴露泛型 `upsert({id,vectors:{dense,sparse?},payload})`/`query({dense,sparse?,filter,topK,fusion})`/`delete(filter)`/`ensureCollection({vectorSize,named vectors})`/`buildPointId`；kb-core 保留「构造 payload + 构造 filter + 解读 RRF 结果」。**`document-chunk.repository.ts`（MySQL，全 chunk 语义）整体留 kb-core**——它名义在 `infrastructure/qdrant/` 下却与 Qdrant 无关（迁移按符号而非目录切）。

## 7. embedding 现状（capability 抽取输入）

client `doubao-embedding.client.ts`（`DoubaoEmbeddingClient implements EmbeddingProvider`，`POST {embeddingBaseUrl}/embeddings/multimodal`，Bearer，逐条并发）。契约 `embedding-provider.ts`：`embed(input[],purpose?,contexts?[]) → {dense:number[], sparse:{indices,values}|null}[]` + Symbol token。**唯一 DI 绑定**在 `vector-store.module.ts`（`{provide:EmbeddingProvider, useClass:DoubaoEmbeddingClient}`）= 替换为 `EmbeddingPort`(经 `LlmProviderPort.embed`) 的精确 seam；消费者 RetrievalService/VectorizationService。key=`config.embeddingApiKey`（CLI>app.json>`EMBEDDING_API_KEY`>''），baseUrl 默认火山 ark，model 默认 `doubao-embedding-vision-251215`。**维度 1024**（构造硬编码+请求 dimensions:1024，须与 qdrantVectorSize=1024 一致）。

⚠️ **dense & sparse 均由 doubao 同一次调用产出**（请求 `multi_embedding:{enabled}`+`sparse_embedding:{enabled}`）；**sparse 不是本地 BM25/SPLADE**，是模型返回 `sparse_embedding:[{index,value}]` 经 `normalizeSparseEmbedding`。

```86:95:/Users/dg/work-dg/cube-ai/redesign/cube-ai/server/kb/src/modules/vector-store/infrastructure/embeddings/doubao-embedding.client.ts
    multi_embedding: { type: 'enabled', },
    sparse_embedding: { type: 'enabled', },
    encoding_format: 'float',
```

`buildDoubaoEmbeddingRequestBody` 按 query/document×4 画像注入不同 `instructions`（doubao 专有 prompt-instruction 语义，切 llm-core 须保留否则检索质量漂移）。归属待判：`retrieval-profile.ts`/`embedding-text-normalizer.ts` 介于 kb 与 embedding 之间（ADR-0005 已挂待判）。

## 8. DB（mysql schema + point-id 关联）

4 张 MySQL 表（`@dangao/bun-server` ORM `@Entity`）：`document_record`、`document_directory_record`、`document_import_job`、`document_chunk`（chunk 元数据全集 + `qdrant_point_id` + 词法字段 `keywords_text`/`headers_text` + recall_count）。⚠️ **仓内无任何 .sql/migration**——schema 仅由实体推断，建表在 kb 之外。mysql↔qdrant：**mysql 存元数据+词法+计数；qdrant 存向量+冗余 payload**，关联键 `qdrant_point_id = buildStableQdrantPointId(chunkId)`，`chunkId=${documentId}-${chunkIndex}`。

## 9. 对外表面

`/search`（POST `/`、`/by-documents`、`/by-directory`，JSON）；`/documents`（preview/upload(multipart)/list/:id preview/delete/chunks/reindex）；`/documents/directories`（CRUD/list）。每端点带 `@MockableEndpoint('kb.*')`。**SSE：无**（grep 零命中）——检索一次性返回，与 engine SSE 编排正交。

## 10. 被 agent-engine 调用的形态

engine 经 `KnowledgeQueryPort` 消费，handler `knowledge-handler.ts` 强制 `kbIds ⊆ turn.runtimeRefs.knowledgeBases`、`tenant=ctx.auth.tenant`。**当前唯一实在 adapter = `GhcloudKnowledgeQueryAdapter`**（`POST {baseUrl}/ai/knowledge/query`）——engine 经 ghcloud HTTP 转发间接到 kb，**不直连 kb 的 /search/***，本仓无 in-repo kb adapter。⚠️ **契约不对称**：engine `KnowledgeQueryRequest{tenant:number,query,kbIds[],topK,scoreThreshold}`→`{hits:[{docId,kbId,title,snippet,score,link}],truncated}`（扁平）；kb `RetrievalService.search{query,topK,documentId?,similarityThreshold?}`→`SearchItem`（富字段）。`kbId↔directoryId/documentId`、`tenant:number↔projectId:string` 映射当前藏在 ghcloud 转发层（仓外）——M3 坐实 in-repo adapter 时必须新建。

## 11. 测试现状

30 个 `*.test.ts` ≈4,609 LOC，`bun test`。最大：retrieval.service 854、ingestion.service 503、office-parsers 362、retrieval-evaluation 320、qdrant-vector.repository 235。**整套可离线**：单测全用 DI 替身（`FakeEmbeddingProvider`/`FakeQdrantVectorRepository`/`FakeDatabaseService`，`fetch` stub）——无需真实 MySQL/Qdrant/MinIO/docling/embedding。`retrieval-evaluation.test.ts` 可作检索质量回归基准。`embedding-provider-di.test.ts` 校验 DI 绑定（改绑 EmbeddingPort 后需更新）。

## 12. 迁移风险与暗坑

1. **sparse 来自模型、llm-core 必须支持稀疏**（最高危）：若 `EmbeddingPort` 经 `LlmProviderPort.embed` 只回 dense，**sparse 丢失→RRF 退化纯 dense→混合检索失效**。`EmbeddingPort` 契约须保留 `{dense,sparse}`。
2. **画像指令语义**：`instructions`（query/document×4 画像）直接影响向量空间，切 llm-core 丢失则检索回归。
3. **reindex 不删旧 Qdrant 点（疑似 bug）**：`vectorization.service.indexDocumentChunks` 只 upsert+MySQL 逻辑删，**未调 deleteByDocument**→孤儿向量。仅 deleteDocument 走 deleteByDocument。数据迁移期须正视。
4. **维度三处对齐**：DoubaoClient.dimension=1024 × 请求 dimensions=1024 × qdrantVectorSize=1024 × collection 既有 schema。ADR-0005「维度对齐归组合根」须落实。
5. **point-id/collection 兼容**：`buildStableQdrantPointId`(sha256→UUIDv4) × `qdrantCollectionName`(默认 `ai_server_documents`) × 命名向量名 `dense`/`sparse` 是**已落盘数据的隐式契约**，`vector-qdrant` 抽取须字节级一致。
6. **document-chunk.repository 错置目录**（在 qdrant/ 下却纯 MySQL）——按符号切，勿整目录划入 infra。
7. **词法非真 BM25**（LIKE+手写加权+2-gram，无 FULLTEXT 索引）——大表性能隐患，勿误标 BM25。
8. **顶层 await 装配**（vector-store/ingestion module）——换组合根注意加载顺序。
9. **租户耦合在向量层**：qdrant-vector.repository 直接 import server-shared——`vector-qdrant` 要领域无关则 projectId 过滤须上移 kb-core，否则 infra 反向依赖 server-shared。
10. 审计 `by:'system'` 硬编码（横切收归改写点）。
11. **engine↔kb 契约鸿沟**（§10）：in-repo `KnowledgeQueryPort` adapter 需写 `tenant→projectId`、`kbId→directory/document`、`SearchItem→KnowledgeHit` 映射；`scoreThreshold(engine 0.3)` vs kb `retrievalScoreThreshold(0.25)` 语义对齐。

## 13. 开放问题

1. ghcloud `/ai/knowledge/query` 的映射规则（kbId↔directory/document、tenant↔projectId、snippet 取 SearchItem 哪字段）在仓外，需取得以坐实 in-repo adapter。是否复用 `/search/by-directory`（kbId=directoryId）？
2. `LlmProviderPort.embed` 是否具稀疏向量返回能力？若无，是 embedding 包内特例处理 doubao multimodal，还是扩展 port？
3. `retrieval-profile.ts`/`embedding-text-normalizer.ts` 最终归属（kb 摄入 vs embedding 包）。
4. 建表/迁移脚本来源：kb 无 .sql，谁提供 DDL 与索引（`document_chunk` 词法字段是否需索引/FULLTEXT）？
5. 历史 Qdrant 数据迁移：collection 名/维度/point-id 不变即零重算？还是重建（顺带修 §12-3 孤儿向量）？属 ADR-0010 数据迁移未决。
6. embedding 模型并发/批量化在 embedding 包统一处理？
7. `vector-qdrant.ensureCollection` 的 hybrid schema 校验属 infra 通用还是 kb 专属（engine memory 只 dense 无 sparse）？需参数化命名向量集合。
