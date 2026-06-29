# ADR-0002: 领域包边界与依赖方向（contracts 为唯一共享内核，port 为唯一跨域 seam）

- **Status**: Accepted
- **Date**: 2026-06-05
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: architecture, package-boundaries, ports-and-adapters, dependency-direction

## Context

ADR-0001 决定在新仓 `cube-ai-project` 按中台领域重做边界。旧三仓的能力（LLM 调用、flow、kb）被实现 2–3 遍且互相用「深相对 import / HTTP header 约定 / DSL 字符串」缝合，能力跨边界泄漏。新仓必须先钉死「有哪些领域包、谁依赖谁、跨域用什么接口」，否则会重演同样的耦合。

`cube-agentic-engine` 现状提供了正确雏形：`@cube-ai/contracts` 已用 zod 定义 `FlowInvokerPort` / `KnowledgeQueryPort` / `LlmCatalogPort`，但旧 `agentic-adapters` 是 provider+memory+embedding+vector+bullmq+observability+safety 的杂烩包，领域未分。

## Decision

### 领域包清单（@cube-ai/\*）

> 包名派生规则、目录布局、SDK 面命名见 **ADR-0011**（命名哲学）；本表是其在「包边界与依赖」语境下的权威清单。

| 包                         | 领域职责                                                                                                                           | 对外暴露                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `contracts`                | port + wire schema + 不变量常量；零依赖（仅 zod）                                                                                  | 共享内核                                                                 |
| `agent-engine`             | session/turn/SSE/tool 编排（活跃运行时）                                                                                           | 消费 ports                                                               |
| `llm-core`                 | chat·stream·embed·tool-call·vision + 能力匹配 + 目录驱动路由；**含 catalog 权威**（model registry / vendor 凭据，自 ghcloud 收编） | `LlmProviderPort`（内部经 `LlmCatalogPort` 解耦 provider/catalog 两 BC） |
| `flow-core`                | flow 引擎 / Langflow / DSL / components / playground / webhook 等**整套**（自 cube-ai 收编，横切收归；ADR-0012/0004）              | `FlowInvokerPort` + 直达 `/flow/*`（独立 SSE）                           |
| `kb-core`                  | 检索 / ingestion（自 cube-ai **整套**收编）                                                                                        | `KnowledgeQueryPort` + 直达 `/kb/*`                                      |
| `embedding`                | 向量化（文本→向量，无状态算力，经 `LlmProviderPort.embed`），跨 kb/agent-engine 共享                                               | `EmbeddingPort`                                                          |
| `agent-sdk-client*`        | agent/chat 消费面（`-vue` / `-assistant` / `-mock`），只走 HTTP/SSE                                                                | —                                                                        |
| `<domain>-sdk-<face>`      | 各能力 client/console SDK（`flow-sdk-{client,console}` / `kb-sdk-{client,console}` / `llm-sdk-console`），按需                     | —                                                                        |
| `platform-adapter-ghcloud` | 平台侧**租户身份**（鉴权 / 租户解析）；**不再实现 `LlmCatalogPort`**                                                               | 实现平台身份 port                                                        |

> **`llm-core` 是多包领域的后端核**：catalog（model registry + vendor 凭据，原 ghcloud `llm-catalog`）与 provider（调用）同生命周期、同凭据域，**合为一个包内的两个 BC**（`src/catalog` / `src/provider`），非两个 workspace 包——遵循 ADR-0011「包=seam 非 responsibility」。其管理面经 `llm-sdk-console` 消费。
>
> **`embedding` 是 capability 包，向量存储是 infra（不设 port）**：向量化是**算力能力**（选模型 / 经 provider 管凭据 / 维度·缓存·规范化）——`@cube-ai/embedding` + `EmbeddingPort`；向量存储是**数据库**（Qdrant 驱动）——落 `infra/vector-qdrant`（`@cube-ai/vector-qdrant`），被 kb-core/agent-engine **直连**，**不设 `VectorStorePort`**（不在上表，属 infra）。二者连「同类」都不是（capability vs infra），自然不合并；kb 的 hybrid+chunk 向量层留 kb-core、engine memory 索引留 engine，**各自建在共享 `vector-qdrant` 上、不抽共享 port**。详见 ADR-0005。
>
> **运行时单一真源 + 三域平级**（ADR-0012）：`agent-engine` 是唯一活跃运行时真源；cube-ai 的 `assistant`（玩具）**不迁、不入本清单**——其产品价值若需要，以 agent-engine 的 preset（系统提示 + 经 port 调 flow-core/llm-core 的 tool handler）重建。`agent-engine` / `flow-core` / `kb-core` 是三个**平级下游域**：身份由 host 注入（ADR-0009 D2），`agent-engine → flow-core/kb-core` 是**能力调用边**而非身份层级，flow-core/kb-core 亦**可直达**（独立 SSE）。

### 依赖铁律

1. **`contracts` 是唯一共享内核**：零依赖，所有包均可直接 import 其 port / schema / 常量。
2. **能力包（llm-core / flow-core / kb-core / embedding）只实现 contracts 的 port**，绝不依赖 `agent-engine`，绝不 import 对方的**内部实现**。能力包**可经 contracts 的 port + DI 消费另一能力**（如 flow-core/kb-core/embedding 消费 `LlmProviderPort`，kb-core 消费 `EmbeddingPort`）——这不是违规，因为耦合只发生在 contracts port 上、且**运行时端口图必须无环**。**infra 例外**：`infra/*`（`bun-server-ext-*` / `vector-qdrant` / `test-infra`）不是领域能力，可被任何包**直连**（如 kb-core、agent-engine 直连 `vector-qdrant`），不受「跨域只走 port」约束。注意 `embedding`（capability）与 `vector-qdrant`（infra）**互不依赖**。
3. **`agent-engine` 调用任何能力的唯一通道是 contracts 的 port**（经 DI 注入 adapter），不得直接 import 能力包实现文件。
4. **`platform-adapter-ghcloud` 实现平台侧身份 port**（鉴权/租户解析），由 DI 装配，不被业务包反向依赖；**catalog 数据不再由它拉取**（model registry/凭据已收编进 `llm-core`）。
5. **`agent-sdk-client*` / `<domain>-sdk-<face>` 只走 HTTP/SSE**，不 import 任何后端包；可复用 contracts 的 wire schema 做类型对齐。

一句话：**跨领域耦合只有 contracts port 一种；contracts 是唯一可被自由 import 的共享内核。**

### 允许的运行时端口图（必须无环）

```
agent-engine ─▶ FlowInvokerPort               ─▶ flow-core
agent-engine ─▶ KnowledgeQueryPort            ─▶ kb-core
agent-engine ─▶ LlmProviderPort               ─▶ llm-core
agent-engine ─▶ EmbeddingPort                 ─▶ embedding       （memory 投影/召回）
flow-core    ─▶ LlmProviderPort               ─▶ llm-core
kb-core      ─▶ EmbeddingPort                 ─▶ embedding
embedding    ─▶ LlmProviderPort               ─▶ llm-core
agent-engine ─▶ 平台身份 port（鉴权/租户）     ─▶ platform-adapter-ghcloud
             （llm-core 内部：provider BC ─▶ LlmCatalogPort ─▶ catalog BC）

  infra 直连（非 port 边，不计跨域 seam）：
  kb-core / agent-engine ──▶ infra/vector-qdrant ──▶ Qdrant（外部中间件）
```

- **本次跨包边变化**：移除旧边 `llm-provider ─▶ LlmCatalogPort ─▶ platform-adapters-ghcloud`——catalog 权威收编进 `llm-core` 后，`LlmCatalogPort` 退化为 **`llm-core` 内部** provider/catalog 两 BC 的接缝；`platform-adapter-ghcloud` 仅保留**平台身份**边（鉴权/租户）。
- 禁止反向边（如 `llm-core → embedding`、`embedding → kb-core`、`vector-qdrant → *`（infra 不反依赖任何能力包）、`* → agent-engine`）。新增能力消费关系前必须确认不引入环。

### LlmCatalogPort 与 LlmProviderPort 是两个 port（同处 llm-core 内）

- `LlmCatalogPort` = 目录解析：「有哪些模型 + 其 endpointType/凭据/modelTypes」。**数据权威住在 `llm-core` 的 catalog BC（中台）**，自 ghcloud `llm-catalog` 收编（model registry + vendor 凭据 + 远程同步 + 连通测试 + 租户级 provider 配置）。
- `LlmProviderPort` = 调用能力：chat/stream/embed/tool/vision。
- 关系：**Provider 消费 Catalog**（`CatalogDrivenProvider` 先经 `LlmCatalogPort` 解析配置再分发到 openai/anthropic）。二者不合并，但**同属 `llm-core` 一个包内的两个 BC**，`LlmCatalogPort` 退化为包内接缝（非跨包边）。
- **Catalog / 凭据权威在 `llm-core`**：model registry 与 vendor 凭据的唯一权威 = `llm-core/catalog`。`platform-adapter-ghcloud` **不再拉取或持有 catalog 数据**，退化为**租户身份提供方**（校验 token、解析 `tenantId`）；`tenantId` 作为请求上下文流入 `llm-core/catalog` 做租户级模型/凭据解析，**不构成 `llm-core → ghcloud` 依赖边**。

## Consequences

- **Positive**：任意两包对话只有 port 一条路，bug/能力收敛到单一 locality；能力包可在测试里用 in-memory adapter 替换；旧 `agentic-adapters` 杂烩按领域拆解；catalog 收编后 model registry/凭据权威单源于 `llm-core`，ghcloud 不再是第二权威。
- **Negative**：新增能力时必须先在 contracts 定义 port，前期仪式更重；`embedding` 独立成包后 kb-core 与 agent-engine 经 `EmbeddingPort` 消费多一层间接；向量存储作 infra 直连（不设 port）意味着 kb 与 engine **各自维护向量层、不强行共享**（刻意避免错误抽象，见 ADR-0005）；catalog 收编需把 ghcloud 的租户级 provider 数据迁入 `llm-core`（数据迁移见 ADR-0010 未决项）。
- **Neutral**：`agent-sdk-client*` / `<domain>-sdk-<face>` 与后端通过 contracts wire schema 对齐类型，schema 变更需双侧同步。

## Options Considered

- **允许 `agent-engine` 直接 import 能力包实现（无 port）**：省去仪式，但立刻重演「能力跨边界泄漏、无法 mock、bug 多处改」的旧病。否。
- **保留单一 `adapters` 杂烩包**：迁移成本低，但领域不分，违反 ADR-0001 的「按中台领域划分」。否。
- **合并 Catalog 与 Provider 为单一 LLM port**：接口更少，但把「目录解析」与「调用能力」两种关注点绑死，能力匹配与凭据管理纠缠。改为：两 port 保留，但收编后同处 `llm-core` 一个包内的两个 BC（包=seam，ADR-0011）。否（不合并 port）。
