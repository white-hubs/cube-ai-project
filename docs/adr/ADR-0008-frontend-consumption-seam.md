# ADR-0008: 前端消费 seam —— 单一 origin、按领域命名空间路由、按「领域×面」SDK 家族（client/console）

- **Status**: Accepted
- **Date**: 2026-06-05
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: frontend, sdk, routing, consumption, gateway

## Context

前端当前混合消费：一半走 `agentic-sdk`（chat），一半走 ghcloud gateway façade（model/kb/flow 管理），还有 `../../../../knowledge-document/service` 这种深相对 import 直戳后端模块；`cube-ai/web` 又是一套重复全功能前端（已弃用）。

现有 `agentic-sdk-core` 只覆盖 agent/chat 消费面（session/turn/SSE/files/grants/tools/jobs），不含 flow/kb 的管理面，也不含 model 接入管理（catalog）。ADR-0002 + 单进程拓扑意味着 `agent-engine` + `flow-core` + `kb-core` + `llm-core` 在同一 Bun 进程内，HTTP 路由由同一进程服务。

## Decision

### 网络层：单一 origin（统一前门）

AI-center 进程服务所有路由，前端只认**一个 base URL**。按**领域命名空间**分组：

| 领域 | 路由前缀 | 后端包 |
|---|---|---|
| agent（chat） | **`/v1/*`**（sessions / turns(SSE) / files / grants / tools / jobs；canonical，见 [addendum](./ADR-0008-addendum-agent-consumption-face.md)） | `agent-engine` |
| flow | `/flow/*`（CRUD / compile / run / components / playground / webhook / **mcp**(对外 MCP server，ADR-0006 #6) 等**整套**；**独立 SSE 直达**）。注：模型接入(原 flow `settings/model-providers`)**退役**→ llm `/llm/*`；developer key 认证归 host（ADR-0003/0012） | `flow-core` |
| kb | `/kb/*`（documents / knowledge bases / query；**可直达**） | `kb-core` |
| LLM 管理面（catalog） | `/llm/*`（providers / models CRUD / 远程同步 / 连通测试） | `llm-core`（catalog BC） |
| LLM 网关 | `/v1/*`（OpenAI 兼容，见 ADR-0003；前端直流式走此） | `llm-core`（provider BC） |

各能力的管理面 controller 由其能力包提供，但都挂在同一进程同一 origin 下。

### SDK 家族：按领域前缀 + 按「面」（client / console）

命名规范 `<domain>-sdk-<face>[-<framework>]`，**face 必填** ∈ `{client（消费面：chat/run/query）, console（管理面：CRUD/同步/测试）}`，framework 选填（`-vue` / `-assistant` / `-mock`）；派生规则与「单一面也强制带 face」见 **ADR-0011**。

| 域 | client（消费面） | console（管理面） |
|---|---|---|
| agent | `@cube-ai/agent-sdk-client`（+`-vue` / `-assistant` / `-mock`，**重命名自 `agentic-sdk-*`**） | —（暂无） |
| llm | —（chat 走 agent） | `@cube-ai/llm-sdk-console`（模型接入管理） |
| flow | `@cube-ai/flow-sdk-client`（执行） | `@cube-ai/flow-sdk-console`（编辑器，按需） |
| kb | `@cube-ai/kb-sdk-client`（检索） | `@cube-ai/kb-sdk-console`（文档管理，按需） |

前端按需 import 对应「领域 + 面」的 SDK，只走 HTTP/SSE，可复用 contracts wire schema 对齐类型。

### 退役

收编为另起并行新系统（ADR-0010），**消费前端是全新独立项目**；下列「退役」由**新前端不携带这些形态**实现，而非就地改造现网前端（现网前端在整体切换前照常运行）：

- **gateway façade** 与 `@ghcloud/cube-ai-application-service` 代理退役。
- **深相对 import**（如 `../../../../knowledge-document/service`）禁止并删除。
- **`cube-ai/web`** 重复前端不迁移。

## Consequences

- **Positive**：前端只认一个 origin + 按需「领域+面」SDK，消除「一半 SDK 一半 façade」与深相对 import；领域路由前缀使 SDK 与后端 controller 一一对应；`client`/`console` 一眼区分消费面/管理面；flow/kb 各自演进自己的 SDK 不挤占 agent SDK。
- **Negative**：SDK 包数量增多（按领域×面拆）；新增能力需同时加路由前缀 + 对应 `<domain>-sdk-<face>`；`agentic-sdk-*` → `agent-sdk-client*` 重命名需前端同步改 import（因 private 无外部影响）。
- **Neutral**：单 origin 下领域路由仍可由网关/Ingress 按前缀做限流或灰度。

## Options Considered

- **单一 `agent-sdk` 收全部能力（不分面/不分域）**：包少，但 chat 与 flow/kb/llm 管理面耦合进一个包，违反领域分；flow/kb 演进会牵动 agent SDK。否。
- **单一 `agent-sdk-console` 总管理面（跨域）**：比全收进一个包好，但仍把 flow/kb/llm 多个领域的管理面绑在一包。否（取按「领域×面」拆）。
- **`client` / `admin` 词对**：`admin` 直白，但与既定语言（console=mgt）不符，`console` 更贴管理控制台。否（取 `client`/`console`，见 ADR-0011）。
- **多 origin（各能力独立 host）**：与单进程拓扑（ADR-0004/运行时拓扑）矛盾，且重新引入跨 origin 复杂度。否。
- **保留 gateway façade 作前端聚合层**：省一次前端改造，但 façade 正是 C4 要消除的泄漏点。否。
