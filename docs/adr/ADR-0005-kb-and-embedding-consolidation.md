# ADR-0005: kb 收编为 @cube-ai/kb-core；向量化下沉 @cube-ai/embedding（capability port）；向量存储归 infra/vector-qdrant 共享驱动（不设 VectorStorePort）

- **Status**: Accepted
- **Date**: 2026-06-05
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: kb, knowledge, embedding, vector-store, qdrant, infra, credentials, consolidation

## Context

知识检索当前散三处：engine 只有 `KnowledgeQueryPort`；ghcloud ai-application 仅转发；真正实现在 `cube-ai/server/kb`。检索经 engine → ghcloud adapter → ai-application kb 服务 → cube-ai/kb 三处路由稀释。

`cube-ai/server/kb` 内部把多种关注点绑在一起：`modules/documents`（文档）、`modules/ingestion`（chunkers / docling 解析 / `embedding-text-normalizer`）、`modules/vector-store`（`infrastructure/embeddings` 含 `doubao-embedding.client` + `infrastructure/qdrant`）、`modules/object-storage`。其中 `doubao-embedding.client` 自带 embedding 模型 key，是 ADR-0003 凭据边界之外的又一条直连 vendor 路径。

**对源码的深读暴露了一个关键不对称**（修正了早期「向量化与向量库是两个平级 capability 包」的设想）：

- **kb 的向量访问是 chunk 强耦合 + 混合检索**：`qdrant-vector.repository` 的 payload 焊死 `documentId/chunkId/section/heading…`，且用 **dense+sparse 命名向量 + RRF** 融合；`RetrievalService` 进一步叠 MySQL 词法（BM25/recall_count）→ chunk 感知 rerank → section 聚合。**绝大部分是 kb 领域编排**。
- **engine memory 的向量访问是简单 dense + 不透明 payload + tenant**：源仓 `CubeQdrantMemoryIndex` 包 `@tachu/extensions/vector`（一个**已经独立成包**的 Qdrant adapter）。
- 两者**用法根本不同**（kb hybrid ⊋ engine simple）。它们真正共享的**不是一个「领域无关 capability port」，而是 Qdrant 这套基础设施**（连接、命名向量 upsert/query、collection bootstrap、point-id）。

由此区分两类东西：**向量化（embedding）是算力能力**（选模型、经 provider 管凭据、维度/版本/缓存/规范化，有领域中性业务价值、可被 mock 的行为）——值得一个 contracts port；**向量存储是数据库**（像 MySQL/Redis 的驱动）——两域**直接用**即可，除 CRUD 没有额外领域中性能力。

## Decision

把 kb 收编为 in-repo `@cube-ai/kb-core`，藏在 `KnowledgeQueryPort` 之后；**向量化下沉 capability 包 `@cube-ai/embedding`**；**向量存储归基础设施 `infra/vector-qdrant`（`@cube-ai/vector-qdrant`）共享 Qdrant 驱动，不设 `VectorStorePort`**。

### 职责边界

- **`@cube-ai/kb-core`**：documents + **摄入**（chunking / docling / 文本规范化）+ **检索编排**（query → 向量化 → **hybrid(dense+sparse)+RRF** + MySQL 词法 → rerank → section 聚合）+ **自有 chunk 感知向量层**（直接建在 `vector-qdrant` 上）+ object-storage。暴露 `KnowledgeQueryPort`。
- **`@cube-ai/embedding`**（capability，contracts port）：**向量化**（`EmbeddingPort`，文本→向量），经 `LlmProviderPort.embed`。自 kb 的 `vector-store/infrastructure/embeddings` 切出。
- **`@cube-ai/vector-qdrant`**（**infra**，无 contracts port）：**共享 raw Qdrant 驱动**——连接管理、命名向量（dense/sparse）upsert/query、collection bootstrap、point-id 助手。**领域无关、无业务语义**，只认「向量 + 不透明 payload + id」。被 `kb-core` 与 `agent-engine` **直连消费**（如同直连数据库驱动）。自 kb 的 `vector-store/infrastructure/qdrant` 与 engine 侧 `@tachu/extensions/vector` 合一。

> engine memory 的向量索引（原 `CubeQdrantMemoryIndex`）随 agent-engine 迁移，**建在 `vector-qdrant` 上**、留在 engine 自身 adapter 层；kb 的 hybrid+chunk 向量层留 kb-core。**两域各自的向量层不强行抽成共享 port**——它们用法不同，共享的只是底层 `vector-qdrant` 驱动。

### 为什么向量化是 capability port、向量存储却是 infra（本 ADR 的核心判定）

| | 向量化 (Embedding) | 向量存储 (Vector Store) |
|---|---|---|
| 本质 | **算力能力**：选模型、经 provider 管凭据、维度/版本/缓存/规范化 | **数据库**：连接 + 向量 CRUD |
| 领域中性业务价值 | 有（一处管理，多处复用同一行为） | 无（除 CRUD 外无可复用的领域中性能力） |
| 消费者用法 | 统一（文本→向量） | **不统一**（kb 要 hybrid+filter，engine 只要 simple dense） |
| 落点 | `@cube-ai/embedding` + `EmbeddingPort`（contracts） | `infra/vector-qdrant` 驱动，**直连**；不设 port |

向量存储被一个「领域无关 `VectorStorePort`」抽象，要么 port 膨胀到容纳 kb 的 hybrid，要么 kb 削足适履退回 simple——这是过度抽象。它就是 infra（数据库），按 infra 待之。

### 关键约束

1. **向量化经 provider**：`EmbeddingPort` 的模型调用走 `LlmProviderPort.embed`，**吸收/替换** `doubao-embedding.client`，消除其独立 key——遵守 ADR-0003 凭据边界。

   > **源码勘察订正（两点，落地见 M1.T1/M3.T2）**：
   > **M1 决策（2026-06-06）**：**保留独立 `EmbeddingPort`**（M3 `@cube-ai/embedding` capability 包对外暴露）；底层 vendor 调用走 **`LlmProviderPort.embed`**（已在 llm-core 实现，含 doubao multimodal `{dense,sparse}`）。不采用「仅复用 `LlmProviderPort.embed` 作为 kb/engine 公共 seam、取消 EmbeddingPort」方案——遵守本 ADR 约束#4 分层。
   > 2. **稀疏向量必须贯通（硬约束 G3）**：kb 的 `dense + sparse` 由 doubao 多模态模型**一次调用同时产出**（请求 `multi_embedding`+`sparse_embedding`，sparse 非本地 BM25/SPLADE）。因此 **`LlmProviderPort.embed` 已返回 `{dense, sparse?}`**（`llm-core` `DoubaoMultimodalEmbedProvider`）；M3 `EmbeddingPort` 须保真 doubao 的 query/document×4 画像 `instructions`——否则 sparse 丢失 → Qdrant RRF 退化为纯 dense → 混合检索失效、检索质量回归。详见迁移勘察 `docs/migration/inventory/kb.md §7/§12-1`（已随迁移收尾移除，git 历史可溯）。
2. **向量存储是 infra，不走 contracts port**：`agent-engine` / `kb-core` **直连** `@cube-ai/vector-qdrant`，正如直连 `bun-server-ext-*`。ADR-0002「跨域只走 port」治的是**跨域 capability 消费**（flow/kb/llm/embedding），**infra 依赖豁免**于该铁律（infra 不是领域能力）。
3. **chunk 语义留 kb-core**：`vector-qdrant` 只存「向量 + 不透明 payload + id」，**不理解 chunk 业务字段**；kb 的 chunk 感知 payload、hybrid、RRF、rerank、section 聚合**全在 kb-core**。
4. **embed 分层，禁止旁路**：`LlmProviderPort.embed` 是**低层 vendor/模型调用**，仅供 `@cube-ai/embedding` 内部使用；`EmbeddingPort` 才是面向 kb/engine 的**公共向量化能力**。消费者不得直接调 `LlmProviderPort.embed` 绕过 embedding 包。
5. **依赖链**：`kb-core` → `EmbeddingPort`（DI 注入 `@cube-ai/embedding`，内部再经 `LlmProviderPort.embed`）+ **直连** `@cube-ai/vector-qdrant`（kb 自建 chunk 感知向量层）。`agent-engine` 同理（memory：`EmbeddingPort` + 直连 `vector-qdrant`）。「先 embed 再 store」的编排在各消费者自身。
6. **维度与命名向量集合对齐归组合根**：向量维度须与 `vector-qdrant` 的 collection `vectorSize` 一致——该绑定在组合根 config 按 collection 注入（engine memory 与 kb 各用不同 collection / 可能不同模型），不是任一包的内部不变量。

   > **源码勘察订正（落地见 M3.T1/M3.T7）**：两域的 collection 形态**不同**，`vector-qdrant.ensureCollection` 必须**参数化「命名向量集合」而非仅 `vectorSize`**：**kb = `dense + sparse`@1024**（hybrid，`hasHybridVectorSchema` 校验）；**engine memory = 仅 `dense`@1536**（simple，无 sparse）。组合根为两域分别建 collection、注入各自的命名向量 spec 与维度。源 kb 的 `ensureCollection`/`hasHybridVectorSchema` 把 hybrid 写死，迁入 infra 时须改为可参数化（sparse 可选）。详见迁移勘察 `docs/migration/inventory/kb.md §6/§13-7`（已随迁移收尾移除，git 历史可溯）。
7. ghcloud knowledge 转发层退役为 legacy 过渡 adapter；in-repo kb adapter 坐实 `KnowledgeQueryPort` seam（与 ghcloud HTTP adapter 两 adapter 一 seam）。

## Consequences

- **Positive**：检索/摄入回到单一 locality，4 处路由收为 1；embedding 的独立 vendor key 消除，凭据单源；**Qdrant 连接/驱动代码收为单一 `vector-qdrant`，kb 与 engine 不再各写一份**；`embedding` 作为 capability 可独立 mock；**kb 的 hybrid 不被领域无关 port 削足适履**；「向量存储=infra」与「跨域只走 port」不冲突（infra 豁免，且与 `bun-server-ext-*` 同档）；依赖足迹隔离（只做 store 的不被拖进 embedding 代码）。
- **Negative**：kb-core 与 agent-engine **各自维护向量层**（代码相似但用法不同，刻意不强行共享，避免错误抽象）；infra 包 +1（`vector-qdrant`）；切分需保 Qdrant collection/point-id 兼容（迁移期向量数据不可重算时保 schema 稳定）；`embedding-text-normalizer` 归属需判定（面向文档的规范化留 kb 摄入，纯文本→向量留 embedding）。
- **Neutral**：Qdrant 仍是独立有状态容器（compose/StatefulSet）；`vector-qdrant` client lib 随之进中台依赖清单。

## Options Considered

- **设领域无关 `VectorStorePort`、kb 与 engine 共享一个向量 capability 包（早期设想）**：看似与 embedding 对称、可换 vendor。但 kb 需 hybrid（dense+sparse+RRF+filter）、engine 只需 simple dense，**用法不对称**——port 要么膨胀要么逼 kb 削足适履；且若两域都走该 port，则底层 Qdrant 驱动**只剩单一消费者**，反而**不该提取**，与「两域都用 Qdrant、应共享」的直觉矛盾。真正共享的是 **Qdrant 基础设施**，不是领域无关 capability。**否**——改为提取 `infra/vector-qdrant`、各域自建向量层（本 ADR Decision）。
- **向量化保留在 embedding 包内自带 client（不走 provider）**：实现简单，但 doubao key 留在 llm-core 之外，违反 ADR-0003。否。
- **embedding / 向量存储并入 kb（不独立）**：engine memory 要消费 kb 才能向量化/存向量，造成 engine→kb 反向依赖。否（见 ADR-0002）。
- **向量化 + 向量存储合为单一 `embedding` 包**：把「算力能力」与「数据库驱动」按「向量」主题捆绑，且包名盖不住 Qdrant 那半；二者本就一为 capability、一为 infra。否（见 ADR-0011）。
- **`vector-qdrant` 取裸 vendor 名 `qdrant`（`@cube-ai/qdrant`）**：与 `bun-server-ext-nacos` 的裸 vendor 名一致，更短。取 `vector-qdrant` 因更自描述（标明「Qdrant 用作向量存储」、利于 AI 导航），`qdrant` 为可接受备选。
