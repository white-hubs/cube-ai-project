# ADR-0011: 包命名哲学 —— 包边界=seam 非 responsibility，路径派生包名，SDK 按「面」命名

- **Status**: Accepted
- **Date**: 2026-06-05
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: naming, package-boundaries, sdk, conventions, seam

## Context

包/目录命名经 v1–v5 多轮 grill，暴露三类痛点：

- **`sdk-core` 笼统**：一个词混了「后端核心库」「管理面」「消费面」三种东西，读名分不清是给谁用的。
- **后端包命名零散**：`engine` / `llm-provider` / `flow` / `kb` 各按局部便利取名，没有可派生的统一规则；`platform-adapters-ghcloud` 又把复数集合目录直接拼进包名。
- **「该不该拆包」无判据**：每加一个能力/SDK 都要重新争论放哪、是否独立成包。

事实基线：所有 `@cube-ai/*` 包均 `private`、不发 registry（ADR-0007），更名零外部成本。需要一条**可机械派生的命名规则**＋**包边界判据**，让命名与拆分不再是每次的临时争论。

## Decision

### 核心原则：包 = seam，不是 responsibility

一个 workspace 包对应一条**真实接缝**——独立消费者 / 独立生命周期 / 明确的依赖方向。不是每个「职责」都拆一个包。

- **先例**：`agent-engine` 是单包，但内部有 `src/bc/*` 多个 bounded context（session / tools / jobs / safety / authz / usage…）。BC 多 ≠ 包多。
- **反例（合）**：不因「catalog 与 provider 是两种职责」就拆两个包——它们同生命周期、同部署单元、同凭据域，合为 `llm-core` 内的两个 BC（`src/provider`、`src/catalog`），经内部 `LlmCatalogPort` 解耦即可。
- **正例（拆，且分层）**：向量化与向量存储虽都关乎「向量」，却**连同类都不是**——`embedding` 是 **capability**（无状态算力 → llm-core，`EmbeddingPort`），向量存储是 **infra**（Qdrant 驱动 → `infra/vector-qdrant`，被 kb/engine 直连、**不设 port**）。故既不合并、也不并列为两个 capability 包（ADR-0005）。与 catalog/provider 合包恰成对照——**是合是拆、是 capability 还是 infra，都看 seam 与本质，不看主题相关性**。
- **升格判据**：只有当某 BC 出现**独立消费者**、**独立伸缩/部署生命周期**、或需要**强制依赖方向**时，才把它升格为独立 workspace 包；反之合并。

### 顶层根（裁剪且语义化）

- `packages/` —— 能力包与 SDK。
- `apps/` —— 组合根 / 部署单元（`ai-center`，ADR-0009）。
- `infra/` —— 基础设施扩展（`bun-server-ext/*`）、数据存储驱动（`vector-qdrant`）与测试夹具（`test-infra`）。

### 包名派生规则

1. **包名 = `@cube-ai/` + 去掉顶层根后的路径段用 `-` 连接**。
   - `packages/flow/core` → `@cube-ai/flow-core`
   - `packages/agent/sdk-client-vue` → `@cube-ai/agent-sdk-client-vue`
2. **集合目录单数化**：持有同类兄弟子包的目录在磁盘上取自然复数，但进包名前缀时**单数化**。
   - `packages/platform-adapters/ghcloud` → `@cube-ai/platform-adapter-ghcloud`
   - 框架名目录用单数：`infra/bun-server-ext/sse` → `@cube-ai/bun-server-ext-sse`
3. **领域目录**（agent / flow / kb / llm）本就单数，直接进包名。
4. **单包领域扁平**（不开子目录）：`packages/contracts`、`packages/embedding` → `@cube-ai/contracts`、`@cube-ai/embedding`。**多包领域开子目录**：agent / flow / kb / llm。（向量存储是 infra：`infra/vector-qdrant` → `@cube-ai/vector-qdrant`）

> 工程注：领域目录（`agent/`、`flow/`、`kb/`、`llm/`、`platform-adapters/`）**不含 `package.json`**，是纯分组目录；只有叶子目录是真包。workspaces glob 仅匹配叶子（见 repo-layout）。

### 后端能力包：领域名词，不按 port 派生

- 包名取**领域名词**（agent / flow / kb / llm / embedding），不叫 `*-provider` / `*-invoker` / `*-query`——那是 port 的命名，不是实现包的命名（一个包可实现多 port，按 port 命名会崩）。
- **活跃运行时 vs 被动库的刻意区分**：
  - `agent-engine` —— 主动驱动 turn 的**活跃运行时**，用 `engine`。
  - `flow-core` / `kb-core` / `llm-core` —— 被 `agent-engine` 经 port 调用的**被动能力库**，用 `core`。
  - `embedding` / `contracts` —— 单包，扁平无后缀。（向量存储是 infra `vector-qdrant`，不在能力包之列）

### SDK 按「面」命名：`<domain>-sdk-<face>[-<framework>]`

- **face 必填**，∈ `{client, console}`：
  - **`client` = 消费面** —— chat / run / query：跑能力、拿结果。
  - **`console` = 管理面** —— CRUD / 远程同步 / 连通测试 / 配置：管能力。
- **framework 选填（三级后缀）**：`-vue` / `-assistant` / `-mock`（框架或形态绑定）。
- **单一面的域也强制带 face**：agent 当前只有消费面，仍叫 `agent-sdk-client`（及 `agent-sdk-client-vue` / `-assistant` / `-mock`）；未来加管理面（`agent-sdk-console`）不破坏既有命名。
- SDK 只走 **HTTP/SSE**，不 import 任何后端包；复用 `contracts` 的 wire schema 做类型对齐（ADR-0002 / 0008）。

### 最终包清单（v6 权威）

| 域 | 后端包 | client（消费面） | console（管理面） | 前门路由 |
|---|---|---|---|---|
| agent | `agent-engine` | `agent-sdk-client`（+`-vue`/`-assistant`/`-mock`） | —（暂无） | `/v1/*`（[ADR-0008 addendum](./ADR-0008-addendum-agent-consumption-face.md)） |
| llm | `llm-core`（provider 调用 + catalog 权威） | —（chat 走 agent） | `llm-sdk-console`（模型接入管理） | 管理 `/llm/*`、网关 `/v1/*` |
| flow | `flow-core` | `flow-sdk-client`（执行） | `flow-sdk-console`（编辑器，按需） | `/flow/*` |
| kb | `kb-core` | `kb-sdk-client`（检索） | `kb-sdk-console`（文档管理，按需） | `/kb/*` |
| embedding | `embedding`（向量化·capability） | — | — | （内部能力，无独立前门路由） |
| 共享内核 | `contracts` | — | — | — |
| 平台适配 | `platform-adapter-ghcloud`（租户身份） | — | — | — |
| 基础设施 | `bun-server-ext-{sse,outbox,nacos}` · `vector-qdrant`（Qdrant 驱动，kb/engine 直连） · `test-infra` | — | — | — |

> 本表是 ADR-0002（包清单）、ADR-0003（llm 一核）、ADR-0008（SDK/路由）的命名收口；与 `docs/architecture/repo-layout-and-dependencies.md`（v6）的目录视图一一对应。
>
> **cube-ai 服务拆分后的命名对照**（ADR-0012；源现状见 `docs/architecture/cube-ai-current-state.md`）：`@cube-ai/flow` → `flow-core`、`@cube-ai/kb` → `kb-core`、`@cube-ai/bootstrap` + `@cube-ai/server-base` 的 host 职责 → `apps/ai-center`（组合根 + 身份注入）、`@cube-ai/server-shared` 的身份上下文原语 → host/contracts 层。**`@cube-ai/assistant`（玩具）不迁、无对应包**。

## Consequences

- **Positive**：新包名可由路径**机械派生**，不再每次争论；`client`/`console` 一眼区分消费面/管理面，`engine` vs `core` 把「活跃运行时/被动库」编码进名字；「包=seam」判据挡住按职责过度拆包，也给「何时升格 BC 为包」一个明确触发条件。
- **Negative**：单一面域仍带 `client` 略冗余（`agent-sdk-client` 而非 `agent-sdk`）；多包领域引入一层子目录，路径更深；既有 ADR/源码中的旧名（`engine` / `llm-provider` / `@cube-ai/flow` / `@cube-ai/kb` / `ai-core` / `agent-sdk-*` / `platform-adapters-ghcloud`）需一次性 re-home（本仓 greenfield、private，无外部影响）。
- **Neutral**：命名是约定而非铁律；真出现独立消费者/生命周期再把某 BC 升格为包，或反向合并，均回到「包=seam」判据裁定。

## Options Considered

- **维持 `sdk-core` 笼统命名**：包少，但混「后端 core / 管理面 / 消费面」三义，正是本 ADR 要消除的歧义。否。
- **`client` / `admin` 词对**：`admin` 更直白，但与用户既定语言（console=mgt）不符，且 `console` 更贴「管理控制台」语义。取 `client` / `console`。
- **单一面域省略 face（`agent-sdk`）**：名更短，但读名看不出是哪个面、加第二面时被迫改名、与「face 必填」规则自相矛盾。否（取强制带 face）。
- **按 port 派生后端包名（`llm-provider` / `flow-invoker`）**：与 port 一一对应看似整齐，但把「实现包」与「接口」绑死，一个包实现多 port 时命名即崩。否（取领域名词）。
- **catalog 与 provider 拆两个包**：职责更分，但二者同生命周期/部署/凭据域，拆包只增 seam 不增价值，违反「包=seam」。否（合入 `llm-core` 的两个 BC）。
