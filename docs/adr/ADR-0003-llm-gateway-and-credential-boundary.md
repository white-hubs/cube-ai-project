# ADR-0003: LLM 能力一核两面（进程内 Port + OpenAI 兼容网关），凭据与 catalog 权威收束于 llm-core

- **Status**: Accepted
- **Date**: 2026-06-05
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: llm, gateway, provider, credentials, multimodal, ports-and-adapters

## Context

C1 把三处 LLM 实现收敛成单一 `LlmProviderPort`，但「进程内 TS 接口」管不住两类消费者：

- **Langflow（flow 内部）**：cube-ai flow 把 `api_key`/`base_url` 经 `graph-translator` 注入 LF 节点模板（凭据存于 `model_provider:` KV），**LF 自身拿 key 直连 vendor**，代码层够不着。
- **前端**：可能直连某个 vendor 做流式对话，越过平台的目录/凭据/用量/能力匹配。

只有进程内 port 时，「单一 provider」在 flow 与前端这两条路上不成立 —— 凭据散落、用量事件（ADR-0008）丢失、能力匹配缺位、vendor key 有泄漏风险。

## Decision

`@cube-ai/llm-core` 提供**一核两面**，两面复用同一 Provider + Catalog + 能力匹配 + 租户/用量（catalog 权威在 `llm-core` 内，见 ADR-0002）：

1. **进程内面 —— `LlmProviderPort`**：`agent-engine`、in-repo `flow-core` 等同进程消费者经 DI 消费。

   > **M1 落地（2026-06-06）**：`LlmProviderPort` 已在 `@cube-ai/contracts` 定义（`packages/contracts/src/platform/llm-provider.ts`）；`@cube-ai/llm-core` 实现 catalog-driven provider；`embed` 返回 `{dense, sparse?}`（G3）。engine 衔接仍保留 tachu `ProviderAdapter` 作实现细节，M2 加 adapter 层。
2. **网络面 —— LLM 网关**：对外暴露 **OpenAI 兼容**端点（`/v1/chat/completions`、`/v1/embeddings` 等），作为全平台 LLM 流量的统一收口；供异构运行时（Langflow）与远程消费者（前端）使用。

**为何 OpenAI 兼容**：Langflow / 前端 / 外部工具本就普遍说 `base_url + api_key`，指向网关近乎零改造；这是让「单一 provider」跨「进程内 / 异构运行时 / 远程」三类消费者成立的务实通用面。

**catalog 管理面（收编自 ghcloud，与上面「调用一核两面」正交）**：model registry / 租户 provider 配置的 CRUD + 远程同步 + 连通测试，由 `llm-core` 的 **catalog BC** 提供，挂在 `/llm/*` 管理路由（ADR-0008），前端经 `llm-sdk-console` 消费。这是 `llm-core` 对外的**管理面（console）**——不是 chat 消费面，chat 走 `agent-engine`。

**凭据边界（目标不变量 + 当前例外）**：

- **目标不变量**：vendor 密钥与 model registry 的唯一权威 = `llm-core` 的 **catalog BC**（自 ghcloud `llm-catalog` 收编：provider/model CRUD + 远程同步 + 连通测试 + 租户级 provider 配置）。其它消费者只持**平台级 key**，不持 vendor key。
- **ghcloud 退为租户身份**：`platform-adapter-ghcloud` 只校验 token / 解析 `tenantId`，**不再持有 catalog 数据或 vendor 凭据**（见 ADR-0002 边变化、ADR-0009）；`tenantId` 作为上下文流入 catalog 做租户级解析。
- **flow 两源收归（cube-ai 服务拆分后新增事实）**：flow 的 `settings/model-providers`（apiKey 存 `app_kv`）与 **Cube 线性引擎节点 config 焊 `api_key`** 两条凭据路径，收编时一并并入 `llm-core` catalog（ADR-0004/0012）——它们是**收口目标，非长期例外**（区别于 Langflow）。**落地见下「flow 凭据两源收归」**。
- **当前例外**：Langflow 仍自带 vendor key（见下方例外清单），本轮不收口。
- **强制**：除已登记例外外，**禁止新增任何直连 vendor 路径**。
- **收口判据**：凭据/用量「已集中」的口径**明确排除 Langflow**，直至 LF 节点 `base_url` 指向 **LLM 网关**、`api_key` 换为租户级网关 key 为止。

### flow 凭据两源收归 —— 落地（model-providers + 节点 key）

cube-ai 服务拆分后 flow 实有两条独立凭据路径需收口（assistant 玩具不迁、kb 经 ADR-0005 已决、Langflow 留例外）：

| 源 | 现状 | 落地 |
|---|---|---|
| `settings/model-providers` | apiKey 存 `app_kv`（flow 第二 catalog） | **并入 llm-core catalog**：一次性迁 `model_provider` 记录 `(provider, apiKey, base_url, models)` 进 catalog；**flow 自有存储退役**；per-project 配置映射 catalog **租户级 provider 配置**。前端**设置页退役**，模型接入统一去 catalog console（`llm-sdk-console` / `/llm/*`，ADR-0008）——**单一权威、无重复 UI**。 |
| `cube-linear-engine` 节点 config 焊 `api_key` | DSL 节点内嵌 vendor key | 节点 schema 去 `api_key`/`base_url`、改携 **modelRef（catalog model id）**；inline `openai-compat-chat` 换注入 **`LlmProviderPort`**（进程内面，**非回环网关**）；凭据由 provider 经 catalog 解析。 |

**节点 key 软过渡（去风险）**：engine 优先 `modelRef + LlmProviderPort`；持久化里**残留 `api_key` 的 legacy 节点**经 port 的临时 **key-override fallback** 承接（登记入下方例外清单），**数据迁移完成即 sunset**——区别于 Langflow（长期例外）。

> 与 ADR-0005（kb embedding 经 `EmbeddingPort`→`LlmProviderPort.embed`）合起来：除 Langflow 长期例外外，**全平台 vendor key 收敛于 `llm-core` catalog 单一权威**。flow engine 本体此处改动（inline client→注入 port）是 ADR-0012 D3「逐处换源」预期的一处，靠 flow 既有 engine 测试去风险。

**单模态 / 多模态协议对齐**：网关须以一致协议覆盖纯文本（单模态）与图文输入 / 文生图（多模态，含 `openai_image` / `dashscope_text2image` / `geekai` 族），不为每种模态发散一套 API。

**直连 vendor 例外清单（不硬禁，但须显式登记）**：

- 本轮**不强制**消灭所有直连 vendor 路径。已知例外须登记入清单，每项带原因与收口意图；**禁止静默新增**。
- **Langflow 本轮保持现状、不在核心范围**：列为已知例外，`model_provider:` KV 与 LF 节点注入暂不改；待后续把 LF 节点 `base_url` 指向网关、`api_key` 换成租户级网关 key 时再收口。
- **flow 迁移过渡期 legacy 节点 `api_key` fallback**：**临时例外**——仅为持久化旧 flow 平滑过渡（节点 key→modelRef 数据迁移完成即 **sunset 移除**），与 Langflow（长期例外）性质不同。
- 前端如确有特定场景需直连，须经例外清单登记并评审，而非默认放开。

## Consequences

- **Positive**：vendor 凭据、model registry 与能力匹配收敛到一处 locality（`llm-core`，ghcloud 不再是第二权威）；用量事件、租户隔离在前端/异构路径上也成立；前端不再持 vendor key（安全）；LF 未来可零改代码经 `base_url` 收口。
- **Negative**：网关是新增的一等组件，需承载鉴权/租户/限流/流式；OpenAI 兼容面要持续兼容多模态语义，协议对齐有维护成本；前端经网关多一跳、依赖平台在线。
- **Neutral**：Langflow 仍直连 vendor，短期内 flow 的 LLM 用量不进中台用量口径，直至其从例外清单收口。

## Options Considered

- **只做进程内 `LlmProviderPort`，不做网关**：成本最低，但 LF / 前端的 LLM 调用永远在 port 之外，凭据与用量无法收口。否。
- **网关作唯一前门、硬禁一切直连 vendor**：边界最干净，但要求本轮即改造 Langflow（非核心、风险高）并堵死所有前端直连场景。改为「统一收口为目标 + 例外清单」，LF 暂留。否（取折中）。
- **为多模态另起独立协议**：实现简单，但消费者要对接多套 API，违反「单一 provider / 协议对齐」。否。
