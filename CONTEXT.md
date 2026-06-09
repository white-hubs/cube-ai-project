# 统一 AI 中台 (Cube AI Platform)

本 context 命名「统一 AI 中台」的领域语言：一个收敛仓作为 **AI 基础能力提供方**，对外只暴露可被上层直接调用的基础能力（LLM · flow · kb · embedding · tool/MCP）。词条聚焦中台特有概念，不含通用编程概念。

## Language

### 平台与边界

**统一 AI 中台**:
单一收敛仓承载的「AI 基础能力提供方」系统；对外只暴露可被上层直接调用的基础能力，不承载业务/页面逻辑。
_Avoid_: AI 应用, 业务后端, ghcloud 平台

**AI 基础能力**:
中台对外暴露的可调用能力集合 —— LLM provider · flow · kb/检索 · embedding（向量化）· tool/MCP。（向量存储是 infra，不算对外能力）
_Avoid_: 业务功能, 页面功能

**能力包**:
拥有单一能力领域、且只经 contracts port 对外暴露该能力的包（`llm-core` / `flow-core` / `kb-core` / `embedding`）。多包领域（llm/flow/kb）含后端核 + 按需 SDK；单包领域（embedding）扁平。**向量存储不在此列——它是 infra（`vector-qdrant`），不是能力包**。命名派生见 ADR-0011。
_Avoid_: 杂烩 adapters 包, 按技术分层切的包, 按 port 派生包名

**agent-engine（活跃运行时）**:
主动驱动 turn（session/turn/SSE/tool 编排）的运行时核心包；经 contracts port 调各能力包。是「engine」一词在本仓的权威所指，与被动能力库（`*-core`）相对。**是唯一运行时真源**（ADR-0012）——cube-ai 的 `assistant` 是玩具、不迁；`agent-engine` / `flow-core` / `kb-core` 是三个**平级下游域**，engine→flow/kb 是能力调用边而非身份层级。
_Avoid_: 把 agent-engine 当能力包之一, 让能力包反向依赖它, 把 cube-ai assistant 当第二运行时迁入, 让 engine 凌驾 flow/kb 当身份权威

**assistant（玩具，不迁）**:
cube-ai 服务拆分后出现的「flow 平台副驾」服务（自带 OpenAI 客户端、session 存 flow repo、module 直连 flow）；与 agent-engine 机制重叠但成熟度低、带反模式。**判定为玩具，留原仓、不迁入中台**（ADR-0012 D1）；其产品价值若需要，以 agent-engine 的 preset 重建。
_Avoid_: 把 assistant 迁入新仓, 搬运其自带 LLM/session 实现

**共享内核 (contracts)**:
零依赖的 port + wire schema + 不变量常量包；跨领域耦合的唯一真源，任何包都可自由 import。
_Avoid_: 公共 util 包, 业务共享库

### LLM 能力

**llm-core（LLM 能力核）**:
LLM 域的单一后端包，内含 **provider**（调用：chat/stream/embed/tool/vision）与 **catalog**（model registry / 凭据权威）两个 BC，经包内 `LlmCatalogPort` 解耦；对外暴露 `LlmProviderPort` + `/llm/*` 管理面 + `/v1/*` 网关。
_Avoid_: 把 catalog 与 provider 拆两个 workspace 包, 沿用旧名 llm-provider

**LLM 调用 (Provider)**:
真正发起 chat / stream / embed / tool-call / vision 的调用能力，由 `LlmProviderPort` 表达；实现于 `llm-core` 的 provider BC。
_Avoid_: 模型目录, 把「列模型」与「调模型」混为一谈

**LLM 目录 (Catalog)**:
「有哪些模型 + 其 endpointType/凭据/modelTypes」的目录解析，由 `LlmCatalogPort` 表达；**权威数据住在中台 `llm-core` 的 catalog BC**（自 ghcloud `llm-catalog` 收编），ghcloud 不再持有。
_Avoid_: 调用能力, runtime 调用, 把 catalog 权威留在 ghcloud

**LLM 网关 (Gateway)**:
LLM 调用能力的**网络面** —— 对外暴露 OpenAI 兼容端点的统一收口，底层复用同一 Provider + Catalog；供异构运行时与远程消费者使用。
_Avoid_: 每消费者各自直连 vendor, 无能力匹配的透传代理

**凭据边界**:
vendor 密钥与 model registry 的唯一权威 = `llm-core` 的 catalog BC；其它消费者只持平台级 key，不持 vendor key。
_Avoid_: 各模块各存 apiKey, 前端持 vendor key, ghcloud 持 vendor 凭据

**单模态 / 多模态协议对齐**:
LLM 网关须以一致协议覆盖纯文本（单模态）与图文输入 / 文生图（多模态）调用，而非每种模态各发散一套 API。
_Avoid_: 文生图另起协议, vision 走旁路接口

**直连 vendor 例外清单**:
尚未收口到 LLM 网关、仍直连 vendor 的已知路径（如当前 Langflow）的显式登记；每项带原因与收口意图，禁止静默新增。
_Avoid_: 隐式直连, 无登记的旁路

### Flow 能力

**Flow 运行时**:
在 AI 中台内执行 flow 图的能力；内部自行选择 **执行后端**，对消费者不可见。**两种消费模式**（ADR-0004）：被 agent-engine 经 `FlowInvokerPort` 编排，**或**前端经 `/flow/*`（独立 SSE）**直达**——flow 是可直达的平级下游域，不只藏在 port 后。
_Avoid_: ghcloud flow.service, DSL 映射层, 把后端选择暴露给 engine, 把 flow 当「只藏在 port 后」的库

**执行后端**:
真正运行 flow 图的可替换引擎 —— **Cube 线性引擎** 或 **Langflow 外部运行时**；由 **Flow 运行时** 内部选择。
_Avoid_: 暴露给上层的后端开关, 把 LF 当唯一引擎

**Cube 线性引擎**:
中台进程内的 **执行后端**，执行 ChatInput→LLM 线性链；其 LLM 调用走 **LLM 调用 (Provider)**。
_Avoid_: 通用图引擎, 自带 openai 客户端

**Langflow 外部运行时**:
经 `LANGFLOW_BASE_URL` 调用的外部 Langflow 服务，执行任意图；本轮不动，属外部依赖且仍在 **直连 vendor 例外清单** 内。
_Avoid_: 中台进程内组件, 把 LF 凭据当中台凭据

**DSL 编译**:
把 Cube flow DSL 编译为 **执行后端** 可运行形态（含 LF 模板）的环节，归 `@cube-ai/flow-core`，与引擎同一 locality。
_Avoid_: ghcloud DSL 映射层, 跨 cube-ai/ghcloud 切两半的编译

### 知识库能力

**知识库 (kb)**:
文档管理 + **摄入** + **检索** 的能力包，经 `KnowledgeQueryPort` 暴露。
_Avoid_: ghcloud knowledge 转发层, 把 **向量存储** 当作 kb

**摄入 (Ingestion)**:
把文档解析、分块为 **Chunk**、做面向向量化的文本规范化的环节，归 `@cube-ai/kb-core`。
_Avoid_: 向量化, 存向量

**检索 (Retrieval)**:
query → 向量化 → **向量存储** 检索（hybrid dense+sparse+RRF + 词法 + rerank + section 聚合）的编排，归 `@cube-ai/kb-core`；经 `EmbeddingPort` 调 **向量化 (Embedding)**，**直连** infra `vector-qdrant` 做向量存取（kb 自建 chunk 感知向量层），「先 embed 再 store」的编排在 kb-core 自身。
_Avoid_: kb 自带 embedding 客户端, 把检索编排塞进向量存储 infra

**向量化 (Embedding)**:
文本 → 向量的能力（**无状态算力**，capability），经 `EmbeddingPort`（`@cube-ai/embedding`）；其模型调用走 **LLM 调用 (Provider)** 的 `embed`，不另持 embedding key。与 **向量存储 (Vector Store)** 连同类都不是——向量化是 capability（port），向量存储是 infra（驱动直连）。
_Avoid_: 各模块自带 doubao/embedding client 与 key, 把向量存储塞进 embedding 包

**向量存储 (Vector Store)**:
存取向量的 **infra**（Qdrant 驱动 `@cube-ai/vector-qdrant`，**有状态**）——连接 / 命名向量(dense·sparse) upsert·query / collection / point-id，只认「向量 + 不透明 payload + id」，**领域无关、无业务语义**。**是 infra 不是 capability**：被 `kb-core` / `agent-engine` **直连**（如同数据库驱动），**不设 `VectorStorePort`**；kb 的 hybrid+chunk 向量层、engine 的 memory 索引各自建在其上、不抽共享 port（ADR-0005）。
_Avoid_: 把向量存储当跨域 capability port, 让其理解 **Chunk** 的业务字段, 设 VectorStorePort, 把向量化与向量存储合成一个包

**Chunk / 切片**:
**摄入** 产出的可向量化文档单元；其 payload 语义归 `@cube-ai/kb-core`，**向量存储**（`vector-qdrant`）仅作不透明载荷承载。
_Avoid_: 把 chunk 业务语义下沉进 **向量存储**

### Tool 能力

**Tool 编排**:
运行时内「LLM `tool_call` → 查 descriptor → 派发 **Tool Handler** → consent/grant/安全 → 结果回灌下一轮」的机制；归**该运行时自身**（当前在 engine），**不抽为共享能力包**。
_Avoid_: 独立 `@cube-ai/tools` 能力包, 跨运行时共享同一 tool 系统

**Tool Handler（薄适配）**:
把一次 tool 调用适配到某能力 port（`FlowInvokerPort` / `KnowledgeQueryPort` / `LlmProviderPort` / `EmbeddingPort`…）的薄层；是**可复制的模式**，不是被共享的代码。
_Avoid_: 在 handler 里复制能力实现, 跨运行时复用同一 handler 包

**MCP 桥接**:
连接外部 MCP server（stdio/sse/http JSON-RPC）的运行时内组件，与 tool registry/consent 紧耦合；其 server 凭据（env/headers）属 **Tool 凭据**。
_Avoid_: 把 MCP 凭据并入 LLM **凭据边界**

**运行时自装配**:
每个需要工具的运行时各自装配同构的 **Tool Handler** 薄适配（engine 现有；未来去 LF 后的 flow 自建），互不共享 **Tool 编排**。
_Avoid_: 让 flow 依赖 engine 的 tool bc, 抽公共 tool 装配层

### 前端消费

**统一前门**:
前端只认的单一 origin —— AI-center 进程按领域命名空间（agent `/v1/*`（[ADR-0008 addendum](docs/adr/ADR-0008-addendum-agent-consumption-face.md)）、`/flow/*`、`/kb/*`、`/llm/*`、LLM 网关 `/v1/*`）服务所有路由。
_Avoid_: gateway façade 聚合层, 多 origin 分散调用, 深相对 import 戳后端

**领域 SDK 家族**:
按「领域 + 面」前缀的前端 SDK，`<domain>-sdk-<face>[-<framework>]`：agent 有 `agent-sdk-client`（重命名自 agentic-sdk-*）、flow/kb 有 `*-sdk-client` 与 `*-sdk-console`、llm 有 `llm-sdk-console`；前端按需引入，只走 HTTP/SSE。
_Avoid_: 单包收全部能力, 前端 import 后端包, 走 gateway façade, 笼统 sdk-core

**SDK 面（client / console）**:
SDK 的必填语义维度：**client = 消费面**（chat/run/query，跑能力拿结果）；**console = 管理面**（CRUD/远程同步/连通测试，管能力）。单一面的域也强制带 face（如 `agent-sdk-client`）。命名见 ADR-0011。
_Avoid_: 用笼统 core 混两面, 用 admin 代替 console

### 运行时拓扑与平台接入

**AI 数据面直连**:
前端的 AI 调用直达 AI-center 领域路由、**绕开 bff-gw 与 java-gateway**，是「4 跳→1 跳」的**目标不变量**；bff-gw/java-gateway 只承载非 AI 流量。
_Avoid_: 把 AI 塞回 bff-gw/java-gateway 后面（退回 2 跳）, 在入口做 AI 语义转发

**qiankun micro-app 外壳**:
ghcloud 前端组合 + 统一登录层；外部登录拿 `auth` 后由各 api call 携带 header。带外、**不算后端跳**，不在 AI 调用链上。
_Avoid_: 把它当成 AI 请求路径上的一跳

**鉴权中心**:
AI-center 拿 `auth` header 经 `platform-adapter-ghcloud` **旁路**校验 token / 解析租户的平台权威；是 AI-center 主动调用,非前置代理。
_Avoid_: 让鉴权中心串在 AI 调用链上当网关

**ghcloud 薄平台 adapter**:
收编后 ghcloud 残留职责 = 实现平台侧**租户身份** port（鉴权/租户解析/可选 L7 透传），不承载任何 AI 业务逻辑、不持 catalog 数据或 vendor 凭据；`ai-server` 退役。
_Avoid_: 在 ghcloud 保留 flow/kb/llm 业务逻辑, 让 ghcloud 持 catalog 权威, L7 入口解析或路由 AI 语义

**host 身份权威 / 三域平级下游**:
身份/租户权威在 **host**（`apps/ai-center`，经 `platform-adapter-ghcloud` 解析），注入请求上下文；`agent-engine` / `flow-core` / `kb-core` 是三个**平级下游域**，各自从上下文消费身份、互不为权威。`agent-engine → flow-core/kb-core` 是**能力调用边**，非身份层级；flow/kb 亦**可直达**（独立 SSE）。身份是**注入式 seam**，收编换源时身份源换 host。
_Avoid_: 让某域当其它域的身份权威, 把 engine→flow/kb 当身份层级, 收编时改动 flow/kb 本体去换身份源

**能力包无自有鉴权**:
`flow-core` / `kb-core` 等能力包**不承载任何自己的鉴权概念**——只管核心功能（执行 flow 图 / 文档摄入检索）。鉴权唯一权威 = host 的 `platform-adapter-ghcloud`（JWT/tenant/PAT）。原 cube-ai server 外壳带来的 flow `auth`（OAuth2 用户登录）、`api-keys`（PAT 签发/校验）、`allowed_tools` 工具白名单**全是平台外壳概念、随收编弃**，非 flow 本体概念。flow 调 Langflow 用的 key 属 **Langflow 的鉴权**（外部依赖凭据，见直连 vendor 例外清单），亦非 flow 自有鉴权。agent 运行时调工具的授权/consent 是 **agent-engine 自带 `bc/authz`**（与已弃的 flow `allowed_tools` 是两回事），保留。
_Avoid_: 让 flow/kb 自管登录/PAT/用户表, 把 cube-ai 外壳的 auth 当 flow 本体功能搬入, 把 flow allowed_tools 与 engine authz 混为一谈

**租户隔离主键 (tenant)**:
合并后系统的**唯一隔离主键 = tenant**（来自鉴权中心 JWT，经 `platform-adapter-ghcloud` 解析）。**cube-ai 自有的 `project` 概念已整体退役**——既删 ghcloud `ai_center_api_key`（项目 key），也删 flow 的 `projects` 容器表/CRUD 与"自助建 project"流程，并把 flow/kb 本体的物理列 `project_id` 全量改名为 `tenant_id`（含 Qdrant payload 键、access-scope 读符号 `currentProjectId()`→`currentTenantId()`）。**这是对 ADR-0012「换源不动本体」在 project 维度的有意覆盖**：tenant 成为贯穿三域的单一隔离语义，不再有 project 这层中间容器。
_Avoid_: 保留 cube-ai project 概念, 一个 tenant 下多个 project, tenant→project 目录映射, 把 projectId 当独立于 tenant 的隔离层

## Relationships

- **能力包** 只经 **共享内核 (contracts)** 的 port 暴露其 **AI 基础能力**
- **LLM 调用 (Provider)** 消费 **LLM 目录 (Catalog)** 来解析模型运行时配置；二者同处 `llm-core` 的两个 BC
- **LLM 目录 (Catalog)** 权威住 `llm-core`，`platform-adapter-ghcloud` 退为**租户身份**（解析 `tenantId` 流入 catalog），不再是 catalog 数据源
- **LLM 网关 (Gateway)** 是 **LLM 调用 (Provider)** 的网络面，与进程内 `LlmProviderPort` 共用同一实现
- **凭据边界** 收束于 `llm-core`；同进程消费者走 `LlmProviderPort`，异构/远程消费者走 **LLM 网关**
- 仍直连 vendor 的路径（当前 Langflow）登记入 **直连 vendor 例外清单**，不视为终态
- **Flow 运行时** 经 `FlowInvokerPort` 暴露，内部在 **Cube 线性引擎** 与 **Langflow 外部运行时** 间选择 **执行后端**
- **Cube 线性引擎** 的 LLM 调用走 **LLM 调用 (Provider)**；**Langflow 外部运行时** 仍直连 vendor（例外清单）
- **DSL 编译** 与 **执行后端** 同处 `@cube-ai/flow-core`，不再跨 ghcloud/cube-ai 切两半
- **知识库 (kb)** 经 `KnowledgeQueryPort` 暴露；内部 **摄入** 产出 **Chunk**，经 **向量化 (Embedding)** 算向量、**直连** **向量存储 (Vector Store)** infra 存取
- **向量化 (Embedding)** 的模型调用走 **LLM 调用 (Provider)** 的 `embed`，凭据单源于 `llm-core`
- **向量化 (Embedding)** 是 **capability 包**、**向量存储 (Vector Store)** 是 **infra**（`vector-qdrant`），互不依赖；维度↔collection vectorSize 的对齐在组合根 config 完成，非任一包内部不变量
- **向量存储 (Vector Store)** 领域无关（infra，不设 port）；**Chunk** 的 payload 语义归 **知识库 (kb)**；agent-engine 的 memory/semantic-index 复用同一 `@cube-ai/embedding`，向量存取各自**直连共享 infra `vector-qdrant`**（不共享向量层、不抽 port）
- **Tool 编排** 归运行时自身（agent-engine）；**Tool Handler** 经 contracts port 消费各 **AI 基础能力**，与 agent-engine 调能力同一依赖方向
- **MCP 桥接** 的 **Tool 凭据** 独立于 LLM **凭据边界**；二者是两类凭据
- **运行时自装配**：agent-engine 与（未来的）flow-core 各自装配 **Tool Handler**，不共享 **Tool 编排**
- 前端只经 **统一前门** 的领域路由消费中台；**领域 SDK 家族** 按「领域+面」（`agent-sdk-client*` / `flow-sdk-{client,console}` / `kb-sdk-{client,console}` / `llm-sdk-console`）各自演进
- 前端直流式 LLM 走 **统一前门** 下的 **LLM 网关**（`/v1/*`），不直连 vendor
- **AI 数据面直连** 是目标不变量：前端 AI 调用直达 AI-center、绕开 bff-gw/java-gateway；**qiankun micro-app 外壳** 提供带外统一登录，**鉴权中心** 经 **ghcloud 薄平台 adapter** 被 AI-center 旁路调用
- **运行时单一真源**（ADR-0012）：`agent-engine` 是唯一活跃运行时；cube-ai 的 **assistant（玩具，不迁）** 不入中台，其产品价值若需要以 agent-engine preset 重建
- **三域平级下游**：`agent-engine` / `flow-core` / `kb-core` 各自从 **host 身份权威 / 三域平级下游** 注入的上下文消费身份、互不为权威；`agent-engine → flow-core/kb-core` 是能力调用边；**flow-core / kb-core 自带独立 SSE 可直达**
- **flow / kb 整套收编**，自带横切收归：身份→host 注入源、凭据→`llm-core` catalog；因身份是**注入式 seam**，换源不动本体（ADR-0004/0012）

## Example dialogue

> **Dev:** “flow 里 Langflow 节点自己存了 api_key 直接调模型，这算中台的 LLM 能力吗？”
> **Domain expert:** “那是一条还没收口的路径。中台的 **LLM 调用 (Provider)** 唯一实现在 `llm-core`；Langflow 现在直连 vendor，属于 **直连 vendor 例外清单** 里的已知项，本轮不动，但不是终态。”
>
> **Dev:** “前端要做流式对话，能不能前端直接拿 key 调 OpenAI？”
> **Domain expert:** “不行——那会越过 **凭据边界**。前端走 **LLM 网关**：OpenAI 兼容端点、平台 token 鉴权，浏览器永不持 vendor key。”
>
> **Dev:** “网关和 `LlmProviderPort` 是两套东西吗？”
> **Domain expert:** “一核两面。同进程的 agent-engine 走进程内 **LLM 调用 (Provider)** port；异构运行时和远程消费者走 **LLM 网关**。底层是同一个 Provider + **LLM 目录 (Catalog)**，都在 `llm-core` 内。”
>
> **Dev:** “那‘列出有哪些模型’也归 Provider 吗？”
> **Domain expert:** “不。列模型与解析凭据是 **LLM 目录 (Catalog)**（`LlmCatalogPort`，权威数据在中台 `llm-core`，不在 ghcloud）；发起调用才是 **LLM 调用 (Provider)**。Provider 消费 Catalog，别混。”
>
> **Dev:** “文生图要不要单独开一套接口？”
> **Domain expert:** “不要。遵守 **单模态 / 多模态协议对齐**：纯文本与图文/文生图在网关里走一致协议，不为每种模态发散 API。”
>
> **Dev:** “agent-engine 想加个新能力，能直接 import flow-core 包的实现吗？”
> **Domain expert:** “不能。跨领域只有 **共享内核 (contracts)** 的 port 一条路。flow-core 是 **能力包**，agent-engine 经 `FlowInvokerPort` 调它，绝不直接 import 实现。”

## Flagged ambiguities

- “provider” 同时被用于「模型目录里的厂商(provider/typeCode)」与「调用能力(LlmProviderPort)” —— resolved: 目录里的厂商归 **LLM 目录 (Catalog)**；调用能力才叫 **LLM 调用 (Provider)**
- “网关” 易与 ghcloud 的 gateway-service 代理 façade 混淆 —— resolved: 此处 **LLM 网关** 特指中台 LLM 调用的网络面（OpenAI 兼容 + 能力匹配），不是平台路由代理
- “tool-call” vs “tool 编排” —— resolved: **LLM 调用 (Provider)** 只产出/解析 wire 层 `tool_call`；查 descriptor、派发、consent、执行属 **Tool 编排**（agent-engine）
