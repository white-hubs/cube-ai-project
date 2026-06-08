# ADR-0012: 运行时单一真源（agent-engine）+ 三域平级下游 + host 身份权威；assistant 弃迁、flow/kb 整套收编

- **Status**: Accepted
- **Date**: 2026-06-05
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛；运行时真源与身份模型由用户裁决）
- **Tags**: runtime, agent-engine, assistant, flow, kb, identity, migration-scope, three-domain

## Context

cube-ai（`redesign/cube-ai`）经一次「全面架构改造——服务拆分」(`400b45e`，HEAD `1c9d172`) 后，结构与早前 ADR 写入时的假设明显错位。完整勘察见 **[`../architecture/cube-ai-current-state.md`](../architecture/cube-ai-current-state.md)**。两个关键事实改变了既有判断：

1. **出现了第二个运行时**：cube-ai 新增 `assistant` 服务——自带 OpenAI 客户端（`ASSISTANT_API_KEY`）、8 轮 tool loop、flow 操作类工具（`chat_with_configured_flow`/`generate_image`/…）、session 存在 flow 的 repo。它与 `cube-agentic-engine` 的 `agent-engine` **机制重叠**（chat + LLM + tool + SSE + session），但定位是「flow 平台副驾」、成熟度低（玩具级），且带反模式（自带 LLM、session 进 flow repo、module 直连 flow）。早前 v6 包计划只给了 agent-engine 一个运行时位置，没有 assistant 的位置。

2. **身份是注入式 seam**：cube-ai 身份/租户经 `@cube-ai/server-shared` 的 async 上下文承载（`currentProjectId`/`isGlobalAccessEnabled`/…），由中间件经 `ProjectLookup`/`AccessTokenReader` **工厂注入**；各域本体只读上下文，不持有身份来源。现状身份**源**在 flow + server-base（非 ghcloud）。早前把身份框成「域内层级」（谁为准）是错的，未厘清三域真实关系。

## Decision

### D1 — 运行时单一真源

- **`agent-engine`（cube-agentic-engine）是唯一运行时真源。**
- cube-ai `assistant` 判定为**玩具**：**不迁移、留原仓**。
- 从 `redesign/cube-ai` 只**整套收编 `flow` 与 `kb`** 两块能力（见 D3）。
- assistant 的产品价值（自然语言操作 flow / 出图 / 优化 prompt）若将来需要，以 **agent-engine 的 preset** 重建（系统提示 + 经 port 调 `flow-core`/`llm-core` 的 tool handlers），**不搬运 assistant 代码**。

### D2 — 身份权威在 host，三域平级下游

- **身份/租户权威在 ai-server host**（组合根 `apps/ai-center`，经 `platform-adapter-ghcloud` 向鉴权中心校验 token、解析租户），注入请求上下文。**含程序化 developer key（PAT）**：host 是 key→principal/租户 的唯一认证权威，下游域不自建第二身份源。
- **`agent-engine` / `flow-core` / `kb-core` 是三个平级下游域**，各自从上下文消费身份，**不互为身份权威**。
- `agent-engine → flow-core/kb-core` 是**能力调用边**（编排），**非身份层级**。
- **`flow-core` 自带独立 SSE，可直达**：前端可不经 engine 直接访问 flow（与 kb 一样是可直达域）。
- 三域**互不冲突**：engine 编排、flow 流程、kb 检索是三条不同领域 seam。

### D3 — flow/kb 整套收编 + 横切收归

- 迁 **flow 本体整套**（`engine`(Cube 线性引擎) / `langflow` / `custom-component`(DSL) / `components` / `flows`(CRUD·exec·playground·sync) / `mcp`(对外 MCP server + LF MCP 同步，ADR-0006 #6) / `webhook` / `guardrails` / `observability` + **projects-as-container**＝flow 领域聚合），**功能零丢失**。
- flow 自带的**横切收归**：
  - 身份 / 认证 / 租户 → **host 注入源**（D2）；
  - flow `api-keys`（developer 程序化执行 key）→ **认证(key→principal/租户)归 host 身份层（host 备 PAT）**；flow 只留 **key→可跑哪些 flows 的 grant 授权**（领域数据，同 projects-as-container）。x-api-key 校验经 host 注入 reader（同 Bearer，本体不改）；
  - 模型商**凭据**（`settings/model-providers` 存 app_kv + flow 节点 config 焊 key）→ **llm-core catalog**（ADR-0003）。
- 因身份是**注入式 seam**（本体只读 `currentProjectId()` 等），换源**不动本体**。
- **剥离** flow repo 中为玩具 assistant 服务的残留（`listAssistantSessions`/`createAssistantSession` 等）。
- **kb 同样整套收编**（含 embedding/vector 分层，ADR-0005）。

#### D3 去风险迁移法（针对「迁移后功能异常」的担心）

1. **先整体 copy flow 跑绿**：含现有横切原样搬入，让 flow 自带的大量 `*.test.ts` 全绿——证搬运无损。
2. **逐处换源 + 回归**：身份源 flow→ai-server host；凭据源 model-providers→llm-core catalog。每换一处跑一遍 flow 测试。
3. **projects-as-container 留 flow**：flow 的 projects 聚合是领域数据、不是身份——留 flow；只有「我是谁/属哪个租户」经 host 注入。

## Consequences

- **Positive**：单一运行时，无双 runtime 长期重复（session/tool/LLM/SSE 不双份）；三域平级关系清晰（engine 编排，flow/kb 可直达）；assistant 的三处反模式（自带 LLM / session 进 flow repo / module 直连 flow）**不进新仓**；身份/凭据收口；flow 迁移风险被测试夹住、本体零改。
- **Negative**：assistant 现成产品功能若要保留，需以 agent-engine preset 重建；flow 体量大，横切换源需逐处验证。
  - **澄清（经源码重核）**：agent-engine **并非骨架**——源仓 `cube-agentic-engine/packages/engine` 实测为**最成熟、port 最就位**的运行时（~20.7K 行实现 + ~13.9K 行测试、279 文件；session/turn/SSE/tool 编排含 13 个真实 handler〔flow/knowledge/vector/llm/mcp/sql/http/openapi…〕、jobs/safety/authz、真实 adapter〔anthropic/openai-compat/catalog-routing provider、Qdrant memory index、bullmq backend、rate-limit/idempotency 中间件〕）。仓名/分支里的「skeleton」是 **Best-of-N 架构候选代号**（`m2-skeleton-c`），**非代码空壳**；`ARCH.md`（5 月基线）列的 gap（rate-limit / idempotency / Qdrant 接入）在当前代码已补齐。**它是收编锚点，不是从零搭建风险**。
- **Neutral**：assistant 留原仓不删，可作历史/产品参考；flow 双后端（Cube 引擎/Langflow）开关语义不变（ADR-0004）。

## Options Considered

- **双运行时共存**（engine + assistant 各留）：当下最省，但长期重复 session/tool/LLM/SSE、凭据更散，认知上两个「助手」。否。
- **assistant 为准、agent-engine 暂不并入/砍**：反转 v6「engine 是核心」，放弃 engine 的 memory/authz/usage/jobs/mcp 产品级能力。否。
- **flow 连横切原样搬**（含第二套 auth/租户/凭据）：把重复固化进新仓，与 D1 精神冲突。否（除非显式作临时态并记 ADR）。
- **身份设为 agent-engine 域内权威**（engine 凌驾 flow/kb）：与「三域平级 + flow 独立 SSE 可直达」冲突。否。

## References

- [`../architecture/cube-ai-current-state.md`](../architecture/cube-ai-current-state.md) — cube-ai 现状勘察（迁移基线）
- ADR-0002（包边界）/ ADR-0003（llm·凭据）/ ADR-0004（flow 收编）/ ADR-0005（kb·向量）/ ADR-0009（运行时拓扑·身份旁路）
