# ADR-0027: AI-native descriptor 创作 —— `propose` 纯建议能力 + 管理 ops 工具集（一核两面：进程内 Tool Handler + MCP server 门面）

- **Status**: Accepted
- **Date**: 2026-06-14
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: agent, console, descriptor, ai-native, sdk, tool

## Context

ADR-0016 / ADR-0018 落地了 agent 管理面（`/agent/console/*`）对 agent / skill / rule 的人工 CRUD（结构化 + `:fromDocument`）、draft/publish 版本模型与双层权威。但管理者目前只能**纯人工**维护 descriptor：写 prompt、手挑 `skillRefs`/`ruleRefs`/`availableTools`、调 `modelConfig`。

作为「AI 基础能力提供方」，中台不应以传统业务平台思维交付管理面——应让管理者在创作 descriptor 时**深度感受到 AI 便利**：用 LLM 优化配置、甚至从意图自动生成配置。

约束基线：跨域只走 contracts port（ADR-0002）、能力包无自有鉴权、tenant 单一隔离主键（ADR-0012 addendum）、LLM 凭据单源 `llm-core`（ADR-0003）、Tool 编排归 engine（ADR-0006）、draft/publish 两态（ADR-0016 §4）、SDK 按面命名（ADR-0011）。已有先例：engine 运行时已会「自己用 LLM 帮自己做决策」（tool-activation / `intent-flow-scoring`，ADR-0020），但该路由是**关键词子串匹配**，非语义/embedding。

收敛起点是 6 个候选方向（NL 生成、引用智能装配、发布前评测、配置优化、会话提炼、自动元数据），经 grill 坍缩。

## Decision

### 1. AI 创作辅助 = 中台能力，非某 console 私货

AI 辅助创作经 `/agent` 管理面 API + `agent-sdk-console` 暴露，`ai-sdk-playground`（验证沙箱）与上游自建 console（ghcloud / tachu 等）**共享同一 SDK 能力**。不把它做成某前端 app 私有的页面逻辑——那样上游各自重做、能力不可复用，且违背「中台暴露可被上层直接调用的基础能力」。

### 2. 两个方向（双 UX），其余收编

锁定**两个**互补、不冲突的方向，覆盖两类创作 UX：

- **① `propose`（表单式 / 可控）**：同步、结构化、**纯建议不落库**的原语。下游拿候选自己做 diff/确认，再调既有 create/update。
- **② 管理 ops 工具集（对话式 / 省心）**：把管理面 CRUD（含 `propose`）包装为工具，让 **agent** 经对话真正执行——「AI 帮你写进库」。原语是工具集，可被进程内预置「管理 Agent」消费、也可经 MCP server 门面被外部 agent 消费（§7/§8）。

被收编项：**配置优化** = `propose` 以现有 content 为输入（generate vs optimize 只是 input 空否）；**自动元数据**（description/displayName/tags）= `propose` 副产物；**引用智能装配** = `propose` 内部步骤（见 §6）。**发布前评测**与 **diff/preview** 外推给下游应用；**会话提炼**暂不做。

### 3. `propose` 纯建议、不落库

`propose` 只产出候选 descriptor，**永不写库**。下游 console 自己做 diff/确认 UI，确认后调既有 `POST /agent/{kind}` / `PATCH /agent/{kind}/:id`。

理由：能力本身**无写副作用**（可反复调、幂等无后果）、draft/publish 模型完全不动、无需额外写授权。

### 4. `propose` 输出 = 结构化信封

```ts
{
  content: <按 kind schema、refs 已 inline、可直接喂 create>,
  suggestions: Array<{ kind: 'skill'|'rule'|'tool'|'agent'; ref: string; rationale: string; confidence?: number }>,
  valid: boolean,
  issues?: string[],
}
```

`content` 直接是 `TenantAgentContent` / `TenantSkillContent` / `TenantRuleContent` 形态（refs 已填入 `skillRefs`/`ruleRefs`/`availableTools`），可直接交给 create/update；`suggestions` 是供 diff/确认 UI 渲染「可选 ref 卡片 + 理由」的旁路。新增 contracts wire schema。

### 5. 端点 `POST /agent/{kind}:propose`，SSE 流式

与 `:fromDocument` 的 colon-suffix 对称。SSE 协议：**流 prose token**（prompt/instructions 的 delta）供人实时看，**末尾一个 `proposal` 事件**搭载完整结构化信封（§4）；流中途异常以 `error` 事件透出避免悬挂。

实现为**两阶段真流式**（已落地）：
- **Phase 1**：`LlmProviderPort.chatStream` 仅生成 prose 正文（plain text，无 JSON），逐 token `event: delta` 真流出——用户首字延迟 = 首 token 延迟，而非整体生成完。
- **Phase 2**：`chat` 给定已草拟 prose + 候选清单，产出结构化 `{ suggestions, meta }`，再硬接地（§6）+ schema 校验，组装为终态 `proposal` 信封。
- 非流式消费者（Tool Handler / MCP 门面，§7-8）走 `propose()`，内部 drain 同一 `proposeStream` 两阶段核取终态信封——**单核两形态**，行为一致。

输入模式统一为一个端点：`{ intent?: string; base?: <现有 content，= 优化模式>; focus?: string }`。

### 6. ref 接地 = LLM-in-context（杜绝幻觉）

`propose` 推荐 refs 时，把**候选清单**（系统级 + 本租户已发布、按 kind 过滤的 name + description）喂给生成 LLM，LLM **只能从清单内选**；产出后再对 registry **硬校验存在性**、丢弃任何幻觉项。这是本能力区别于「前端接个通用 ChatGPT」的核心价值——吃到了上游/通用 LLM 拿不到的平台内部 registry 知识。

运行时 tool-activation 的关键词路由（ADR-0020）**不动**——它是运行时召回，与创作时推荐是两个场景（管理 Agent 在运行时仍复用它）。embedding 召回预筛留待 registry 规模触发。

### 7. 管理能力的原语 = 管理 ops 工具集（Tool Handler）

可复用原语不是「整个管理 Agent」，而是把 `DescriptorManagementService` 的 ops（`propose` + list/get/create/update/publish/softDelete）包装成的一组 **Tool Handler**（ADR-0006 薄适配模式）。任何进程内 agent 经 `availableTools` 授予即获得管理能力。

**「管理 Agent」退化为一个系统级预置**（`descriptors/agents/`：system prompt + 这批工具），是该原语的一个进程内消费者——复用 engine 现有 session/turn/Tool 编排，租户上下文自动隔离，经 `/agent/*` 消费面被下游消费，体现中台自举（dogfood）。`propose` 同时是独立 HTTP 端点（§5）与该工具集成员——一原语两处复用。

粒度取「ops-as-tools」而非「整个 agent 包成 sub-agent」：前者最可组合（别的 agent 可只取其中几个 op），后者粒度过粗、diff/编排都难。

### 8. 管理能力「一核两面」：进程内 Tool Handler + MCP server 门面

与 LLM「一核两面」（`LlmProviderPort` 进程内 + OpenAI 兼容网关对外，ADR-0003）**同构**：同一批 ops 为**核**，两面暴露——

- **进程内面**：Tool Handler，给管理 Agent / 任何进程内 agent（§7）。
- **对外面**：把管理 ops 工具集暴露为 **MCP server**（JSON-RPC over **Streamable HTTP**，已落地），供 engine 之外、任何 MCP-capable 的 agent host（外部 IDE agent、其它系统）直接管理本中台 descriptor。

这是 engine **首次作为 MCP 服务端（出站角色）**，与 **MCP 桥接**（入站：engine 连外部 MCP server 当客户端）方向相反，是新边界；并部分回答 ADR-0006 的未决问题（`ToolInvokerPort` 对外暴露工具执行）。MCP transport 携带平台 token、经 `platform-adapter-ghcloud` 解析租户，与 HTTP 路径一致鉴权（能力包无自有鉴权不变）。

**传输落地（Streamable HTTP，2025-03-26+）**：单端点 `POST /agent/mcp/descriptor`——`Accept` 协商（默认 `application/json` 单响应；仅 `text/event-stream` 则 SSE 单消息流）；`initialize` 回 `Mcp-Session-Id`（无传入则新铸、有则回显）并协商 `protocolVersion`；仅通知请求回 `202`；`GET /agent/mcp/descriptor` 回 `405`（无服务端主动推流）、`DELETE /agent/mcp/descriptor` 回 `204`（无服务端 session 存储，本门面无状态、tenant 来自 token 而非 session）。standard MCP host 可直接接入。

不取「仅 MCP、砍掉进程内管理 Agent」：进程内 agent 用管理能力会走 MCP 回环，荒谬。两面缺一不可。

### 9. consent 策略

- **进程内面**（engine 作编排者，§7）：读（list / get / `propose`）无 consent；create / update 仅产 draft（不影响运行时）→ 轻确认；publish / 软删动运行时 → **强制 consent**（走 Tool 编排）。
- **MCP 对外面**（engine 是被调方、非编排者，§8）：**服务端硬保证**——create / update 只产 draft（天然安全）；publish / 软删需显式 `confirmed` 标志或二次确认调用；**人面 consent 交给 MCP client host**。两面写语义对齐：默认只产 draft、动运行时才需显式确认。

### 10. 辅助 LLM 模型/凭据

`propose` 与管理 Agent 的生成均走 `LlmProviderPort`（凭据单源 `llm-core`，ADR-0003）。调用方可选传 `modelCode`，缺省回退到一个可配置的「创作模型」。

### 11. SDK

`agent-sdk-console` 新增 `propose`（SSE）方法；管理 Agent 经 `agent-sdk-client*` 消费（它就是个 agent，走消费面）。

## Consequences

- **Positive**：两种 UX（可控表单 / 省心对话）覆盖不同创作偏好；`propose` 纯建议不碰持久化、零写副作用、可安全反复调；ref 硬接地杜绝幻觉 = 中台特有价值；管理能力「一核两面」与 LLM 同构、心智一致；**外部 agent 生态（IDE agent 等）零 bespoke 集成即可经 MCP 管理中台 descriptor**；`propose` 一原语两用、减重复；diff/confirm 与 tool consent 共用同一安全语义。
- **Negative**：新增 SSE `:propose` 端点 + contracts 信封 schema + SDK 方法；管理 ops 工具集 + 内置「管理 Agent」预置 + 两面 consent 策略；engine 新增 **MCP 服务端运行时面**（transport / 鉴权 / 多租户并发 / server-side draft-safe + 显式确认协议），两面需保持 ops 行为一致；每次 `propose`/对话都是 LLM 调用，有成本。
- **Neutral**：发布前评测 / diff UI 外推给下游或暂不做；配置优化不单列（= `propose` 带 `base`）；运行时关键词路由（ADR-0020）不动；MCP 桥接（入站）语义不变，本 ADR 只新增出站服务端面。

## Options Considered

- **纯前端编排（验证沙箱私货）**：实现最快，但上游各自重做、能力不可复用，违背中台「暴露可调用基础能力」。否（取中台能力 + SDK）。
- **`propose` 直接落库（AI 帮写进库走 `propose`）**：少一次确认，但破坏 draft/publish 心智、引入写副作用与写授权；「AI 帮写」已由管理 Agent 经 consent 覆盖。否（`propose` 恒纯建议，写由管理 Agent 把关）。
- **只做对话 Agent，不单列 `propose`**：UX 单一，但丢了「可控表单 + 结构化信封」，diff UI 难基于自由文本。否（保留 `propose` 原语，两处复用）。
- **整个管理 Agent 包成 sub-agent（经 `subAgentRefs`）作复用原语**：粒度过粗（别的 agent 无法只取其中几个 op）、diff/编排都难。否（取 ops-as-tools 为原语，§7）。
- **仅 MCP server、砍掉进程内管理 Agent**：进程内 agent 用管理能力要走 MCP 回环，荒谬。否（一核两面，§8）。
- **不开 MCP、仅进程内 ops-as-tools**：实现最小，但丢了外部 agent 生态零集成管理的便利。否（开 MCP server 门面）。
- **MCP 全量暴露、不加服务端门槛（纯靠 client host consent）**：最简单，但 publish/软删有运行时副作用，client host 的 consent 不可控时风险高。否（服务端 draft-safe + 显式确认，§9）。
- **ref 接地复用关键词路由（ADR-0020）**：零新逻辑，但召回弱、需每 skill 精配 keywords；`propose` 已是 LLM 调用，in-context 接地质量更高。否（in-context + 硬校验）。
- **ref 接地用 embedding 召回 + rerank**：大 registry 可扩展，但要维护索引。暂否（规模触发再上，作 in-context 候选预筛）。
- **`propose` 一次性 JSON（非 SSE）**：实现简单，但丢流式体验（生成慢时无反馈）。否（SSE delta + 末尾信封）。
- **管理 Agent 另起专用对话端点（不复用 engine agent 运行时）**：耦合更松，但重复 session/turn/consent 全套。否（系统级内置 agent + 工具）。
- **所有写操作（含 draft）都强 consent**：最保守，但 draft 不影响运行时、过度打扰。否（draft 轻确认、publish/删强 consent）。

## Open Questions

- 管理 Agent 的内置 descriptor 是否随 cutover 进 `descriptors/agents/`，还是 dev 期临时占位（与 ADR-0016 open question「系统级 agent 下发终态」一并定）。
- `suggestions.confidence` 如何度量（LLM 自评 vs 省略）——v1 可仅 `rationale` 不强制 `confidence`。
- 大 registry 下 in-context 候选清单超 context window 的截断/分桶策略（触发再议，候选先 embedding 预筛）。
- `propose` 是否需要配额（每租户调用频次/成本上限），与 ADR-0016 open question 的 descriptor 配额一并考虑。
- 发布前评测（本轮被打下的方向 D）何时回归——下游 diff UI 之外是否仍需中台侧「样例对话试跑」能力。
- engine-as-MCP-server 是否应抽出独立的 `ToolInvokerPort` / 对外工具注册表（ADR-0006 未决），还是 descriptor 管理专用 MCP 门面先行、后续再泛化到其它能力。
- MCP client host 的 consent 不可控时，publish/软删二次确认协议的具体形态（`confirmed` token 的发放 / 过期 / 防重放）——当前为请求级 `confirmed:true` flag，尚无防重放。

### 已落地决议（原 Open Question 收口）

- **`propose` 流式形态** → 两阶段真流式（§5）：phase-1 `chatStream` 真流 prose、phase-2 结构化 refs/meta；不再是「一次性生成→派生 delta」。
- **MCP transport 选型** → **Streamable HTTP**（§8）：`Accept` 协商 + `initialize` 握手 + `Mcp-Session-Id`；本门面无状态、tenant 来自 token，故不持久化 session，多租户并发天然隔离。
- **管理 ops「核」装配单源** → `DescriptorManagementService` 的 DI 工厂（`bc/descriptor/descriptor-management.provider.ts`）为唯一源，HTTP 面 / MCP 门面 / 进程内 Tool Handler 三处共用，消除重复 factory/候选源；provider 住 descriptor BC 避免 descriptor→tools 反向依赖。
