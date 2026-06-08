# ADR-0009: 运行时拓扑 —— 单进程 AI-center + compose 编排有状态中间件；ghcloud 退化为薄平台 adapter

- **Status**: Accepted
- **Date**: 2026-06-05
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛；运行时拓扑由用户预锁）
- **Tags**: runtime, deployment, topology, single-process, ghcloud, observability

## Context

「代码 locality（单 monorepo）」与「运行时进程/容器拓扑」是两条正交轴。ADR-0002~0008 已定代码 locality；本 ADR 定运行时形态。

事实基线：cube-ai 与 agentic-engine 的 app 层现状各自就是单 Bun 进程；Langflow 是外部服务（ADR-0004）；两边都依赖一组有状态后端（MySQL / Redis / Qdrant / 可选 Nacos·otel）。

> **cube-ai 服务拆分后的事实修订**（详见 [`../architecture/cube-ai-current-state.md`](../architecture/cube-ai-current-state.md)）：cube-ai 的 `bootstrap` 已把 `assistant + flow + kb` 装成**单进程**；身份/租户**源**在 flow + server-base（经 `server-shared` async 上下文 + 中间件工厂注入），**非 ghcloud**；Nacos 注册已 `noop`。cube-ai 的 `assistant`（玩具）**不迁**（ADR-0012 D1）。

## Decision

### 进程拓扑：单进程 AI-center

1. **单 Bun 进程**承载 agent-engine + flow-core 编排 + Cube 线性引擎 + kb-core + embedding（+ 共享 infra `vector-qdrant` 驱动），能力间**进程内经 port 互调**（向量存储是 infra，kb/engine 直连；不拆成多 HTTP 服务）。这正是保住 ADR-0004 C2「4 跳→1 跳」收益的前提——拆独立 HTTP 服务会把刚消除的浅跳加回来。
2. **进程内含**：job worker / outbox relay / SSE drain loop 等后台 loop（按 `worker.*` ns）。kb **批量摄入向量化**虽是 CPU/IO 密集负载，收编当下规模未达独立伸缩阈值，因此做成**进程内 job worker（`worker.ingest.*` ns）+ 队列削峰/背压**，而非 day-1 拆 worker 进程——提前拆即提前引浅跳。真实尖峰扛不住时再走下方「同镜像不同入口」路径。
3. **显式排除在单进程之外**：Langflow（外部运行时，ADR-0004）、MySQL / Redis / Qdrant / 可选 Nacos·otel（有状态中间件，各自独立容器）、LLM vendor（外部 API）。

> **组合根 app = `apps/ai-center`**（原 `ai-core`，按 ADR-0011 命名）：单进程宿主/DI 装配点，把 `agent-engine` / `flow-core` / `kb-core` / `llm-core` / `embedding` 经 contracts port 装配为一个 Bun 进程（向量存储 `vector-qdrant` 是 infra，由 kb-core/agent-engine 直连，非 port 装配）。**`assistant`（cube-ai 玩具）不在装配清单内**（ADR-0012 D1）。

### 身份模型：host 身份权威，三域平级下游（D2，ADR-0012）

- **身份/租户权威在 host**（`apps/ai-center` 组合根，经 `platform-adapter-ghcloud` 向鉴权中心校验 token、解析租户），注入请求上下文。
- **`agent-engine` / `flow-core` / `kb-core` 是三个平级下游域**，各自从上下文消费身份，**不互为身份权威**：
  - `agent-engine → flow-core/kb-core` 是**能力调用边**（编排），**非身份层级**。
  - **flow-core / kb-core 自带独立 SSE，可直达**（前端可不经 engine 直接访问，ADR-0004/0008）。
  - 三域互不冲突：engine 编排、flow 流程、kb 检索是三条领域 seam。
- **收编换源不动本体**：cube-ai 现状身份源在 flow（`createFlowAccessTokenReader` / `ProjectLookup` 注入 `server-shared` 上下文）；因身份是**注入式 seam**（本体只读 `currentProjectId()`），收编时把注入源换成 host，**flow/kb 本体不改**。assistant 的身份消费随其不迁一并废弃。

### 部署形态

- **Docker Compose**：一个编排文件 —— `ai-center`（1 容器）+ MySQL / Redis / Qdrant（各独立 service）+ 可选 Nacos/otel。
- **Kubernetes**：1 个 `Deployment + HPA` 扩 `ai-center`（无状态）；中间件走托管实例或 StatefulSet（Qdrant + PVC）。

### 何时才拆独立服务

仅当某基础能力出现**真实的扩展 seam**——如 kb 的 ingestion/vectorization 批处理变 CPU/IO 密集、或 flow 长时执行需独立伸缩。届时拆为**同镜像、不同入口**的 worker 进程；触发前一律进程内，避免提前拆引入浅 HTTP 跳。

### 日志：按 ns 过滤，不靠拆进程

沿用 agentic-engine 的 pino 结构化 JSON 日志 + `LoggerFactory.getLogger(ns)` 子 logger + OTel 三支柱。收编时分配 ns：`flow.*` / `kb.*` / `provider.*`，后台 loop 用 `worker.*`。单进程一个 `traceId` 贯穿 agent-engine→flow-core→kb-core，按 ns 切流分离各能力日志。「多服务日志混一起」是日志规范问题，不是进程拓扑问题。

### ghcloud 退化为薄平台 adapter（C5）

- `ghcloud ai-server`（health + gRPC 壳，纯 pass-through）**退役**。
- `ghcloud ai-application` 的 flow compile/DSL 映射、kb 转发、llm-catalog（model registry/凭据）业务逻辑收编进中台（flow→`flow-core`、kb→`kb-core`、catalog→`llm-core`；ADR-0002/0003/0004/0005）后，**仅剩平台胶水**：鉴权 / 租户解析（**租户身份提供方**）= `platform-adapter-ghcloud` 实现平台身份 port，**不再承载任何 AI 业务逻辑或持有 catalog 数据**。

### 请求路径：AI 数据面直连（目标不变量）

收编后 ghcloud 退到调用链**旁路**而非**串联**：

1. **AI 数据面直连**（target invariant）：前端的 AI 调用**直达 AI-center**（ADR-0008 的领域路由 agent `/v1/*`（见 [addendum](./ADR-0008-addendum-agent-consumption-face.md)）`/flow/*` …），**绕开 bff-gw 与 java-gateway**——这两个暴露只承载非 AI 流量。这是「4 跳→1 跳」的架构承诺；要把 AI 塞回 bff-gw/java-gateway 后面（退回 2 跳）须推翻本不变量。
2. **统一登录带外**：ghcloud 应用基于 qiankun micro-app 外壳，外部统一登录后拿到 auth；后续 `auth` header 随各 api call 携带。该外壳是**前端组合 + 登录**层，带外、**不算后端跳**，不在 AI 调用链上。
3. **鉴权旁路**：AI-center 拿 header 经 `platform-adapter-ghcloud` 向**鉴权中心**校验 token / 解析租户上下文——这是 AI-center *主动旁路*调用，非前置代理。
4. **若将来需统一入口治理**：用「平台级 L7 透传」满足（SSO/WAF/TLS，多产品共用，**不解析也不路由 AI 语义**），而非退回 bff-gw/java-gateway 的语义转发。L7 一旦开始读 AI 路由做分发/改写即违反本不变量。

## Consequences

- **Positive**：保住「4 跳→1 跳」（AI 数据面直连为目标不变量，绕开 bff-gw/java-gateway）；单 traceId 全链可观测；HPA 水平扩容简单；中间件生命周期与 app 解耦；ghcloud 职责收窄到平台接入（鉴权旁路至鉴权中心）。
- **Negative**：单进程内不同能力共享伸缩单元，未到扩展 seam 前无法独立扩；Langflow/中间件仍是外部依赖，部署需编排它们。
- **Neutral**：扩展 seam 出现时的「同镜像不同入口」worker 拆分是预留路径，非当前形态。

## Options Considered

- **flow/kb 拆独立 HTTP 服务**：可独立伸缩，但把 C2 刚消除的浅跳加回来、需分布式追踪拼请求。否（除非真实扩展 seam）。
- **靠拆进程分离日志**：代价大且重引浅跳；结构化日志 + ns 已解决。否。
- **保留 ai-server/ai-application 承载 AI 逻辑**：维持现状，但 6 薄层穿透与重复实现不消除。否。
