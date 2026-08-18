# MCP 业务问数安全边界与语义层改造落地设计

日期：2026-08-13  
状态：实施中；首个安全切片 + progress SSE/Engine/assistant SDK/应用对话 UI 链路切片 + 本地 elapsed-time progress fallback 已落地；2026-08-17 已补齐 cube tool-result projection、final-answer guard、descriptor 旧工具引用 fail-closed、biz 配置/关键词/语义索引/eval 关键闭环、biz 旧独立 QuestionBank 页面删除、ghcloud 应用对话前端 tool payload 可见性策略注册表；真实跨仓库端到端对话仍需在 Redis/MySQL/Qdrant/MCP/Agent 全部可达后复验。  
适用范围：必须完整落地，不再拆分 P0 / P1 / P2  
涉及仓库：

- `/Users/ghy/work/cube-ai-project`：agent engine、MCP host、工具可见性、对话最终输出边界、验收门阀
- `/Users/ghy/work/biz-ontology-platform`：业务问数 MCP server、语义层、SQL 生成/执行、安全投影、问数评估
- `/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app`：真实业务对话应用前端、thinking 渲染、工具卡、单行状态展示

> 本文档是后续继续开发的主上下文入口。后续任何实现、续接、审阅、提交前，都应先阅读本文档，确认“为什么改、改什么、不改什么、怎么验收”。

执行计划文档：

- `/Users/ghy/work/cube-ai-project/docs/technical-design/2026-08-13-business-query-implementation-plan.md`

实施状态索引：

- 2026-08-13 首个安全切片详见执行计划文档 `1.4 2026-08-13 实施记录（首个安全切片）`。
- 2026-08-17 配置闭环缺口详见执行计划文档 `5.5 2026-08-17 补充：配置闭环与缺口清单` 与 `10. 步骤 6：biz 配置闭环、关键词闭环、现有语义资产复用与调试入口补齐`。本轮明确后置完整权限/审计治理；当前必须完成的是基础 tenant/deleted 数据边界、安全展示、防泄漏、候选域配置闭环、关键词生效、索引可解释与评测绑定。
- 2026-08-17 补充冻结项：新增/改造 API contract、旧独立 `QuestionBankPage` 删除与能力迁移、`ghcloud-new` 应用对话前端门阀、`business_query.display_policy` 配置路径、问数准确性分项门阀、`_verified_queries.yaml`、`_metrics.yaml`、维度建模、descriptor 旧工具引用 fail-closed、六类脱敏与 guard 检测清单。详见执行计划文档 `5.5.14`、`5.5.15`、`5.5.16`、`11.6`、`15.4`、`15.5`。
- 已落地：`ask_business_data` platform service、MCP 暴露面收敛、旧 `resolve_business_query` 物理清理、API key 脱敏、业务问数 eval 生成、business-query platform `sql_executor` 执行边界、展示策略 `display_policy`、business-query eval gate、Qdrant 语义索引 adapter、biz 前端语义索引状态/重建入口、cube SSE 工具输出窄域脱敏、cube `tool.call.progress` SSE 合同与 mapper 切片、`ToolService → McpHandler → McpBridgeService → MCP transport` progressToken/callback 底座切片、Streamable HTTP `text/event-stream` 响应体流式解析、`EngineFactory` 工具执行期间 progress queue、MCP 无 progress notification 时的本地 elapsed-time fallback、`packages/agent/sdk-client-assistant` 对 `tool-call-progress-v1` 的 reasoning/tool timeline 状态消费、`ghcloud-new/.../ai-application/app` 应用对话 UI 对安全 `progressText` 的 thinking 渲染、cube tool-result projection 与 final-answer guard、ghcloud tool payload 可见性策略注册表。
- 待真实环境复验：跨仓库真实端到端对话验证；完整前端全量 typecheck 历史基线治理仍需单独专项，不得阻塞本轮已通过的 build/相关测试结论。

---

## 0. 结论先行

当前问题不应定义为“某个智能体 prompt 没写好”，也不应定义为“前端展示问题”。更准确的定义是：

> 低层 SQL 查询 MCP 工具被普通 agent 直接使用，且工具参数、工具结果、模型上下文、最终用户输出之间缺少强制可见性边界，导致 SQL、MCP URI、内部字段、未翻译枚举和 raw rows 有机会被模型原样复述给最终用户。

落地改造必须同时做两件事：

1. 在 `biz-ontology-platform` 删除低层 SQL 查询 MCP 工具，新增受治理的业务问数工具。
2. 在 `cube-ai-project` 把 MCP 工具接入从“原样给模型”升级成 host 侧强制可见性投影、敏感工具管控和最终回答 guard。

不能只靠提示词。提示词可以作为补充约束，但不能作为安全边界。

另一个重要边界：

> 问数核心能力不应放在 MCP 协议/适配层里。MCP 应保持为薄接入层；真正的业务问数核心应放在 `biz-ontology-platform` 的平台服务/领域服务层，由 MCP adapter、REST API、管理端、eval 任务共同复用。

---

## 1. 术语定义

### 1.1 MCP server

提供工具的一侧。本文主要指 `/Users/ghy/work/biz-ontology-platform` 中的业务本体/问数 MCP 服务。

### 1.2 MCP host / agent engine

连接 MCP server、把工具暴露给模型、接收工具结果并驱动对话的一侧。本文主要指 `/Users/ghy/work/cube-ai-project` 中的 agent engine。

### 1.3 普通 agent

面向业务用户的内置智能体或自定义智能体。它不应直接看到 SQL、数据库连接、内部 ID、MCP URI、审计字段。

### 1.4 高层业务问数工具

面向普通 agent 的主入口。本次确认新增：

```text
ask_business_data(question, context?, filters?)
```

移除旧入口：

```text
resolve_business_query(question, context?, mode?)
```

本次重构中物理清理，不再保留旧语义入口。

`ask_business_data` 接受业务问题，返回业务语义结果；不要求模型直接传入 SQL。

### 1.5 低层 SQL 查询工具

当前已有能力：

```text
query_database(connection, sql, purpose, session_id?, round_num?)
```

该工具具备执行 SQL 的能力。本次重构中，`query_database` 作为 MCP 工具物理删除，不再对任何 agent 暴露。其已有 SQL 安全校验、执行、审计能力应抽取到平台服务内部的非 MCP SQL executor。

### 1.6 语义层

把底层表、字段、枚举、指标、维度、实体、同义词、权限、口径、查询模板转换成业务可理解概念的一层治理模型。语义层不是“预定义问题 SQL 列表”，而是动态问数的约束空间和解释依据。

### 1.7 verified query / 已验证问题

由自然语言问题和经过人工/系统验证的查询逻辑组成。它不是问数能力的全部边界，而是用于：

- 高频问题加速；
- 相似问题纠偏；
- 关键口径固化；
- 回归评估；
- 线上失败问题沉淀。

### 1.8 模型可见内容

会进入 LLM 上下文、可能被模型引用和复述的内容。

### 1.9 用户可见内容

会进入最终聊天气泡、前端 UI、导出内容或对业务用户展示的内容。

### 1.10 审计/调试内容

只允许进入服务端日志、trace、管理端调试详情或受控 artifact 的内容，例如 SQL 原文、raw columns、traceId、toolCallId、SQL 指纹、执行耗时。

### 1.11 平台服务 / 领域服务

`biz-ontology-platform` 中承载业务本体、语义层、问数计划、SQL 生成/校验/执行、结果语义投影、eval 和管理能力的服务层。它应是问数核心能力的归属位置。

### 1.12 MCP adapter / MCP 工具服务

`biz-ontology-platform` 中面向 MCP 协议暴露工具的一层适配。它负责把 MCP `tools/list`、`tools/call`、`inputSchema`、`outputSchema`、`structuredContent`、`content`、`_meta` 等协议字段映射到平台服务能力。它不应承载不可复用的核心问数逻辑。

---

## 2. 前因后果

### 2.1 触发问题

对话聊天中，模型调用 `biz-ontology-platform` 的问数 MCP 工具后，最终回答出现了类似以下内容：

```text
固有风险等级：[null](mcp://mcp.biz-ontology.query_database:{
  "connection":"风险管控",
  "sql":"SELECT ...",
  "purpose":"...",
  "session_id":"...",
  "round_num":2
})
```

这类内容至少包含四类问题：

- SQL 泄漏；
- MCP 工具 URI 泄漏；
- 数据库连接 / session / round 等内部字段泄漏；
- `null`、raw id、raw code、未翻译枚举等业务不可理解内容泄漏。

用户明确判断：这是不可接受缺陷。

### 2.2 为什么不是前端问题

事实：

- 截图中这些内容出现在聊天最终回答区域。
- `cube-ai-project` 的 SSE mapper 会把 engine terminal output / message delta 忠实映射给前端。
- 如果最终模型输出已经包含 SQL / MCP URI，前端只是展示了后端给出的内容。

结论：

> 前端可以做展示兜底，但不能作为主修复点。主修复点必须在 agent engine 和 MCP 工具返回协议。

### 2.3 为什么不是单一内置智能体问题

用户已说明：其它自定义创建的智能体也有该问题。

事实：

- 自定义智能体只要接入同一类 MCP 工具，就可能拿到类似的工具结果和工具调用上下文。
- 如果每个智能体靠各自 prompt 约束，不具备平台级一致性。

结论：

> 必须做平台级 MCP 工具可见性边界，不能只修某个 descriptor。

### 2.4 为什么不能只靠提示词

事实：

- 模型如果已经在上下文里看到 SQL、MCP URI、raw JSON，就有可能复述。
- 提示词是概率约束，不是确定性边界。
- MCP 官方安全原则也要求 host/client 对工具调用、工具结果、安全和授权做实现侧控制，而不是只依赖模型自律。

结论：

> 提示词只能作为辅助；真正的边界必须由代码实现：工具可见性、结果投影、输出 guard、测试门阀。

### 2.5 为什么要从低层 SQL 工具升级为高层业务问数工具

当前 `query_database(connection, sql, purpose)` 的核心问题不是“工具不能用”，而是“层级过低”：

- 模型需要自己选择 connection；
- 模型需要自己生成 SQL；
- 模型知道 SQL 参数；
- 工具结果容易带 raw columns / raw rows；
- 最终回答容易把工具调用痕迹当成答案证据输出；
- 对业务用户来说，SQL 和内部字段不是答案。

结论：

> `query_database` 作为 MCP 工具必须物理删除；需要保留的是其背后的 SQL 安全执行能力，并将该能力下沉为平台服务内部 executor。

---

## 3. 外部事实依据与我们采用的解释

本节只列“公开资料明确支持的事实”。后续设计是基于这些事实做出的工程推论，不把推论伪装成外部产品事实。

### 3.1 MCP 官方规范

来源：

- <https://modelcontextprotocol.io/specification/2025-06-18/architecture>
- <https://modelcontextprotocol.io/specification/2025-06-18/server/tools>
- <https://mcp.mintlify.app/specification/2025-06-18/schema>
- <https://modelcontextprotocol.io/specification/2025-03-26/index>

事实：

- `tools/call` 返回 `CallToolResult`。
- `CallToolResult` 包含 `content`、可选 `structuredContent`、可选 `_meta`、可选 `isError`。
- 工具可以声明 `outputSchema`。
- 如果提供 `outputSchema`，结构化结果应与 schema 匹配，client 应进行校验。
- 工具表示任意代码执行能力，host 应实现授权、访问控制、数据保护和安全流程。
- MCP 架构中，host 负责协调、安全策略、授权、LLM 集成和上下文聚合；server 提供 focused、well-defined capabilities。
- MCP 文档明确说 server 应保持 focused/composable，host 处理复杂 orchestration。

采用解释：

- MCP 统一传输协议和字段，不自动保证“哪些字段可给模型/用户”。
- 可见性边界必须由 host 落地。
- 对外部 MCP 工具结果必须按不可信输入处理。
- MCP 适合做能力接入协议，不适合把整个业务问数核心写死在 MCP handler 内。

### 3.2 OpenAI Apps SDK

来源：

- <https://developers.openai.com/apps-sdk/reference/>
- <https://developers.openai.com/apps-sdk/build/mcp-server>

事实：

- OpenAI Apps SDK 明确区分 `structuredContent`、`content`、`_meta`。
- `structuredContent` 和 `content` 对模型可见。
- `_meta` 用于组件/小部件，模型不可见。
- 工具描述也可带 UI 可见性相关 `_meta`。

采用解释：

- 成熟 host 会做通道隔离，不把所有工具结果都等价地塞给模型。
- 我们也应区分模型可见、用户可见、审计可见。

### 3.3 LangChain MCP adapter

来源：

- <https://docs.langchain.com/oss/python/langchain/mcp>
- <https://reference.langchain.com/python/langchain-mcp-adapters/tools/MCPToolArtifact>

事实：

- MCP 工具返回 `structuredContent` 时，LangChain adapter 可把它放在 `ToolMessage.artifact`。
- 文档说明如果要让 structured content 进入 conversation history，可以通过 interceptor 显式追加。

采用解释：

- 工具结构化结果可以作为 artifact 保留，不必默认全部给模型。
- host 有责任决定进入模型上下文的投影内容。

### 3.4 Vercel AI SDK MCP Apps

来源：

- <https://vercel.com/kb/guide/ai-sdk-mcp-apps>

事实：

- Vercel AI SDK 的 MCP Apps host 文档使用 `splitMCPAppTools` 区分 model-visible tools 和 app-visible tools。
- 文档建议只把 model-visible tools 传给模型。
- 文档建议把不可信 HTML 放 sandboxed iframe。

采用解释：

- 工具可见性不是 prompt 问题，而是 host 明确控制哪些工具给模型。

### 3.5 Snowflake Cortex Analyst

来源：

- <https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/rest-api>
- <https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/verified-query-repository>
- <https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst-evaluations>
- <https://www.snowflake.com/en/blog/cortex-analyst-ai-self-service-analytics/>

事实：

- Cortex Analyst 接收自然语言问题，并基于 semantic model / semantic view 生成 SQL。
- 响应内容类型包括 `text`、`sql`、`suggestions`。
- 如果问题歧义且无法返回 SQL，会返回 suggestions。
- Verified Query Repository 用自然语言问题 + 已验证 SQL 提升相似问题准确性和可信度。
- Evaluations 使用 verified queries 作为 ground truth，统计 accuracy、regression、latency。
- Snowflake 公开文章描述其使用 semantic model YAML 中的表名、列名、类型、描述、同义词、样例值等进行 SQL 生成。

采用解释：

- verified query 不是唯一能力边界；它是增强和评估机制。
- 动态问数应受 semantic model 约束，而不是让模型自由访问底层 SQL 工具。

### 3.6 Power BI Q&A

来源：

- <https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-q-and-a>
- <https://learn.microsoft.com/en-us/power-bi/create-reports/service-q-and-a-create-featured-questions>

事实：

- Power BI Q&A 支持用户用自然语言提问。
- 用户输入未识别术语时，Power BI 会提示并建议基于 semantic model 的术语。
- Featured questions 是给用户的建议问题入口。

采用解释：

- 预设问题是引导和训练材料，不等于只能回答预设问题。
- 未理解时应澄清或建议改写，不应强行给不可靠答案。

### 3.7 Looker / LookML

来源：

- <https://docs.cloud.google.com/looker/docs/creating-and-editing-explores>
- <https://docs.cloud.google.com/looker/docs/lookml-terms-and-concepts>

事实：

- Looker 通过 Explore、view、dimension、measure 对业务查询空间建模。
- 用户在 Explore 中选择 dimensions/measures，而不是直接操作底层 SQL 字段。

采用解释：

- 成熟 BI 产品把底层数据表转换成业务可理解查询空间。

### 3.8 ThoughtSpot Spotter

来源：

- <https://www.thoughtspot.com/product/agents/spotter>
- <https://www.thoughtspot.com/product/spotter-semantics>

事实：

- ThoughtSpot Spotter 官方强调不是 direct text-to-SQL。
- 它将自然语言转成受 governed semantic layer 约束的 search tokens，并生成可追踪、可审计查询。
- Spotter Semantics 包括业务定义、join logic、层级、安全规则等。

采用解释：

- 高可靠问数的主路径不是“模型自由生成 SQL”，而是语义层约束下的查询生成。

---

## 4. 当前代码事实

### 4.1 cube-ai-project

代码事实锚点：

- `packages/agent/engine/src/bc/tools/handlers/mcp-handler.ts`
  - `McpHandler.invoke()` 调用 MCP bridge 后，工具结果基本原样进入后续链路。
- `packages/agent/engine/src/bc/tools/tool.service.ts`
  - `ToolService.invoke()` 返回 handler result。
- `packages/agent/engine/src/bc/tachu/engine-factory.ts`
  - `buildToolTaskExecutor()` 将 `toolService.invoke(...)` 的输出作为 tool task output 返回。
  - `renderPrefetchOutput()` 对对象结果存在 `JSON.stringify(output)` 的路径。
- `packages/agent/engine/src/bc/session/tachu-sse-mapper.ts`
  - 最终用户气泡来自 engine output / message delta。
- `descriptors/agents/1934000000000000003.yaml`
  - 业务数据分析相关 agent 暴露了 `mcp.biz-ontology.query_database`。

事实判断：

- 当前没有统一 MCP 工具结果投影层。
- 当前没有平台级“敏感 MCP 工具调用后最终回答不得泄露 SQL/MCP URI”的 guard。
- 当前某些路径会把对象工具结果 stringify 后放入模型上下文。
- 当前问题会影响自定义智能体，不仅影响内置智能体。

### 4.2 biz-ontology-platform

代码事实锚点：

- 仓库内存在 `backend/*` 平台服务代码，例如 `backend/main.py`、`backend/routers/ai.py`、`backend/services/*`。
- 仓库内存在 `mcp/*` MCP 工具服务/协议适配代码，例如 `mcp/server_stdio.py`、`mcp/transport_http.py`、`mcp/tools.py`、`mcp/fast_path.py`。
- `backend/routers/ai.py` 中已有 MCP 配置导出、验证和运行时信息相关接口。
- `backend/services/ai_assist/mcp_config_exporter.py` 已体现平台服务对 MCP 配置的管理能力。
- `mcp/server_stdio.py`
  - `_mcp_tool_response(name, result)` 对 `query_database` 生成 `CallToolResult`。
  - 当前会把 `str(result)` 放入 `TextContent`。
- `mcp/tools.py`
  - `query_database(...)` 接受 `connection`、`sql`、`purpose`、`session_id`、`round_num`。
  - 已有只读 SQL、安全检查、tenant/deleted 约束、执行超时、行数限制等机制。
- `mcp/tool_response.py`
  - 已有 `structured_tool_payload()`。
  - 已有 `display_safe_projection()`，目标是面向用户的安全视图。
- 已有测试：
  - `backend/tests/test_mcp_display_payload.py`
  - `backend/tests/test_mcp_tool_compat.py`
  - `backend/tests/test_error_scrub.py`
  - `backend/tests/test_query_database_tenant_rewrite.py`

事实判断：

- biz 仓库已经有安全投影雏形，不是完全没有防护。
- 但 `content=str(result)` 仍是风险，因为 `content` 在多数 host 中可被模型看到。
- 目前 `query_database` 仍是低层 SQL 工具，普通 agent 使用它时，模型天然知道 SQL 参数。
- 仓库结构已经具备“平台服务 + MCP 工具服务”的分层基础，因此问数核心能力更适合沉入 `backend/services/*` 等平台/领域服务层，再由 `mcp/*` 调用。

### 4.3 技术实现依据约束

本文档后续所有“必须实现 / 新增 / 删除 / 改造 / 门阀”都必须能追溯到至少一种依据：

1. 官方协议或成熟产品公开文档；
2. 当前仓库已有代码切点；
3. 当前仓库已有资产、配置、测试或运行日志事实；
4. 用户在本轮范围确认中明确确认的产品约束。

不满足上述任一依据的内容，只能写成：

```text
待调研
待确认
实现候选方案
```

不得写成：

```text
必须实现
采用方案
已确认
合入门阀
```

维护要求：

- 新增任何实现项时，必须同步补充“依据”。
- 如果依据来自代码，必须写明仓库、文件路径和当前行为。
- 如果依据来自协议/外部产品文档，必须写明来源链接和它实际证明了什么。
- 如果只是工程推论，必须标注为“采用解释 / 工程判断”，不能伪装成外部事实。
- 如果实现时发现依据不成立，必须先回滚该设计表述，降级为“待确认”，再继续讨论。

### 4.4 需求到技术依据追踪矩阵

| 实现点 | 技术实现依据 | 设计结论 |
| --- | --- | --- |
| 删除低层 `query_database` MCP tool | `biz-ontology-platform/mcp/tools.py` 当前存在 `query_database(connection, sql, purpose, ...)` 低层 SQL 工具；用户已确认物理删除；截图/日志暴露了 SQL/MCP URI 泄漏风险 | 可以实现，且必须清理 `tools/list`、handler、fast_path、descriptor、config exporter、测试和文档引用 |
| 新增 `ask_business_data` 高层工具 | MCP tools 规范允许 server 暴露工具；`biz-ontology-platform` 已有 `backend/*` 平台服务和 `mcp/*` adapter 分层；用户确认新工具替代旧工具 | 可以实现为 MCP adapter 调用 platform 问数服务；`business_query_service.ask(...)` 是命名建议，不是既有事实 |
| 问数核心放 platform，不放 MCP adapter | MCP 架构说明 server 提供 focused capabilities，host 负责 orchestration/security；本仓库已有 `backend/services/*` 与 `mcp/*` 分层 | 核心服务放 `backend/services/business_query/*` 是目录建议；必须保持 platform service 可复用，MCP 只做协议映射 |
| 工具输出声明 `outputSchema` | MCP 2025-06-18 `CallToolResult` 支持 `structuredContent` 和 `outputSchema` 校验 | `ask_business_data` 必须声明结构化输出 schema |
| `_meta` 承载 audit/debug，不进模型 | MCP / OpenAI Apps SDK 均区分 `structuredContent`、`content`、`_meta`；OpenAI Apps SDK 明确 `_meta` 不给模型 | SQL 指纹、raw columns、traceId 等放 `_meta` 或服务端日志，不进普通用户答案 |
| cube host 做结果投影 | `McpHandler.invoke()` 当前调用 bridge 后基本原样返回；`ToolService.invoke()` 返回 handler result；`buildToolTaskExecutor()` 把 tool output 返回给模型路径 | 在 `McpHandler.invoke()` 后接 `tool-result-visibility` 投影层是可落地切点 |
| grounding/prefetch 不 stringify raw object | `engine-factory.ts` 中 `renderPrefetchOutput()` 存在对象 `JSON.stringify(output)` 路径 | 预取输出也必须走同一投影器 |
| 最终回答 guard | `tachu-sse-mapper.ts` 事实：用户气泡来自 engine output / message delta；当前没有平台级 SQL/MCP URI guard | 在敏感工具后启用流式缓冲和最终文本扫描是可落地切点 |
| progress/status 标准接入 | MCP schema 支持 `_meta.progressToken` 与 `notifications/progress`；当前实现已在 `ToolService → McpHandler → McpBridgeService` 注入 progressToken 并分发 callback；`McpHttpSession.postJsonRpc()` 已流式解析 `text/event-stream`；`EngineFactory` 已把 callback 转成 Tachu `type:"progress"` chunk；`tachu-sse-mapper` 已映射为 SSE `tool.call.progress`；assistant SDK 已消费该事件；真实应用对话前端 `ghcloud-new/.../ai-application/app` 已在 thinking 渲染层展示安全 `progressText` | 采用标准 MCP progress → HTTP/SSE/stdout transport 接收 → agent engine progress chunk → 统一 SSE → assistant SDK 状态消费 → 应用对话 UI thinking 渲染 |
| Streamable HTTP 实时 progress | 历史事实：`McpHttpSession.postJsonRpc()` 曾用 `resp.text()` 一次性解析；2026-08-14 已改为 `text/event-stream` 响应体边读边解析，收到本次 request id 的 result/error 后立即完成调用并取消 reader | 必须保持流式解析，不允许回退到等待响应流关闭；回归测试覆盖“progress 先到、result 后到、响应流不关闭” |
| ContextMapper / CallerContext | 用户确认 platform 不固定读 header；当前 cube MCP HTTP 已有 `authPassthrough='user'` 和 headers 透传切点 | 每个入口 adapter 负责把外部上下文映射为标准 `CallerContext` |
| AccessPolicy fail closed | 当前 `query_database` 已有 tenant/deleted 约束测试；用户确认实体无字段必须显式 `not_applicable` 才能不过滤 | policy resolver 必须默认拒绝，显式配置后才放行 |
| SQL executor 安全约束 | `biz-ontology-platform/mcp/tools.py`、`mcp/security.py` 和 `backend/tests/test_query_database_tenant_rewrite.py` / `test_error_scrub.py` 已有只读、tenant/deleted、脱敏等安全约束事实 | 低层 MCP tool 删除后，安全约束必须迁移到 platform 内部 SQL executor |
| display_policy 默认隐藏 raw id/code | 当前泄漏问题包含 raw id/code/null/枚举不可理解；YAML 字段 display_name 不等于可展示授权；用户确认默认隐藏 | 结果投影必须依据 display_policy 决定用户可见字段 |
| `_mcp_tool_response()` 安全返回 | `biz-ontology-platform/mcp/server_stdio.py::_mcp_tool_response()` 当前对 `query_database` 构造 `CallToolResult`；`mcp/tool_response.py` 已有 `structured_tool_payload()` / `display_safe_projection()` | 必须改造为 `content` 只放安全摘要，完整 raw/audit 只进 `_meta` 或日志 |
| 复用 YAML / 本体资产 | `docs/ontology-spec.md`、`ontology_backup/*` 已存在实体、字段、枚举、同义词、示例问题等资产 | 不能另起一套脱离 YAML 的语义层 |
| 业务域快速识别 | `ontology_backup/_business_domains.yaml` 已存在业务域结构；实体 YAML / `_index.yaml` 已有 keywords、attributes、relationships 等召回资产；用户确认 agent 不绑定业务域 | platform 必须在问数时做 domain routing，不能依赖 agent 预绑定领域 |
| 拆分 question bank / verified queries / eval set | 现有 `_question_bank.yaml` 包含 `review_state=ai`、`confidence=0.0` 样例，不能直接等同 verified | 必须拆分候选、已验证、评估集 |
| metric catalog | entity YAML 已有 `aggregatable` / enum / query_examples；但复杂业务指标不是字段属性可完全表达；用户确认新增 `_metrics.yaml` | 简单指标可派生，复杂指标必须显式配置 |
| 同义词和枚举翻译 | YAML / glossary 中已有 synonyms、enum_values、dict_ref、review_state；用户样例暴露了 raw enum/code 不可理解问题 | 同义词必须可追踪来源，AI 自动建议必须人工确认后生效；缺映射不得编造 |
| 业务计划而非模型自由 SQL | Snowflake Cortex Analyst、ThoughtSpot 等公开文档均指向 semantic model / governed semantic layer；现有低层 SQL 暴露导致泄漏 | LLM 最多生成 plan 草案，最终 SQL 由 platform 基于语义层生成并校验 |
| domain routing 用关键词 + 向量召回 | 用户确认；`cube-ai-project` 已有 Qdrant 基础设施；`biz-ontology-platform` 有 YAML semantic assets 可生成索引语料；spike 发现 biz 仓库当前无向量库 repository 抽象，也无 Qdrant 依赖/compose/config | 必须设计 `SemanticVectorRepository` / `VectorStorePort` 抽象；Qdrant 只是首个生产 adapter，不进入问数核心业务代码 |
| Qwen embedding 固定模型 | 阿里云百炼文档存在 `qwen3.7-text-embedding`；用户确认先写死该模型 | 当前阶段可固定 provider/model，但必须封装 provider strategy / factory |
| 向量索引记录模型/维度 | 向量库 collection/index 的 vector size 与 embedding 维度绑定；阿里云文档说明模型支持不同维度 | 必须在 payload/config 记录 model/dim/version，变更时触发重建；具体 adapter 不影响业务层接口 |
| dirty/failed semantic index | 用户确认 YAML 变更异步重建、失败可重试；向量库是派生索引，不是真相源 | YAML 是 source of truth；索引状态必须可观测和可降级 |
| 同步等待 + 硬超时 | 用户确认 chat 场景不能返回异步 taskId；当前 Bun 服务有请求 timeout 风险；当前问数约 1 分钟是用户事实反馈 | Chat 总等待默认 60s、SQL 30s，均可配置；必须有超时和进度 |
| eval 分指标门阀 | 用户目标是检索/问数质量，而安全不可按平均分抵消；现有问题是安全泄漏类缺陷 | 采用 intent/entity/metric/dimension/filter/presentation 分指标门阀 |
| 测试与合入命令 | 当前仓库 `AGENTS.md` 明确 cube 改完跑 `bun run typecheck && bun test`；biz 仓库已有 pytest 风格测试目录 | 两仓库必须分别跑既有测试，并新增泄漏/权限/eval 场景 |

矩阵状态：

- 上表是第一版主干追踪矩阵。
- 后续如果新增更细的实现点，例如具体 TypeScript 类型名、Python 模块名、配置项名、表结构、测试文件名，也必须继续补充到矩阵或对应小节的“技术依据”段落。
- 表中仍写有“需验证”的项，实施前必须通过代码检查或 spike 验证后再进入实现。

### 4.5 当前审计分级

#### A. 已有充分依据，可以作为必须项

- 删除 `query_database` MCP 暴露入口。
- 新增 `ask_business_data` 高层 MCP 工具。
- MCP 工具结果按模型可见、用户可见、审计可见分层。
- `ask_business_data` 声明 `outputSchema` 并返回安全 `structuredContent`。
- cube host 增加 MCP 结果投影和最终回答 guard。
- 敏感字段、SQL、MCP URI、tool args 不进入普通用户最终回答。
- AccessPolicy 默认 fail closed。
- display_policy 默认隐藏技术 id/code。
- `_question_bank.yaml` 不能直接等同 verified query。
- YAML / 本体资产必须复用。
- progress/status 不能放在工具最终结果里，必须走执行态事件。

#### B. 已完成 spike，结论可指导实现但仍需细化命名/配置

- `Tachu` stream chunk 承载 progress 的实现路径：
  - 依据：当前 `TurnService` 通过 `runStream()` chunk 映射 SSE，技术方向成立；`tachu-sse-mapper` 已有统一 chunk → SSE 映射入口。
  - spike 事实：当前仓库未安装可读的 `node_modules/@tachu/core` 类型文件；`package.json` / `bun.lock` 只显示 `@tachu/core@1.0.0-rc.14` 外部依赖，因此不能假设上游正式声明了 `tool-progress` 类型。
  - 2026-08-14 实现事实：本阶段没有修改 `@tachu/core`，而是在 `EngineFactory.runStream()` 内部把 MCP progress callback 放入本轮队列，再以兼容 mapper 的 Tachu `type:"progress"` chunk 产出；mapper 再统一映射为 `tool.call.progress` SSE。
  - 结论：当前实现是“EngineFactory 同级编排层桥接 progress chunk”，不是扩展上游 Tachu 协议；后续若 `@tachu/core` 正式提供 tool progress 类型，再迁移到正式类型。
- `backend/services/business_query/*` 与 `business_query_service.ask(...)`：
  - 依据：biz 仓库已有 `backend/services/*`，适合承载平台服务。
  - spike 事实：`biz-ontology-platform/backend/services/` 已有平台服务目录；`mcp/` 与 `backend/` 分层清晰；当前没有 `business_query` 包。
  - 结论：新增 `backend/services/business_query/` 包是合理默认落点；`business_query_service.ask(...)` 仍只是命名建议，最终函数名按 Python 模块组织确定。
- `SemanticVectorRepository` / Qdrant adapter 接入 `biz-ontology-platform`：
  - 依据：用户确认语义召回需要向量索引；用户进一步确认不要把 Qdrant 直接写成业务依赖；cube 仓库已有 Qdrant 基础设施。
  - spike 事实：`biz-ontology-platform/backend/requirements.txt` 没有 `qdrant-client`；`docker-compose.yml` 只有 `mcp` / `platform` 两个服务；`.env.example` 和配置模板没有 Qdrant 连接项。
  - 结论：biz 仓库当前不能复用现成向量库能力，必须新增 repository 抽象、Qdrant adapter、Python 依赖、环境变量、配置读取、健康检查和部署说明。
- Qwen embedding provider strategy / factory：
  - 依据：用户确认 `qwen3.7-text-embedding`；阿里云文档提供模型和参数事实。
  - spike 事实：biz 仓库已有 `backend/services/ai_assist/llm_client.py` 和 `model_router.py`，但它们是 chat completion 路径，payload 默认拼 `/chat/completions`，并有“自动关思考”逻辑；未发现 embedding client。
  - 结论：不要复用 chat LLM client 直接做 embedding。应新增独立 `EmbeddingProvider` / `QwenEmbeddingProvider`，可复用配置读取思想，但不能复用 chat endpoint/payload。
- 性能门阀 p50/p95：
  - 依据：用户反馈当前约 1 分钟，必须改善；成熟问数产品强调 semantic model / verified query 降低搜索空间。
  - spike 事实：`mcp/logger.py::log_query()` 已记录 query `duration_ms`；`backend/services/ai_assist/audit.py` 已记录 LLM `duration_ms/tokens/cached`；但当前本地 `logs/` 只有 asset cleanup / business_domain 日志，没有 query/llm JSONL，可用样本不足。
  - 结论：p50/p95 仍是目标门阀，不是事实基线。实现前必须先跑代表性问数采集 query/llm 日志，生成基线报告后再决定是否调整数字。

#### C. 当前仍待确认，不能写死为已确认业务事实

- 首批 eval 50 条的具体样例和期望结果：可以实现“生成候选 → pending_manual_review → 人工确认 → 进入门阀”的流程，但不得把 AI 生成的具体样例直接写成已确认事实或合入门阀样例。

---

## 5. 目标与非目标

### 5.1 必须达成的目标

以下目标全部必须落地，不按优先级拆分：

1. 普通业务用户最终回答不得出现 SQL 原文。
2. 普通业务用户最终回答不得出现 `mcp://` 或工具调用 URI。
3. 普通业务用户最终回答不得出现 MCP tool arguments JSON。
4. 普通业务用户最终回答不得出现 connection、session_id、round_num、trace_id 等内部运行字段。
5. 普通业务用户最终回答不得出现未解释的 raw id/code/枚举值。
6. `query_database` 这种低层 SQL 查询 MCP 工具必须物理删除，不再对任何 agent 暴露。
7. 普通 agent 必须通过高层业务问数工具访问问数能力。
8. 高层业务问数工具必须有结构化输出 schema。
9. MCP 工具结果必须有模型可见、用户可见、审计可见的边界。
10. cube host 必须强制执行工具可见性和结果投影，不能信任 MCP server 自觉。
11. biz MCP 必须返回安全摘要和业务语义结果，不能把 raw result 放入 `content`。
12. 必须建立 eval / 门阀测试，不符合不得合入。

### 5.2 非目标

以下不是本次改造目标：

- 不做通用数据库 BI 产品的完整替代。
- 不要求一次性覆盖所有未知外部 MCP 的完美语义翻译。
- 不要求普通用户看到 SQL 调试细节。
- 不把“模型回答得更像人”作为安全验收标准。
- 不以“prompt 写得更严格”作为完成标准。

### 5.3 明确不接受的方案

以下方案不得作为主方案：

- 只改智能体 prompt。
- 只让前端隐藏 SQL。
- 继续保留 `query_database(connection, sql, ...)` 作为 MCP 工具。
- MCP server 继续把 `str(result)` 全量放到 `content`。
- 缺失枚举映射时让模型自行猜测业务含义。
- 用户看到“请补充 outputSchema / structuredContent”这类开发者提示。

---

## 6. 总体架构

### 6.1 能力归属边界

本次改造必须明确能力归属：

```text
biz-ontology-platform
  ├─ backend / platform service
  │   ├─ business query core
  │   │   ├─ semantic catalog
  │   │   ├─ intent resolver
  │   │   ├─ metric / dimension mapper
  │   │   ├─ query planner
  │   │   ├─ SQL generator
  │   │   ├─ SQL validator
  │   │   ├─ SQL executor
  │   │   ├─ result semantic projector
  │   │   ├─ verified query repository
  │   │   └─ eval runner
  │   │
  │   ├─ REST / admin API
  │   └─ management / observability
  │
  ├─ frontend / management UI
  │   ├─ business domain / ontology editor
  │   ├─ question bank / verified query review
  │   ├─ eval set review / run result
  │   ├─ access policy / display policy configuration
  │   ├─ semantic index status / rebuild / retry
  │   └─ business query workbench
  │
  └─ mcp adapter
      ├─ tools/list
      ├─ tools/call
      ├─ inputSchema / outputSchema
      ├─ content / structuredContent / _meta
      └─ call platform business query core
```

设计结论：

- 问数核心能力归属 `backend / platform service`。
- 前端管理页面必须同步支持后端新增能力；不能出现后端已经切到 `ask_business_data`、语义层/eval/策略已重构，但前端仍展示旧 `query_database` / `resolve_business_query` 或旧 question bank 审核语义。
- MCP 工具服务只做协议适配和薄 orchestration。
- MCP adapter 不直接沉淀一套独立 SQL 生成、语义映射、eval 或缓存逻辑。
- 如果 MCP、REST、管理端、eval 都需要同一能力，必须从同一个平台服务函数/模块调用。

理由：

- MCP 官方定位是 host/client/server 的上下文和工具接入协议；server 提供 focused capabilities，不要求把业务系统核心实现写在协议层。
- 问数能力不仅服务 agent，还会服务管理端、验收 eval、问题回放、verified query 维护、慢查询分析。
- 如果核心写在 `mcp/*`，REST/API/eval 复用会困难，未来容易出现 MCP 一套逻辑、平台服务一套逻辑。
- `biz-ontology-platform/frontend/src/views` 当前已有 `EvalPage.vue`、`QuestionBankPage.vue`、`BusinessDomainPage.vue`、`OntologyEditorPage.vue`、`WorkbenchPage.vue` 等页面，说明管理端已经承载本体、问数、评估相关操作入口，本次后端能力变化必须同步到前端页面和 API client。

反对的做法：

```text
mcp/tools.py
  ├─ 自己解析意图
  ├─ 自己维护语义层
  ├─ 自己生成 SQL
  ├─ 自己做 eval
  └─ 自己缓存查询计划
```

这种做法短期快，但会让 MCP adapter 变成“隐藏小单体”，不利于测试、复用、管理和后续演进。

可接受的做法：

```python
# mcp/tools.py 中只做薄适配；以下函数/模块名是落地命名建议，不是当前既有代码。
def ask_business_data(question: str, context: dict | None = None):
    result = business_query_service.ask(
        question=question,
        context=context,
        caller="mcp",
    )
    return to_mcp_call_tool_result(result)
```

本设计已确认：新增 `ask_business_data` 作为正式普通 agent 主入口，MCP adapter 调用 platform service。

需要注意：

- `business_query_service.ask(...)` 是建议命名。
- 实施前必须结合 `biz-ontology-platform/backend/services/*` 当前包结构确认最终模块名和导入路径。
- 不允许因为命名未定，就把核心问数逻辑写回 `mcp/tools.py`。

### 6.2 改造后的主链路

```text
用户自然语言问题
  ↓
cube agent engine
  - 只向普通 agent 暴露高层业务问数工具
  - 不存在 query_database 可暴露入口
  ↓
biz-ontology-platform MCP
  - 接收 MCP tool call
  - 调用平台服务 business query core
  ↓
biz-ontology-platform platform service
  - 意图识别
  - 术语/实体/指标/维度解析
  - 枚举/同义词映射
  - verified query / query template 匹配
  - 需要时生成受控查询计划
  - 后端生成 SQL
  - SQL 安全检查与权限约束
  - 执行查询
  - 结果语义投影
  ↓
MCP structuredContent + safe content + audit metadata
  ↓
cube MCP host 投影
  - 模型可见内容过滤
  - 用户可见内容过滤
  - 审计内容隔离
  ↓
模型组织最终业务回答
  ↓
最终回答 guard
  - SQL/MCP URI/raw JSON 泄漏检测
  - 必要时缓冲、重写或拒绝输出
  ↓
用户看到业务答案
```

### 6.3 工具分层

#### 6.3.1 普通 agent 可见工具

主入口已确认：

```text
ask_business_data
```

旧入口移除：

```text
resolve_business_query
```

处理规则：

- `ask_business_data` 是普通 agent 唯一默认问数入口。
- `resolve_business_query` 本次重构物理清理。
- 清理范围必须包括 MCP tools/list、tool handler、fast_path、descriptor、测试、配置导出、文档和外部示例。
- 不保留旧语义入口，不维护兼容委托。
- 如果发现外部客户端仍引用旧工具，应在发布说明中明确破坏性变更和新工具迁移方式，而不是在代码里继续保留旧入口。

#### 6.3.2 低层 SQL MCP 工具

物理删除：

```text
query_database
```

原因：

- 只要它仍作为 MCP tool 存在，就有被 agent 或外部 host 暴露/误用的风险。
- 当前事故正是低层 SQL 工具进入模型链路后导致的边界问题。
- 既然本次重构已经确定以 `ask_business_data` 为唯一问数入口，就不应继续保留可调用 SQL MCP 工具。

保留的不是 MCP tool，而是平台服务内部能力：

- SQL 安全校验；
- tenant/deleted 约束；
- ai_ 视图限制；
- parser fail closed；
- timeout / max rows；
- 审计日志；
- SQL 指纹。

这些能力应抽取到：

```text
backend/services/business_query/sql_executor.py
```

或同等平台服务模块中，由 `ask_business_data` 内部调用。

---

## 7. MCP 返回结构设计

### 7.1 通用性原则

不能设计成只有 cube 才能理解的私有协议。应遵守 MCP 标准字段：

- `content`
- `structuredContent`
- `_meta`
- `outputSchema`
- `isError`

其中：

- `structuredContent` 使用通用业务问数结构，字段名尽量通用。
- cube 私有调试/审计扩展放到 `_meta["cube.ai/audit"]` 这类 namespaced 字段。
- 不要求外部 agent 理解 cube 私有字段，也不把 cube 私有字段作为回答必需条件。

### 7.2 高层业务问数工具输出结构

建议 `structuredContent`：

```json
{
  "status": "answered",
  "answer": {
    "summary": "查询到 5 个风险单元，其中较大风险 1 个。",
    "columns": [
      {
        "key": "risk_unit_name",
        "label": "风险单元",
        "semanticType": "entity_name"
      },
      {
        "key": "inherent_risk_level",
        "label": "固有风险等级",
        "semanticType": "enum_label"
      }
    ],
    "rows": [
      {
        "risk_unit_name": "制冷机房",
        "inherent_risk_level": "较大风险"
      }
    ],
    "rowCount": 5,
    "hasMore": false
  },
  "interpretation": {
    "question": "查询固有风险等级",
    "matchedEntities": ["风险单元"],
    "matchedMetrics": [],
    "matchedDimensions": ["固有风险等级"],
    "filters": []
  },
  "confidence": {
    "level": "high",
    "basis": "matched_semantic_fields"
  },
  "warnings": [],
  "suggestions": []
}
```

`content` 只允许安全摘要：

```json
[
  {
    "type": "text",
    "text": "已完成业务问数查询，返回 5 条可展示结果。"
  }
]
```

`_meta` 可放审计信息：

```json
{
  "cube.ai/audit": {
        "tool": "ask_business_data",
    "queryPlanFingerprint": "sha256:...",
    "sqlFingerprint": "sha256:...",
    "durationMs": 830,
    "rawRowCount": 5,
    "traceId": "..."
  }
}
```

### 7.3 歧义问题输出结构

如果问题无法可靠回答，不得硬猜。

```json
{
  "status": "needs_clarification",
  "answer": {
    "summary": "当前问题存在歧义，需要确认查询口径。"
  },
  "clarification": {
    "question": "你想查询固有风险等级的明细，还是按等级统计数量？",
    "options": [
      {
        "label": "查询明细",
        "example": "列出各风险单元的固有风险等级"
      },
      {
        "label": "统计数量",
        "example": "按固有风险等级统计风险单元数量"
      }
    ]
  },
  "warnings": [
    {
      "code": "AMBIGUOUS_INTENT",
      "message": "问题同时可能对应明细查询和聚合统计。"
    }
  ],
  "suggestions": [
    "按固有风险等级统计风险单元数量",
    "列出固有风险等级为较大风险的风险单元"
  ]
}
```

面向业务用户的最终回答应是：

```text
这个问题有两种常见理解：一种是查看每个风险单元的固有风险等级明细，另一种是按等级统计数量。你想看哪一种？
```

不允许对业务用户展示：

```text
工具已返回查询结果，但结果缺少 outputSchema，请补充 structuredContent。
```

这种提示只允许进入开发/管理端诊断。

### 7.4 无法翻译枚举的输出结构

```json
{
  "status": "answered",
  "answer": {
    "summary": "查询到 3 条记录，但有 1 个字段缺少枚举映射。",
    "columns": [
      {
        "key": "risk_level",
        "label": "风险等级",
        "semanticType": "enum_untranslated"
      }
    ],
    "rows": [
      {
        "risk_level": "3"
      }
    ]
  },
  "warnings": [
    {
      "code": "UNTRANSLATED_ENUM",
      "field": "risk_level",
      "message": "字段 risk_level 缺少可靠枚举映射，未翻译。"
    }
  ]
}
```

状态口径说明：

- `answered_with_warnings` 不再作为状态枚举使用；
- 有警告但仍可回答时，统一使用 `status: "answered"`，并通过 `warnings[]` 表达警告；
- 无法安全回答或无法回答时，统一使用 `status: "failed"`；
- 需要用户补充信息时，统一使用 `status: "needs_clarification"`。

最终回答：

```text
查询到了风险等级字段，但当前缺少该字段的枚举映射，因此只能确认原始值为 3，不能可靠判断它对应哪个业务等级。
```

不允许回答：

```text
风险等级为较大风险。
```

除非语义层存在事实映射依据。

---

## 8. biz-ontology-platform 改造方案

### 8.1 高层业务问数主入口

已确认决策：

> 新增 `ask_business_data` 作为普通 agent 唯一默认业务问数工具。旧的 `resolve_business_query` 本次重构物理清理，不再保留旧语义入口。

事实依据：

- 当前仓库已有 `mcp/fast_path.py` 和 `resolve_business_query` 相关测试，说明物理清理必须同步处理引用，不能只删一个函数名。
- 但旧入口命名偏“解析业务查询”，更像内部能力或过渡工具；`ask_business_data` 更明确表达“业务用户问数”的产品语义。
- MCP tools 规范允许 server 暴露多个工具，但 host 应控制哪些工具对模型可见；因此可以新增新工具，同时在 cube host 层禁止普通 agent 默认看到旧工具。

落地规则：

- `ask_business_data` 新增干净 inputSchema / outputSchema。
- `ask_business_data` 内部调用 platform 问数服务；`business_query_service.ask(...)` 是建议命名，最终模块名需实现前结合 `backend/services/*` 包结构确认。
- 普通 agent descriptor / 自定义 agent 工具列表默认只暴露 `ask_business_data`。
- `resolve_business_query` 物理清理，不再出现在 tools/list、配置导出、descriptor 示例和测试夹具中。
- `query_database` MCP tool 物理删除；SQL executor 按新形态完全重写为 platform 内部 service，旧实现只作为安全约束与测试参考。
- 发布说明必须说明破坏性变更：旧 `resolve_business_query` 已移除，调用方迁移到 `ask_business_data`。
- 前端页面和 API client 必须同步迁移：
  - `WorkbenchPage.vue` / 问数调试入口只能调用新的 platform business query API 或 `ask_business_data` 对应后端能力，不再暴露任意 SQL 查询入口。
  - 旧独立 `QuestionBankPage.vue` 不再保留为可访问页面；candidate question / verified eval case / 人工 review 能力迁移到 `EvalPage.vue` 或新的问数评测区域。
  - `EvalPage.vue` 必须支持 `_eval_set.yaml` 的 case 结构、人工确认状态、门阀结果、准确性分项指标和失败详情。
  - `BusinessDomainPage.vue` / `OntologyEditorPage.vue` 必须能维护或展示 business domain、semantic assets、access policy、display policy 与 semantic index 状态。
  - 前端不得展示 “请补充 outputSchema / structuredContent” 这类开发者提示给普通业务用户；配置缺失应展示业务化、可操作的管理提示。

反对的做法：

- 同时把 `ask_business_data` 和 `resolve_business_query` 暴露给普通 agent。
- 在 `ask_business_data` 中写一套新逻辑，在 `resolve_business_query` 中保留一套旧逻辑。
- 只删除函数、不清理 descriptor / tests / config exporter / docs，造成半残留。
- 只改 MCP/后端，不改管理端页面，导致用户仍能从页面配置或调试旧低层 SQL 工具。

### 8.2 低层 `query_database` MCP 工具物理删除

`query_database` 作为 MCP 工具必须物理删除。

删除前：

```text
普通 agent → query_database(connection, sql, purpose) → raw-ish 查询结果
```

删除后：

```text
普通 agent → ask_business_data(question, context?) → 业务结果
ask_business_data 内部 → platform 问数服务 → SQL executor → 审计结果
```

要求：

- `mcp.tools.query_database` 函数删除或改为非 MCP 私有实现，不能出现在 `tools/list`。
- `server_stdio.py` / `server_http.py` / `transport_http.py` 不再注册 `query_database`。
- MCP 配置导出不再出现 `query_database`。
- descriptor、测试、文档、示例中不再把 `query_database` 作为可调用 MCP 工具。
- 原 `query_database` 中的 SQL 安全能力迁移到平台服务内部 `sql_executor`。
- 管理员调试不通过 MCP 暴露 SQL tool；如确需调试，通过受控平台管理 API 或后台日志查看。

### 8.2.1 前端同步改造

已确认决策：

> 前端页面必须和后端业务问数能力同步改造，功能语义保持一致；不能只改 MCP/后端而保留旧页面入口。

当前代码事实：

- `biz-ontology-platform/frontend/src/views/EvalPage.vue` 已存在 eval 页面。
- `biz-ontology-platform/frontend/src/views/QuestionBankPage.vue` 已存在 question bank 页面。
- `biz-ontology-platform/frontend/src/views/BusinessDomainPage.vue` 已存在业务域页面。
- `biz-ontology-platform/frontend/src/views/OntologyEditorPage.vue` 已存在本体编辑页面。
- `biz-ontology-platform/frontend/src/views/WorkbenchPage.vue` 已存在工作台/调试入口。
- `biz-ontology-platform/frontend/src/api/*` 已存在前端 API client 层。
- 2026-08-17 已新增内部问数对话验证页 `BusinessQueryChatPage.vue`，用于在接入 MCP/cube 前先验证 platform 问数自身链路。

必须同步的页面能力：

1. 旧 `QuestionBankPage.vue`
   - 作为独立旧页面和路由删除。
   - `_question_bank` 文件继续作为内部语义资产与 eval 候选来源。
   - candidate question、verified eval case、人工 Accept/Edit/Dismiss、`verified_by` / `verified_at` / 审核状态迁移到 `EvalPage.vue` 或新的问数评测区域。

2. `EvalPage.vue`
   - 支持 `_eval_set.yaml` case 结构。
   - 展示 50 条 eval 的分类、人工确认状态、门阀结果和失败详情。
   - 支持展示安全泄漏断言结果，例如 SQL/MCP URI/raw id/raw code/internal error 是否泄漏。

3. `BusinessDomainPage.vue`
   - 展示业务域、实体绑定、domain routing 召回信息。
   - 支持查看 semantic index 状态：fresh / dirty / failed、最近重建时间、失败原因、重试入口。
   - 支持查看高风险领域 dirty 行为配置，例如 keyword-only 降级或 fail closed。

4. `OntologyEditorPage.vue`
   - 支持维护 access policy、display policy、metric catalog、synonyms/enums。
   - 对 AI 建议内容必须展示为 `suggested_*`，人工确认后才写入正式 policy/metric/synonym。

5. `WorkbenchPage.vue`
   - 调试问数时走新的 platform business query API。
   - 不再提供普通用户可见的任意 SQL 输入/执行入口。
   - 调试结果必须区分用户可见结果、debug/audit 信息和被隐藏字段。

6. `BusinessQueryChatPage.vue`
   - 作为 platform 内部验证入口，路由为 `/business-query-chat`。
   - 后端 API 为 `POST /api/ai/business-query/chat`，先同步执行 `ask_business_data()`，再用 `LlmClient.chat(scene="business_query_chat")` 基于安全投影结果组织回答。
   - 模型来自 `config.llm.primary.*`；如需覆盖，只能通过 `llm.scene_overrides.business_query_chat`，代码不得写死 provider/model。
   - 页面展示可收缩执行 trace：读取模型配置、执行业务问数、结果投影、LLM 组织回答。
   - 这里的“思考过程”是可审计执行过程，不是模型 chain-of-thought。
   - trace 和最终回答必须有内部查询/工具细节 guard，命中 SQL/MCP URI/tool args/raw diagnostics 时回退为结构化摘要。

7. 前端 API client
   - 新增或调整 business query、eval、verified query、semantic index、policy 相关 API 封装。
   - 删除或隐藏旧 `query_database` / `resolve_business_query` 相关调用入口。

前端验收门阀：

- UI 中不得出现普通用户可触达的任意 SQL 执行入口。
- UI 中不得把 `review_state=ai` / `pending_manual_review` 展示成已验证。
- eval 页面必须能看见每条 case 的安全断言是否通过。
- 语义索引 dirty/failed 时，管理端必须可见；普通问数页只展示业务化状态。
- 前端测试需覆盖 question bank 状态转换、eval case 展示、旧入口不可见、泄漏断言展示。

### 8.3 平台内部 SQL executor 重写

已确认决策：

> SQL executor 可以完全重写。重写目标不是复用旧代码形态，而是保留并强化旧能力中的安全约束。

新模块建议：

```text
backend/services/business_query/sql_executor.py
backend/services/business_query/policy_resolver.py
backend/services/business_query/context_mapper.py
backend/services/business_query/query_planner.py
```

SQL executor 输入不再是模型或 MCP 传入的 SQL 字符串，而是 platform 校验后的 `BusinessQueryPlan` 和 `CallerContext`：

```text
BusinessQueryPlan + CallerContext + AccessPolicy
  ↓
PolicyResolver 注入强制约束
  ↓
SQLGenerator 生成 SQL
  ↓
SQLExecutor 执行前复核 SQL 满足所有 required policy
```

必须保留的安全约束：

- 只读查询；
- 仅允许受控 AI view；
- tenant / deleted / row scope 等 AccessPolicy 强制过滤；
- required policy 缺失 fail closed；
- parser 失败 fail closed；
- metadata 缺失 fail closed；
- timeout；
- max rows；
- SQL 指纹；
- 审计日志；
- 错误脱敏。

禁止：

- MCP 或外部业务应用直接传 SQL where 条件；
- LLM 直接生成最终 SQL；
- 未经 `PolicyResolver` 的 plan 进入 executor；
- executor 只相信上游“已经加过权限条件”而不复核。

### 8.4 CallerContext / ContextMapper

已确认决策：

> platform 不固定读取某个 header。每个入口 adapter 负责把自己的原始上下文映射成 platform 标准 `CallerContext`。

入口包括：

- MCP HTTP adapter；
- MCP stdio adapter；
- REST API；
- 管理端；
- 后台 eval；
- 定时任务；
- 未来其它 agent host。

MCP adapter 可以适配 MCP 调用传入的 headers / token / session context，但它只是入口适配，不负责权限裁决。

标准 `CallerContext` 示例：

```json
{
  "source": "mcp_http",
  "tenant": "1",
  "userId": "1933397616237330433",
  "roles": ["safety_admin"],
  "subjectType": "user",
  "scopes": {
    "orgIds": ["1001", "1002"],
    "areaIds": ["2001"]
  },
  "claims": {
    "issuer": "cube-agentic-engine"
  }
}
```

ContextMapper 示例：

```yaml
context_mappers:
  cube_agent_mcp:
    source: mcp_http
    tenant:
      from: header
      name: X-Cube-Tenant
      required: true
    userId:
      from: header
      name: X-Cube-User-Id
      required: true
    token:
      from: header
      name: Authorization
      required: true
    scopes:
      provider: cube_permission_hook
```

业务应用权限 hook 只能返回结构化 scopes / claims，不允许返回 SQL 片段：

```json
{
  "subject": {
    "tenant": "1",
    "userId": "u_123"
  },
  "scopes": {
    "orgIds": ["o1", "o2"],
    "areaIds": ["a1", "a2"]
  }
}
```

### 8.5 AccessPolicy

已确认决策：

> 权限策略属于 platform；MCP 只传上下文。AccessPolicy 先采用 connection/domain 级 `_access_policy.yaml` + entity override。

合并优先级：

```text
global default deny
  ↓
connection policy
  ↓
domain policy override
  ↓
entity policy override
```

默认策略：

- 默认 fail closed；
- 没有明确 `access_policy` 不允许执行；
- 实体没有 tenant/deleted 字段时，必须显式声明 `not_applicable` 才允许不过滤；
- `not_applicable` 是安全例外，AI/系统可以建议，但不能直接生效；
- 运行时只认人工确认或明确配置后的 `access_policy`。

建议与生效分离：

```yaml
suggested_access_policy:
  tenant:
    mode: not_applicable
    evidence:
      - "未发现 tenant/tenant_id/company_id 等候选字段"
    review_state: ai

access_policy:
  tenant:
    mode: not_applicable
    reason: "系统字典实体，无租户隔离字段"
    review_state: reviewed
```

允许内置字段候选规则生成建议，但不得直接生效：

```text
tenant candidates: tenant, tenant_id, tenantId
soft delete candidates: deleted, is_deleted, delete_flag
org scope candidates: org_id, organization_id, dept_id
```

AccessPolicy 示例：

```yaml
default_behavior: deny

defaults:
  tenant:
    mode: required_filter
    field: tenant_id
    source: caller_context.tenant
    required: true
  soft_delete:
    mode: required_filter
    field: deleted
    value: 0
    required: true

entity_overrides:
  SystemDict:
    tenant:
      mode: not_applicable
      reason: "系统字典实体，无租户字段"
      review_state: reviewed
    soft_delete:
      mode: not_applicable
      reason: "系统字典实体，无软删除字段"
      review_state: reviewed
```

### 8.6 现有 YAML / 本体资产复用策略

不能另起一套脱离现有 YAML 的语义层。`biz-ontology-platform` 已经有本体 YAML 体系，应作为问数语义层的主要事实来源。

事实依据：

- `docs/ontology-spec.md` 明确写到：业务本体用于让 LLM 不靠“瞎猜”也能把自然语言问题翻译成正确 SQL。
- `docs/ontology-spec.md` 定义了三层映射：
  - 物理层 → 语义层，例如 `ai_tenant.building_no` → “楼栋编号”；
  - 业务术语层，把业务黑话翻译成 SQL 片段或业务口径；
  - 示例层，问题 → SQL 的 few-shot。
- `ontology_backup/_business_domains.yaml` 已包含业务域森林和 leaf entity 关联。
- `ontology_backup/<connection>/_index.yaml` 已包含每个连接下的 entity、display_name、description、view_name、key_attributes、keywords。
- `ontology_backup/<connection>/<Entity>.yaml` 已包含 entity、data_source、attributes、relationships、synonyms、query_examples、constraints 等结构。
- entity attributes 中已经存在 `display_name`、`type`、`important`、`searchable`、`aggregatable`、`enum_values`、`dict_ref` 等可直接服务语义识别和结果投影的字段。
- `ontology_backup/<connection>/_question_bank.yaml` 已存在问题、SQL、涉及实体、intent_tag、difficulty、explanation、confidence、review_state 等问答资产。
- `backend/services/ai_assist/question_bank_builder.py`、`eval_kit.py`、`prompt_generator.py`、`dict_ref_analyzer.py`、`enum_text_builder.py` 等文件说明平台服务已经存在围绕 YAML 的生成、评估、提示词和字典相关能力。

设计结论：

- 现有 YAML 是业务问数语义层的初始事实源。
- 新增 `ask_business_data` 不应绕过 YAML 另建独立配置。
- YAML 中已有字段应优先复用；缺失的能力通过扩展 YAML schema 或派生索引补齐。
- 不能把 raw SQL question bank 当成唯一能力；它应升级为 verified query / eval / query template 的来源。

可复用字段映射：

| 现有 YAML 字段 | 问数用途 |
|---|---|
| `_business_domains.yaml.nodes` | 业务领域、领域层级、领域候选选择 |
| `_business_domains.yaml.leaf_entity_assoc` | 业务领域 → connection/entity 绑定 |
| `_index.yaml.entities[].display_name` | 实体识别和用户可见名称 |
| `_index.yaml.entities[].description` | 实体语义描述 |
| `_index.yaml.entities[].keywords` | 召回候选实体 |
| `entity.data_source.view_name` | 受控查询对象 |
| `entity.attributes[].display_name` | 字段语义 label |
| `entity.attributes[].type` | 字段类型、聚合/过滤可行性 |
| `entity.attributes[].searchable` | 可检索字段候选 |
| `entity.attributes[].aggregatable` | 指标候选 |
| `entity.attributes[].important` | 默认展示字段候选 |
| `entity.attributes[].enum_values` | 枚举翻译 |
| `entity.attributes[].dict_ref` | 字典外键翻译 |
| `entity.relationships` | JOIN / 跨实体查询候选 |
| `entity.synonyms` | 术语识别和别名映射 |
| `entity.query_examples` | verified query / few-shot / eval 候选 |
| `_question_bank.yaml.questions` | 高频问题、回归问题、查询模板候选 |

必须补齐/增强的地方：

- YAML 目前能描述字段和示例，但“指标 metric”还不够一等公民，需要新增或派生 metric catalog。
- YAML 目前有 `query_examples` / `_question_bank`，但 review_state / confidence 不等于 verified，需要明确 verified 状态、验证人、验证时间和预期结果规则。
- YAML 里存在 `view_sql` / `view_definition`，它们属于审计/构建信息，不应进入普通用户回答。
- YAML 里 `id`、`tenant_id` 等字段可能带有中文 display_name，但仍不代表默认可展示；必须结合 `important`、字段命名规则和 display policy 判断。
- 业务域结构可帮助缩小实体候选，但不能单独决定查询意图。

### 8.7 语义识别流程

`ask_business_data` 的核心不是让模型直接写 SQL，而是把自然语言问题转成受语义层约束的 `BusinessQueryPlan`。

已确认决策：

> 确定性 planner 优先，LLM 只做 fallback plan drafter。SQL 永远由 platform 生成。

事实依据：

- Snowflake Cortex Analyst 基于 semantic model / semantic view 生成 SQL，歧义时返回 suggestions；其响应包含 `verified_query_used` 置信信息。
- Power BI Q&A 基于 semantic model 做术语识别、自动补全、未识别词提示和建议问题。
- ThoughtSpot Spotter 明确不是 direct text-to-SQL，而是转为受 governed semantic layer 约束的 search tokens。
- OpenAI Structured Outputs 可约束模型输出 JSON Schema，但只能保证结构形状，不保证业务计划正确，也不保证低延迟。

主路径：

```text
question
  ↓
normalize
  - 去噪、时间表达规整、业务词切分
  ↓
domain routing
  - 基于 _business_domains.yaml、connection、agent context 选择候选业务域
  ↓
entity retrieval
  - 基于 _index.yaml、entity display_name、description、keywords、synonyms 召回实体
  ↓
field / metric / dimension matching
  - 基于 attributes、enum_values、dict_ref、aggregatable、searchable、important 匹配字段
  ↓
intent classification
  - 明细 / 聚合 / TopN / 趋势 / 对比 / 过滤 / 关联查询 / 澄清
  ↓
verified query / question bank matching
  - 命中高置信 verified query 时复用其语义计划或模板
  ↓
plan construction
  - 规则/索引/metrics catalog 优先生成 BusinessQueryPlan
  ↓
LLM fallback
  - 仅低置信、复杂表达或歧义场景调用
  - 只生成 BusinessQueryPlan 草案，不生成 SQL
  ↓
plan validation
  - 实体、字段、关系、权限、tenant、deleted、聚合合法性检查
  ↓
SQL generation
  - 后端从受控 plan 生成 SQL
  ↓
SQL safety validation
  - 复用现有只读、ai_、tenant、deleted、跨连接等安全检查
```

`BusinessQueryPlan` 示例：

```json
{
  "intent": "aggregate",
  "domain": {
    "id": "risk_control",
    "label": "风险管控"
  },
  "entity": {
    "connection": "风险管控",
    "name": "RiskUnit",
    "viewName": "ai_sm_risk_unit",
    "label": "风险单元"
  },
  "metrics": [
    {
      "name": "risk_unit_count",
      "label": "风险单元数量",
      "aggregation": "count",
      "field": "id"
    }
  ],
  "dimensions": [
    {
      "field": "inherent_risk_level",
      "label": "固有风险等级",
      "enumSource": "enum_values"
    }
  ],
  "filters": [
    {
      "field": "deleted",
      "operator": "=",
      "value": 0,
      "source": "system_policy"
    }
  ],
  "displayPolicy": {
    "hideFields": ["id", "tenant_id", "deleted"],
    "translateEnums": true
  }
}
```

要求：

- `BusinessQueryPlan` 是内部结构，不进入普通用户最终回答。
- 计划中必须记录每个识别结论的依据，例如来自 `_index.yaml`、entity attribute、synonym、question_bank 或 verified query。
- 低置信或多意图冲突时返回澄清，不直接跑 SQL。
- LLM 草案必须经 platform 严格校验；字段不存在、指标不存在、权限不合法时 fail closed 或澄清。

### 8.8 业务领域结构设计

业务领域不是简单目录名，它用于缩小问数搜索空间、解释业务边界、减少跨域误匹配。

已有事实：

- `_business_domains.yaml` 已存在 `nodes`，包含 `id`、`display_name`、`description`、`parent_id`、`sort_order` 等。
- `_business_domains.yaml` 已存在 `leaf_entity_assoc`，把叶子业务域绑定到 `connection` 和 `entity`。

已确认决策：

> agent 不能绑定业务域作为问数前提。用户可以任意创建 agent，业务域必须由 platform 在语义匹配阶段快速识别。

改造要求：

- `ask_business_data` 基于用户问题、可用 connection、业务域树、实体索引、字段/指标索引做快速 domain routing。
- 不能依赖 agent.default_business_domain。
- domain routing 采用关键词 + 轻量语义索引召回，LLM 只做低置信 fallback。
- 命中业务域后，只优先检索该域及其 descendant 下关联实体。
- 如果用户问题跨域，必须显式构造跨域 plan，并校验 relationships / external_reference。
- 如果无法确定业务域，返回候选领域澄清，而不是全库盲查。
- domain routing 必须有性能预算，不能为了找领域做慢速全量 LLM 推理。

DomainIndex 建议索引内容：

- domain display_name；
- domain description；
- linked entity display_name；
- entity keywords；
- field display_name；
- metric display_name；
- synonyms。

索引存储已修正：

> 既然 domain routing 已确认采用“关键词 + 向量/embedding 召回”，就必须有向量索引/向量库保存预计算 embedding。不能只保存普通 JSON 文本索引。

存储分层：

```text
YAML 本体资产
  - 真理源
  - _business_domains.yaml
  - entity YAML
  - _metrics.yaml
  - synonyms / enum / dict_ref
  ↓
派生词法索引
  - BM25 / keyword / alias / fingerprint
  - 可保存为 .domain_lexical_index.json 等可重建文件
  ↓
向量库
  - 保存 domain/entity/field/metric/synonym 的 embedding vectors
  - 用于 semantic recall
  - 可由 YAML + embedding model 重新构建
```

事实依据：

- `cube-ai-project` 已有 Qdrant 向量基础设施，ADR-0005 明确“向量化是 capability，向量存储归 infra/vector-qdrant”，并且 `infra/vector-qdrant` 已实现 named dense/sparse vectors、collection bootstrap、upsert/query。
- `biz-ontology-platform` 当前主要事实源是 YAML，本次设计不能把向量库变成新的业务真理源；向量库只能是派生检索索引。
- 用户已指出：Qdrant 只是向量库的一种实现，不应直接成为问数业务层概念。

设计结论：

- 问数核心代码依赖 `SemanticVectorRepository` / `VectorStorePort`，不直接依赖 Qdrant client。
- 首个生产 adapter 使用 Qdrant 承载 embedding semantic recall；后续替换 Milvus、pgvector、Elasticsearch dense vector 等实现时，只新增 adapter，不改 domain routing / plan building / policy / presentation 主流程。
- 词法派生 JSON 只负责关键词、别名、fingerprint、索引构建状态等，不负责语义向量召回。
- 向量记录必须携带 `asset_type`、`connection`、`domain_id`、`entity`、`field`、`metric`、`source_path`、`content_hash`、`embedding_model`、`embedding_dim`、`schema_version` 等 payload。
- YAML 变更后，通过 `content_hash` 判断是否需要重算 embedding。
- 向量库不可用时，生产环境应 fail closed 或明确降级为 keyword-only 并打 warning；不能悄悄声称已做语义召回。

索引重建策略已确认：

> YAML 保存/import/reviewed policy/metrics 变更时，不同步阻塞重建向量索引。只标记 semantic index dirty，由后台 job 异步重建；失败必须可重试。

原因：

- embedding 调用是外部网络请求，不能阻塞 YAML 保存或管理端编辑体验。
- 向量库索引是派生索引，可由 YAML + embedding model 重建。
- `content_hash` 可用于判断哪些 asset 需要重算 embedding。
- 查询时必须感知 dirty 状态，不能悄悄使用过期索引并声称是最新语义召回。

建议流程：

```text
YAML save/import/reviewed policy/metrics change
  ↓
mark semantic_index_dirty(asset_id, content_hash)
  ↓
background job rebuild changed assets
  ↓
upsert vector repository points
  ↓
update semantic_index_manifest
```

失败重试要求：

- 记录失败 asset_id、content_hash、error_code、attempt_count、next_retry_at。
- 支持指数退避或固定间隔重试。
- 达到最大重试次数后保持 dirty/failed 状态，并在管理端/健康检查中暴露。
- 重试必须幂等；同一 asset + content_hash 重复执行不能产生重复有效 point。
- 重建成功后清理旧 content_hash 对应 points 或标记 inactive。

查询时行为：

```text
index fresh:
  keyword + vector semantic recall

index dirty and dirty_behavior=keyword_fallback:
  keyword-only recall + warning

index dirty and dirty_behavior=fail_closed:
  fail closed，返回业务化说明
```

已确认 dirty 行为：

> 索引 dirty/failed 时按配置决定；默认 keyword-only 降级，但高风险领域可配置 fail closed。

配置命名已确认：

```yaml
business_query:
  semantic_index:
    dirty_behavior:
      default: keyword_fallback
      domains:
        风险管控: fail_closed
```

要求：

- keyword-only 降级必须写入 warning / audit，不得声称使用了最新语义召回。
- fail closed 时给业务化说明，不暴露向量库/embedding 内部错误。
- 高风险领域是否 fail closed 由业务域配置确认，不由 LLM 自行判断。

已确认向量库抽象：

```text
SemanticVectorRepository / VectorStorePort
```

原因：

- Qdrant 只是当前可选的向量库实现，不应直接渗透到业务问数核心层。
- `cube-ai-project` 已有 `infra/vector-qdrant` 共享驱动和 Qdrant 测试基础设施，说明 Qdrant 作为首个 adapter 有工程依据。
- 问数语义索引是典型派生向量索引；YAML 仍是真理源，repository 只保存可重建的召回索引。

首个生产 adapter：

```text
qdrant
```

Repository 抽象边界：

```text
BusinessQueryService
  ↓
DomainRouter / SemanticIndexSearcher
  ↓
SemanticVectorRepository
  ├─ upsert_assets(points)
  ├─ search(query_vector, filters, top_k)
  ├─ delete_by_source(source_path/content_hash)
  ├─ health_check()
  └─ describe_index()
      ↓
      QdrantVectorRepository  # 首个 adapter
```

要求：

- `BusinessQueryService`、`DomainRouter`、`SemanticIndexBuilder` 只能依赖 `SemanticVectorRepository` 接口。
- Qdrant client、collection bootstrap、payload filter 语法、连接配置只能出现在 `QdrantVectorRepository` adapter 内。
- 配置中允许出现 `adapter: qdrant`，但不允许出现业务层直接读取 `qdrant.*` 后操作 client。
- 单元测试必须能用 `InMemorySemanticVectorRepository` 或 fake repository 覆盖 domain routing 逻辑，避免业务测试依赖真实向量库。
- 集成测试再验证 Qdrant adapter 的 collection schema、payload filter、upsert/search/delete/health。

已确认 embedding 配置：

> `biz-ontology-platform` 单独配置 embedding 模型与凭据，当前模型固定为 `qwen3.7-text-embedding`。

说明：

- 这是本次业务问数设计对 `biz-ontology-platform` 的独立配置决策。
- 它不同于 `cube-ai-project` 内部 ADR-0003 / ADR-0005 中“vendor 凭据收敛于 llm-core catalog”的边界；该 ADR 约束 `cube-ai-project` 内部能力包，不自动约束另一个独立仓库。
- 因为向量库 index/collection 的向量维度与 embedding 模型强相关，必须在配置和 vector payload 中记录模型代码、维度、版本/供应商。
- embedding 模型变更时，必须触发语义索引重建；不得混用不同维度/不同模型版本的向量。

阿里云百炼官方资料事实：

- `qwen3.7-text-embedding` 是通义实验室基于 Qwen3.7 训练的多语言文本统一向量模型。
- 支持 256~2560 维自定义向量维度。
- 同步接口模型概览列出的可选维度包括 2560、2048、1536、1024（默认）、768、512、256。
- 输入为字符串列表或文件时最多支持 20 条，每条最长 128,000 token。
- 支持 `output_type=dense/sparse/dense&sparse`，默认 `dense`。
- 支持可选 `instruct` 参数，用于指导模型理解查询意图。

来源：

- <https://help.aliyun.com/zh/model-studio/qwen3-7-text-embedding>
- <https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api/>

建议配置：

```yaml
business_query:
  semantic_index:
    enabled: false
    repository: memory
    dirty_behavior:
      default: keyword_fallback
      domains: {}
    qdrant:
      url: ${BUSINESS_QUERY_QDRANT_URL}
      api_key: ${BUSINESS_QUERY_QDRANT_API_KEY}
      collection: biz_ontology_semantic_index
      vector_name: text
      distance: cosine
      timeout_seconds: 5
      prefer_grpc: false
      create_collection_if_missing: true
    embedding:
      provider: qwen
      model: "qwen3.7-text-embedding"
      api_key: ${BIZ_ONTOLOGY_QWEN_EMBEDDING_API_KEY}
      base_url: ${BIZ_ONTOLOGY_QWEN_EMBEDDING_BASE_URL}
      batch_size: 20
      max_input_tokens:
      document_instruction: ''
      query_instruction: "Represent this query for retrieving business ontology domains, entities, fields and metrics."
```

设计要求：

- 当前实现可以固定 Qwen provider 和 `qwen3.7-text-embedding` 模型。
- 当前调用方式固定为阿里云百炼/DashScope 同步 embedding 接口。
- 不能把 Qwen 请求参数散落在业务索引构建代码中，必须通过 provider strategy / factory 隔离。
- 向量库 index/collection vector size 必须等于配置维度。
- 启动或重建索引时必须校验模型、维度、collection schema 是否一致。
- 维度、模型、output_type 变化时必须触发全量重建或新 collection 切换。
- document embedding 不加 instruct。
- query embedding 使用固定 instruct，用于把用户问题表示成“检索业务域、实体、字段、指标”的查询向量。
- instruct 效果必须通过 eval 验证；如果指标下降，应允许配置关闭。

当前实现事实：

- 已新增 `backend/services/business_query/semantic_index.py`。
- 已实现 `SemanticVectorRepository` 抽象、`InMemorySemanticVectorRepository`、`QdrantSemanticVectorRepository`、`QwenEmbeddingProvider`。
- Qdrant adapter 当前通过 HTTP REST 调用本地/远端 Qdrant，配置为 `url + api_key + collection + vector_name + distance + timeout_seconds`；业务服务不直接操作 Qdrant client。
- `ask_business_data` 已接入 `semantic_index.enabled=true` 时的向量候选召回；最终 SQL 计划仍由 YAML 本体和平台安全执行器生成，不允许向量结果绕过安全约束。
- 已新增 `GET /api/ai/business-query/semantic-index/status` 与 `POST /api/ai/business-query/semantic-index/rebuild`。
- `biz-ontology-platform/frontend/src/views/BusinessDomainPage.vue` 已接入上述两个 API：展示当前问数语义索引状态，支持刷新状态和重建索引；重建前会提示 embedding 调用与向量库写入成本/外部依赖。
- 已用无业务内容验证：
  - Qwen embedding 返回 1024 维 float 向量；
  - Qdrant HTTP adapter 可真实 `ensure_collection / upsert / search`。
- 尚未执行完整风险管控 ontology embedding 重建；原因是该动作会把业务本体文本发送到外部 embedding 服务，必须得到用户显式授权。

2026-08-14 当前实现事实补充：

- 已新增 `backend/services/business_query/sql_executor.py` 作为 platform 内部 SQL executor，保留只读校验、跨 connection 视图防呆、租户/软删除 AST 约束补强、语句超时、审计日志和错误脱敏。
- `ask_business_data()` 默认使用 platform executor；MCP adapter 不再把 `mcp.tools.query_database` 作为执行器注入。
- `mcp.tools.query_database` 已物理删除；旧低层 SQL 工具不再作为源码函数、MCP 注册项或 structured payload 分支存在。
- 旧安全能力保留在 `backend/services/business_query/sql_executor.py`：只读校验、跨 connection 视图防呆、租户/软删除 AST 约束补强、语句超时、审计日志、错误脱敏。
- 已新增 `backend/services/business_query/policy.py`：
  - `display_policy.hide_fields` 支持配置扩展；
  - 默认安全基线强制合并，配置只能加严，不能放松 `id/tenant/tenant_id/deleted/*_id/*_code`；
  - 枚举未命中策略支持 `raw_value / empty / label_with_code`，默认不编造。
- `config.yaml.template` 中 `llm_fallback.enabled` 已改为默认 `false`。事实依据：当前没有完整 LLM fallback prompt/schema、SQL AST 二次校验、eval gate 与人工确认链路；默认开启会形成假能力。
- 已新增 `backend/services/business_query/eval_runner.py`：
  - `validate_business_query_eval_set()` 验证用例数、类别、question、expected_signals、safety_assertions、人工 reviewed 状态；
  - `run_business_query_eval_gate()` 执行业务问数并验证普通用户可见输出不含 SQL/MCP URI/tool args/raw id/tenant/deleted；
  - diagnostics 不参与普通用户泄漏断言，避免把调试通道误算为用户展示通道。

2026-08-14 第八轮当前实现事实补充：

- 旧低层 SQL MCP 工具已完成源码级物理清理：
  - `mcp/tools.py` 不再定义 `query_database(...)`；
  - `mcp/tool_response.py` 不再存在 `query_database` 文本响应解析分支；
  - 安全边界测试改为覆盖 platform 内部 SQL executor，不再通过 MCP tools 暴露低层 SQL 能力。
- 已执行门阀：
  - `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider backend/tests -q`：通过，退出码 0；
  - `bun run typecheck`：通过；
  - `bun run test:run src/tests/api/businessQuery.test.ts`：1 file / 2 tests passed；
  - `bun run build`：通过，仅 Vite chunk size warning。
- 尚未完成真实跨仓库端到端对话验收。阻塞事实仍是 `apps/ai-center` 当前 `.env` 指向的 Redis/MySQL 不可达；基础设施可达后必须验证真实 agent 调用 `ask_business_data` 时页面只展示安全 progress/final answer，不出现 SQL/MCP URI/tool args/raw id/code。

Provider strategy / factory 建议：

```text
EmbeddingProviderFactory
  └─ create(config)
      └─ QwenTextEmbeddingProvider
          ├─ embedDocuments(texts, options)
          ├─ embedQuery(text, options)
          ├─ modelCode()
          ├─ dimension()
          └─ maxBatchSize()
```

后续扩展其它供应商/模型时，只新增 provider strategy，不改 domain routing、DomainIndexBuilder 和 vector repository payload 结构。

已确认：

- 使用阿里云百炼/DashScope 同步 embedding 接口。
- 不走 OpenAI 兼容接口作为本阶段默认路径。
- document embedding 不加 instruct；query embedding 使用固定 instruct，后续通过 eval 验证效果。

实现必须补齐：

- 具体 base_url / WorkspaceId 配置形态必须进入配置文件和 `.env.example`，不得写死在代码中。
- 重试、限流、超时必须配置化，并纳入错误日志与健康检查。

候选集合：

```text
biz_ontology_semantic_index
```

集合策略已确认：

> 首个 Qdrant adapter 使用全局一个集合 `biz_ontology_semantic_index`，通过 payload filter 做 environment / tenant / connection / domain / entity / asset_type 隔离。

原因：

- 本体语义索引是平台派生资产，不应因租户/连接过多创建大量 collection。
- 对 Qdrant adapter 来说，单集合 + payload filter 更利于统一 bootstrap、重建、迁移和查询。
- 如果未来某租户存在完全独立本体，也先通过 payload 隔离；只有出现明确性能或治理瓶颈时再考虑拆集合。

候选 point payload：

```json
{
  "environment": "dev",
  "tenant": "default",
  "asset_type": "field",
  "connection": "风险管控",
  "domain_id": "risk_control",
  "entity": "RiskUnit",
  "field": "inherent_risk_level",
  "label": "固有风险等级",
  "source_path": "ontology_backup/风险管控/RiskUnit.yaml",
  "content_hash": "sha256:...",
  "embedding_model": "text-embedding-vX",
  "embedding_dim": 1024,
  "schema_version": 1
}
```

识别流程：

```text
query
  ↓
keyword / BM25 recall
  ↓
embedding semantic recall
  ↓
merge topK domains/entities/metrics
  ↓
threshold / margin check
  ↓
top1 明确：继续构造 BusinessQueryPlan
top1/top2 接近：先澄清
低置信：LLM fallback 生成候选解释或澄清问题
```

LLM fallback 已确认：

- 允许 fallback，但每次业务问数最多调用一次。
- 单次超时默认 8 秒，必须可配置。
- fallback 只允许生成 `BusinessQueryPlan` 草案或澄清问题，不允许生成最终执行 SQL。
- fallback 草案必须经过 platform deterministic validator 校验；字段、指标、关系、权限不合法时不得执行。
- fallback 失败、超时或低置信时，返回澄清问题，不继续猜测。

#### 8.8.1 LLM fallback scene

已确认：

```yaml
business_query:
  llm_fallback:
    scene: business_query_plan
    timeout_ms: 8000
    max_attempts: 1
```

`scene=business_query_plan` 的含义：

- 这是 `biz-ontology-platform` 内部 LLM 调用用途标识，不是 MCP 协议字段，不暴露给 agent，也不暴露给最终用户。
- 它用于隔离问数 plan fallback 的 prompt、输出 schema、timeout、重试、审计和模型绑定。
- 它不是一个新模型；实际 provider/model 由 platform 的 LLM 路由配置解析。
- 当前阶段该 scene 只能输出 `BusinessQueryPlan` 草案或澄清问题，不能输出 SQL，不能输出最终用户答案。

事实依据与边界：

- Snowflake Cortex Analyst 官方文档说明其基于 semantic model / semantic view 生成 SQL；响应内容区分 `text`、`sql`、`suggestions`，歧义时返回 suggestions；Verified Query Repository 用已验证问题和 SQL 提升相似问题准确性和可信度。
- Snowflake Verified Query Suggestions 官方文档说明建议项不会自动应用，必须由人 Accept/Edit/Dismiss；这支持“AI 可建议，但不能绕过治理直接生效”的设计。
- Tableau Agent 官方文档说明其对数据源做 indexing，索引字段 caption、description、data roles、data types 和部分样例值；并说明 row/column-level security 会被遵守，且问数应围绕已连接数据源。
- Tableau Agent conversational analytics 文档说明其使用 semantic query path，对底层 semantic model 生成和运行 semantic query；遇到复杂或歧义问题时会澄清意图。
- ThoughtSpot Spotter Semantics 官方资料强调 governed semantic foundation、human-verified definitions、deterministic query generation、row/column-level security 和 approved business definitions。

采用解释：

- 成熟产品的事实共同点不是“都叫 scene”，而是“问数/NL2SQL 走专用的受治理语义查询链路”，并通过 semantic model、verified query、suggestion/clarification、human review、security policy 等机制约束输出。
- `business_query_plan` 是本系统对这类专用链路的工程化入口；它把普通聊天和问数 plan fallback 隔离开，避免复用普通 chat scene 导致提示词、超时、安全边界、输出格式混在一起。
- 该 scene 的输出仍不可信，必须经过 deterministic validator；这也是为了避免把 LLM 结构化输出误当成业务正确性。

来源：

- <https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/rest-api>
- <https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/verified-query-repository>
- <https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/verified-query-suggestions>
- <https://help.tableau.com/current/online/en-us/web_author_einstein.htm>
- <https://help.salesforce.com/s/articleView?id=analytics.tua_metric_questions.htm&language=en_US&type=5>
- <https://www.thoughtspot.com/product/spotter-semantics>

领域识别输出示例：

```json
{
  "domain_candidates": [
    {
      "id": "d_domain_2",
      "label": "巡检域",
      "score": 0.86,
      "evidence": ["命中词：巡检", "关联实体：InspectRecord"]
    }
  ],
  "selected_domain": "d_domain_2",
  "needs_clarification": false
}
```

### 8.9 语义层能力

必须建立或完善以下结构：

#### 8.9.1 业务实体

例：

- 风险单元
- 风险等级
- 责任人
- 组织/区域
- 检查记录
- 隐患
- 整改任务

每个实体至少需要：

- entity key：复用 `entity.name`；
- 业务名称：复用 `entity.display_name`；
- 描述：复用 `entity.description`；
- 查询对象：复用 `entity.data_source.view_name`；
- 主显示字段：优先从 `attributes[].important=true` 且非 id/code 字段推断；
- 可过滤字段：复用 `searchable`、enum、时间字段、重要字段；
- 可聚合字段：复用 `aggregatable`，并补充 count 类派生指标；
- 与其它实体关系：复用 `relationships`。

#### 8.9.2 指标

例：

- 风险单元数量；
- 各风险等级数量；
- 隐患数量；
- 整改完成率；
- 超期数量。

每个指标至少需要：

- metric key；
- 业务名称；
- 聚合方式；
- 口径说明；
- 默认过滤条件；
- 适用实体；
- 是否允许直接展示。

已确认决策：

> 新增 connection/domain 级 `_metrics.yaml`；简单指标可派生，复杂指标必须显式配置。

当前 YAML 对指标的支持不够完整，因此需要两层策略：

1. 派生指标：
   - entity count；
   - count distinct；
   - 对 `aggregatable=true` 的数值字段做 sum/avg/min/max 候选；
   - 对 enum 字段做分布统计候选。

2. 显式指标 catalog：
   - 对“整改完成率”“超期率”“风险得分”等有业务口径的指标，必须显式配置。
   - 不允许模型临时猜公式。

示例：

```yaml
metrics:
  - name: risk_unit_count
    display_name: 风险单元数量
    entity: RiskUnit
    type: derived
    aggregation: count
    field: id

  - name: rectification_completion_rate
    display_name: 整改完成率
    type: formula
    numerator:
      entity: RectificationTask
      filter:
        status: completed
      aggregation: count
    denominator:
      entity: RectificationTask
      aggregation: count
    unit: "%"
    business_rule: "已完成整改任务数 / 整改任务总数"
    review_state: reviewed
```

#### 8.9.3 维度

例：

- 时间；
- 区域；
- 单位；
- 风险类别；
- 风险等级；
- 状态。

每个维度至少需要：

- dimension key；
- label；
- 数据类型；
- 枚举映射；
- 同义词；
- 是否可展示；
- 是否可过滤；
- 是否可分组。

维度优先从以下字段派生：

- enum 字段；
- timestamp/date 字段；
- 组织/区域/责任人/状态等 searchable 字段；
- `important=true` 且适合分组的字段。

#### 8.9.4 枚举与字典

规则：

- 有 `*_text` / `*_name` 时优先使用可读字段。
- 有 `dict_ref` / `enum_values` 时按字典翻译。
- 没有映射时不得编造。
- raw code 可进入审计，不得进入普通用户最终展示。

#### 8.9.5 同义词

例：

- “固有风险等级” = “固有等级” = “风险等级” 的某个具体字段，是否等价必须由语义层定义。
- “隐患”与“风险”不能默认等价，除非有业务定义。

要求：

- 同义词必须可追踪来源。
- 自动挖掘同义词必须人工确认后生效。

#### 8.9.6 查询模板

常见问题形态应形成模板：

- 明细查询；
- 按维度统计；
- 排名 TopN；
- 趋势；
- 条件筛选；
- 对比；
- 异常/超期。

模板不是写死具体 SQL，而是定义可控查询计划。

### 8.10 question bank / verified queries / eval set

已确认决策：

> 拆分 `_question_bank.yaml` / `_verified_queries.yaml` / `_eval_set.yaml`，三者职责分离。

职责：

- `_question_bank.yaml`：候选问题、AI 生成问题、few-shot 素材，不代表强事实。
- `_verified_queries.yaml`：人工确认/验收过的高可信问题与语义计划，可用于高频命中、纠偏、回归参考。
- `_eval_set.yaml`：自动化验收和回归测试，不一定包含 SQL，可包含 expected intent、expected result rules、latency/safety gates。

### 8.11 verified queries

verified queries 必须作为增强和评估机制，而不是唯一问数能力。

来源：

- 人工维护的高频问题；
- 线上真实问题；
- 失败案例；
- 关键经营/安全指标；
- 业务验收样例。

每条至少包含：

```json
{
  "question": "按固有风险等级统计风险单元数量",
  "semanticIntent": {
    "entity": "risk_unit",
    "metric": "risk_unit_count",
    "dimensions": ["inherent_risk_level"]
  },
  "expectedColumns": ["固有风险等级", "数量"],
  "expectedAnswerRules": [
    "必须按等级分组",
    "必须过滤 deleted=0",
    "必须限定当前租户"
  ],
  "verifiedBy": "业务/开发确认人",
  "verifiedAt": "..."
}
```

SQL 可以作为审计/回归参考，但普通 agent 不应看到 SQL。

现有 `_question_bank.yaml` 可作为 verified query 的初始候选来源，但不能直接全部视为 verified。

原因：

- 抽样文件中存在 `confidence: 0.0`、`review_state: ai` 的问题样例。
- 这代表它们至少有一部分是 AI 生成/未人工确认资产。
- 如果把未审阅样例直接作为 verified query，会把错误 SQL 固化进系统。

升级规则：

- `review_state=reviewed` 或等价人工确认状态，才可作为 verified query。
- `review_state=ai` 只能作为 candidate / few-shot 候选，不能作为强约束。
- 每条 verified query 必须补充 expected intent、expected columns、expected answer rules。
- SQL 仍可保留在审计/回归用字段，但不得出现在普通用户回答。

已确认决策：

> `_verified_queries.yaml` 可以保存 SQL，但 SQL 必须是 audit_only，不能进入普通 agent prompt、MCP content、structuredContent.answer 或用户最终回答。

示例：

```yaml
verified_queries:
  - id: risk_level_count_001
    question: 按固有风险等级统计风险单元数量
    semantic_plan:
      intent: aggregate
      entity: RiskUnit
      metric: risk_unit_count
      dimensions: [inherent_risk_level]
    expected_columns:
      - 固有风险等级
      - 数量
    internal_sql:
      value: SELECT ...
      visibility: audit_only
    review_state: reviewed
```

### 8.12 SQL 生成与执行

原则：

- SQL 由后端基于语义层和查询计划生成。
- 模型不得直接自由生成最终执行 SQL。
- 生成后必须经过现有 SQL 安全检查。

新 executor 必须实现：

- 只读检查；
- tenant 约束；
- deleted 约束；
- ai_ 视图限制；
- 禁止跨连接视图；
- parser 失败 fail closed；
- metadata 缺失 fail closed；
- timeout；
- max rows；
- 审计日志。

### 8.13 display_policy

已确认决策：

> 默认隐藏技术 id/code；业务编号必须通过 `display_policy` 显式允许展示。`display_policy` 采用 connection/domain 默认 + entity override。

规则：

- 默认隐藏 `id`、`*_id`、`*_code`、`tenant`、`deleted`、join key；
- 有中文 display_name 不代表可以展示；
- 业务编号必须显式 `visible: true`；
- 必须有业务 label；
- 必须说明 reason。

示例：

```yaml
display_defaults:
  hide_patterns:
    - "^id$"
    - ".*_id$"
    - ".*_code$"
    - "^tenant(_id)?$"
    - "^deleted$"

entity_overrides:
  WorkOrder:
    display_policy:
      fields:
        work_order_code:
          visible: true
          reason: "业务工单编号"
        id:
          visible: false
          reason: "数据库主键"
```

### 8.14 结果语义投影

新增或增强模块：

```text
mcp/result_semantic_projection.py
```

职责：

- raw columns → business columns；
- raw rows → translated rows；
- code/id 过滤；
- enum 翻译；
- 字段 label；
- warning / suggestion 生成；
- display-safe table；
- model-safe summary。

输入：

```json
{
  "rawColumns": ["unit_id", "unit_name", "risk_level"],
  "rawRows": [
    {
      "unit_id": "123",
      "unit_name": "制冷机房",
      "risk_level": "3"
    }
  ],
  "semanticContext": {
    "fields": {
      "unit_name": { "label": "风险单元", "display": true },
      "risk_level": {
        "label": "固有风险等级",
        "enum": { "3": "较大风险" },
        "display": true
      },
      "unit_id": { "label": "风险单元ID", "display": false }
    }
  }
}
```

输出：

```json
{
  "answer": {
    "summary": "查询到 1 个风险单元。",
    "columns": [
      { "key": "unit_name", "label": "风险单元" },
      { "key": "risk_level", "label": "固有风险等级" }
    ],
    "rows": [
      {
        "unit_name": "制冷机房",
        "risk_level": "较大风险"
      }
    ],
    "rowCount": 1,
    "hasMore": false
  },
  "warnings": []
}
```

### 8.7 `_mcp_tool_response()` 改造

当前风险形态：

```py
content = [TextContent(type="text", text=str(result))]
structuredContent = structured_tool_payload(name, text)
```

目标形态：

```py
return CallToolResult(
    content=[TextContent(type="text", text=safe_summary)],
    structuredContent=safe_structured_content,
    _meta={
        "cube.ai/audit": audit_payload,
    },
    isError=is_error,
)
```

要求：

- `content` 不得包含 SQL。
- `content` 不得包含 raw rows。
- `content` 不得包含 connection。
- `content` 不得包含 tool args。
- `structuredContent.answer` 不得包含 raw id/code。
- `_meta` 不得被复制到 `content`。
- SDK 不支持 `_meta` 时，审计只进入服务端日志。

### 8.8 outputSchema

高层业务问数工具必须声明 `outputSchema`。

最低 schema：

```json
{
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "answered",
        "needs_clarification",
        "failed"
      ]
    },
    "answer": {
      "type": "object",
      "properties": {
        "summary": { "type": "string" },
        "columns": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["key", "label"],
            "properties": {
              "key": { "type": "string" },
              "label": { "type": "string" },
              "semanticType": { "type": "string" }
            }
          }
        },
        "rows": {
          "type": "array",
          "items": { "type": "object" }
        },
        "rowCount": { "type": "integer" },
        "hasMore": { "type": "boolean" }
      }
    },
    "clarification": { "type": "object" },
    "confidence": { "type": "object" },
    "warnings": { "type": "array" },
    "suggestions": { "type": "array" }
  }
}
```

状态枚举冻结：

- `answered`：已回答，`answer` 可用于普通用户展示；
- `needs_clarification`：需要澄清，`clarification` 必须有 `question/options`；
- `failed`：安全失败或无法回答，`answer` 只允许业务化失败说明。

禁止重新引入 `answered_with_warnings`、`not_answerable`、`error`、`success`、`clarify`、`no_answer` 等未登记状态；警告必须放在 `warnings[]`，错误细节只允许进入受控 diagnostics/audit。

### 8.9 性能观测

问数耗时约 1 分钟的现象必须拆分计量，不能笼统判断。

biz MCP 必须输出内部耗时：

- intent_parse_ms；
- semantic_match_ms；
- verified_query_match_ms；
- query_plan_ms；
- sql_generate_ms；
- sql_validate_ms；
- sql_execute_ms；
- result_projection_ms；
- total_ms。

这些字段进入 `_meta["cube.ai/audit"]` 或服务端日志，不进入用户回答。

---

## 9. cube-ai-project 改造方案

### 9.1 MCP 工具注册/可见性控制

必须区分：

- model-visible tools；
- app/UI-visible tools；
- internal/admin-only tools；
- audit-only metadata。

普通 agent 默认只暴露高层业务问数工具。

`query_database` 不再作为 MCP 工具存在，因此不存在 model-visible 配置。

实现建议：

- 在 MCP bridge 工具发现阶段读取工具 `_meta`、annotations 或本地 allowlist。
- 对历史 `mcp.biz-ontology.query_database` 引用做 fail-closed：发现配置或 descriptor 仍引用时启动/加载失败，并提示迁移到 `ask_business_data`。
- 对内置/自定义 agent 均生效。

示例配置：

```yaml
mcpToolVisibility:
  "mcp.biz-ontology.ask_business_data":
    modelVisible: true
    userVisibleResult: true
```

### 9.2 工具结果投影模块

新增：

```text
packages/agent/engine/src/bc/tools/tool-result-visibility.ts
```

职责：

- 识别 MCP `CallToolResult`；
- 校验 `structuredContent` 是否符合可接受形态；
- 只把安全业务结果提供给模型；
- 把审计字段剥离到内部日志/artifact；
- 对无 schema / 无结构化结果的工具执行保守降级。

输出类型：

```ts
export interface ProjectedToolResult {
  modelOutput: unknown;
  displayOutput?: unknown;
  auditSummary?: Record<string, unknown>;
  findings: Array<{
    code: string;
    severity: "info" | "warn" | "block";
    path?: string;
    message: string;
  }>;
}
```

投影规则：

1. 优先使用 `structuredContent.answer` / `structuredContent.summary` / `structuredContent.warnings`。
2. 不把 `_meta` 给模型。
3. 不把 raw `content` 原样给模型；只允许安全摘要。
4. 检测到 SQL/MCP URI/raw JSON 时，标记 finding。
5. 高风险 finding 时，不允许该内容进入模型。

### 9.2.1 应用对话前端可见性策略注册表

真实业务对话应用位于：

```text
/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app
```

普通用户可见的 tool card 不能复用开发者 debug 视角。该前端新增独立可见性层：

```text
/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app/src/views/assistant/assistant-tool-payload-visibility.ts
```

设计约束：

1. 共享 formatter 不写死工具名分支。
2. 特殊 MCP 工具展示差异通过 `ToolPayloadVisibilityPolicy` 注册。
3. 优先展示服务端返回的 `displayPayload` / `display_payload` / `safeDisplay` / `safe_display`，因为这是 MCP/platform 已完成投影后的安全展示结果。
4. 没有显式策略时，普通用户只看经过通用兜底脱敏后的信息；SQL、MCP URI、tool args、raw/internal key 必须隐藏。
5. 原始 payload 仅允许显式 debug 通道展示，例如：

```js
localStorage.setItem("ghcloud-ai-assistant-raw-tool-payload-debug", "1")
```

或构建期：

```bash
VITE_ASSISTANT_RAW_TOOL_PAYLOAD_DEBUG=1
```

该 debug 通道只用于开发/排障，不属于普通用户默认体验。

为什么不能只靠一个“共享可见性函数”写死规则：

- MCP 是通用协议，不同 server 的 output shape 不可能统一成同一套固定字段。
- 成熟 host 的做法是“协议契约 + host policy + 可见性投影 + 工具过滤/授权”，而不是把所有外部工具都交给一个正则函数猜。
- 对业务问数这种高风险工具，可以注册专门策略；对新 MCP 工具，优先要求工具返回安全 `structuredContent` / `displayPayload`，前端仅作为最后一层防线。

事实依据：

- MCP 2025-06-18 tools 规范规定工具可声明 `outputSchema`；server 必须让 `structuredContent` 符合 schema，client 应校验结构化结果；security 小节要求 server 清洗输出、client 在传给 LLM 前校验工具结果。
- OpenAI Apps/Plugins 文档将工具结果划分为 `structuredContent`、`content`、`_meta`：`structuredContent/content` 进入模型/组件，`_meta` 对模型隐藏；同时要求工具 handler 自己授权，不能依赖模型判断访问权限。
- OpenAI Agents SDK MCP 文档提供静态/动态 `tool_filter`，说明 host 可以按 agent/run 上下文控制实际暴露哪些 MCP 工具。
- 这些公开事实共同支持本设计：安全边界应由 server contract、host policy、client display policy 共同执行，提示词只是辅助。

### 9.3 MCP handler 切入点

建议在 `McpHandler.invoke()` 后立即投影。

原因：

- MCP handler 知道工具来源；
- 可以只影响 MCP 工具；
- 能在进入 ToolService / tachu 前消除 raw result。

改造前逻辑事实：

```ts
const raw = await bridge.callTool(...);
return raw;
```

改造后目标：

```ts
const raw = await bridge.callTool(...);
const projected = projectMcpToolResultForModel({
  serverId,
  toolName,
  rawResult: raw,
  rawArgs: args,
});
recordToolAudit(projected.auditSummary, projected.findings);
return projected.modelOutput;
```

### 9.4 MCP progress/status 标准接入

已确认：

> 如果 `ask_business_data` 需要 progress/status 事件，必须以标准方式接入 agent 编排流程，不能做成 `ask_business_data` 私有 hack。

外部事实依据：

- MCP 2025-06-18 schema 支持 request `params._meta.progressToken`。
- MCP `notifications/progress` 用 `progressToken` 关联原始请求，字段包括 `progress`、可选 `total`、可选 `message`。
- MCP 规范说明 receiver 不强制必须发送 progress notification；因此 host 侧必须支持“有则接、无则降级”。

本仓库代码事实：

- `EngineFactory.buildToolTaskExecutor()` 已把 Tachu `task.id` 转为 `toolCallId`，并调用 `ToolService.invoke(..., { toolCallId, onProgress })`。
- `ToolService.invoke()` 已把 `toolCallId/onProgress` 向 handler 透传。
- `McpHandler.invoke()` 已把 `toolCallId/onProgress` 透传给 `McpBridgeService.callTool()`。
- `McpSseSession.rpc()` / `McpHttpSession.rpc()` 构造 `tools/call` JSON-RPC payload 时已注入标准 `_meta.progressToken`。
- `McpSseSession.handleJsonRpcMessage()` / `McpHttpSession.handleJsonRpcMessage()` 已识别无 `id` 的 `notifications/progress`，并按 `progressToken` 分发给当前 active tool call。
- `EngineFactory.runStream()` 已新增本轮 progress queue，在工具执行 await 期间把 callback 转成 Tachu `type:"progress"` chunk。
- `tachu-sse-mapper.ts` 已把 `type:"progress"` chunk 映射为 SSE `tool.call.progress`。
- `packages/agent/sdk-client-assistant` 已消费 `tool-call-progress-v1`，更新 reasoning/tool timeline 状态；只读取安全 `display.text`，不把 MCP 原始 `message` 写入 assistant 正文。
- `McpHttpSession.postJsonRpc()` 已对 `text/event-stream` 响应使用 `ReadableStream.getReader()` 边读边解析 SSE block；收到 progress notification 立即分发 callback；收到本次 request id 对应的 result/error 后立即完成本次调用并取消 reader，不等待响应流关闭。
- 裸 JSON、非 SSE 文本响应仍走 `parseSseJsonRpcMessages(text)` 兼容路径。
- `dispatchProgressNotification()` 已按 active progressToken 分发；非当前 token 的 progress notification 被忽略，不会污染当前工具调用。
- 同一 active progressToken 下，numeric `progress` 小于上一次 numeric `progress` 的事件会被丢弃；相等和递增允许，兼容重复阶段上报。
- `withProgressHandler()` 在本次 tool call 完成/失败后清理 token 状态；同一 token 被下一次调用复用时不会继承上一次的 `lastProgress`。

采用方案：

1. 在 `cube-ai-project` 定义 agent 内部工具 progress sink。

```ts
export interface ToolProgressSinkEvent {
  toolCallId: string;
  toolName: string;
  status: string;
  progress?: number;
  message?: string;
}
```

2. `EngineFactory.buildToolTaskExecutor()` 在调用 `ToolService.invoke()` 时传入同一个 `toolCallId` 和 `onProgress`。

```text
Tachu task.id
  → toolCallId
  → ToolService.invoke(..., { toolCallId, onProgress })
  → McpHandler.invoke(..., options.onProgress)
  → McpBridge.toolsCall(..., { progressToken, onProgress })
```

3. `McpBridge.toolsCall()` 对支持 progress 的 MCP request 注入标准 `_meta.progressToken`。

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "tools/call",
  "params": {
    "name": "ask_business_data",
    "arguments": {
      "question": "本月风险事件趋势"
    },
    "_meta": {
      "progressToken": "turn:208...:tool:call_01"
    }
  }
}
```

4. `McpBridge` 新增 JSON-RPC notification 分发器。

```text
JSON-RPC response with id
  → pending[id].resolve/reject

JSON-RPC notification without id and method = notifications/progress
  → validate progressToken
  → find active tool call
  → emit ToolExecutionEvent(type=tool-progress)

unknown notification
  → debug log only
```

5. `McpBridge` 必须校验 progress 事件：

- `progressToken` 必须属于当前 active tool call；
- `progress` 必须单调递增；
- `message` 必须走安全映射，不能直接透传给普通用户；
- 高频事件必须限流，例如同一 toolCallId 最小间隔 500ms；
- 完成、失败、超时、取消后必须清理 token 映射；
- 不允许 progress message 携带 SQL、MCP URI、raw JSON、token、连接名等敏感信息进入 `safeDisplayMessage`。

6. `EngineFactory` 同级编排层收到 progress 后，转成 Tachu `type:"progress"` chunk，并复用 `tachu-sse-mapper` 发 `tool.call.progress` SSE。

实现依据与限制：

- 依据：当前 `TurnService.runLlmPhase()` 是通过 `for await (const chunk of this.tachuEngine.runStream(...))` 接收 chunk，再交给 `tachu-sse-mapper` 转 SSE；因此“通过流事件到前端”的方向成立。
- spike 事实：当前仓库没有可读的本地 `@tachu/core` 类型文件，不能确认上游 `StreamChunkPayload` 是否正式声明了 tool progress 类型。
- 2026-08-14 实现事实：本阶段没有修改 `@tachu/core`，而是在 `EngineFactory.runStream()` 内部以兼容 mapper 的 `type:"progress"` chunk 桥接；类型层面保持在本仓库边界内收敛。
- 结论：当前可用链路是 MCP progress → EngineFactory progress queue → Tachu progress chunk → SSE mapper；若后续 `@tachu/core` 正式提供 progress 类型，再迁移为正式类型。

SSE payload：

```json
{
  "schema": "tool-call-progress-v1",
  "turnId": "208...",
  "toolCallId": "call_01",
  "toolName": "mcp.biz-ontology.ask_business_data",
  "status": "querying",
  "display": {
    "text": "正在查询并整理结果"
  },
  "progress": 0.6,
  "time": 1786500000000
}
```

已确认字段结构：

- SSE 事件名固定为 `tool.call.progress`。
- payload schema 固定为 `tool-call-progress-v1`。
- 用户可见文案固定放在 `display.text`。
- 机器可读状态放在 `status`。
- `progress` 固定归一化为 `0..1`。
- MCP 原始 progress `message` 不能直接给普通前端；只能进入 debug/audit，或经过安全映射后进入 `display.text`。

可选 Tachu chunk 形态：

```ts
{
  type: "tool-progress",
  callId: "call_01",
  tool: "mcp.biz-ontology.ask_business_data",
  status: "sql_executing",
  progress: 0.6,
  message: "sql_executing",
  safeDisplayMessage: "正在查询并整理结果"
}
```

7. `tachu-sse-mapper` 把 progress chunk 转为标准 SSE。

建议新增：

```text
sseEvent: "tool.call.progress"
schema: "tool-call-progress-v1"
```

示例：

```json
{
  "schema": "tool-call-progress-v1",
  "turnId": "208...",
  "toolCallId": "call_01",
  "toolName": "mcp.biz-ontology.ask_business_data",
  "status": "querying",
  "display": {
    "text": "正在查询并整理结果"
  },
  "progress": 0.6,
  "time": 1786500000000
}
```

8. 应用对话前端/assistant SDK 默认不展示内部 `status`。

前端推荐规则：

```text
tool.call.progress.display.text 存在 → 展示 display.text
display.text 不存在且 elapsed < 5s → 展示“思考中”
display.text 不存在且 elapsed ≥ 5s → 展示“正在处理”
```

2026-08-14 实现事实：

- `packages/agent/sdk-client-assistant/src/types.ts` 已在 `ReasoningStep` / `ToolEvent` 中增加 progress 状态字段；
- `packages/agent/sdk-client-assistant/src/utils/reasoning.ts` 已把 `tool-call-progress-v1` 合并进对应 tool reasoning step；
- `packages/agent/sdk-client-assistant/src/store.ts` 已把 `tool-call-progress-v1` 写入 tool timeline；
- SDK 只使用 `display.text` 作为用户可见文案；原始 MCP `message` 不进入 assistant 正文。
- 真实应用对话 UI 位于 `/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app`；
- `src/views/assistant/assistant-thinking-mode.ts` 已在 compact / descriptive / feed / prose / steps thinking 纯函数中优先使用安全 `progressText`，并在前端二次拒绝 SQL / MCP URI / raw JSON 样式文案；
- `src/views/assistant/assistant-chat.tsx` 已把 steps 工具卡执行中状态从固定“执行中”升级为优先展示 `tool.progressText`；
- `src/views/assistant/assistant-tool-labels.ts` 已新增 `mcp.biz-ontology.ask_business_data → 业务问数` 精确中文映射。

9. `biz-ontology-platform` 的 `ask_business_data` MCP adapter 只发标准 MCP progress notification。

平台内部阶段：

```text
domain_routing
semantic_recall
plan_building
policy_validating
sql_executing
result_projecting
answer_composing
```

MCP adapter 对普通用户只映射为：

```text
domain_routing / semantic_recall / plan_building → 正在理解你的问题
policy_validating → 正在校验数据权限
sql_executing → 正在查询并整理结果
result_projecting / answer_composing → 正在整理结果
```

注意：

- `message` 可用于内部 debug，但只有 SSE payload 中的 `display.text` 才能进入普通用户事件。
- 当前实现路径是：标准 MCP progress 被 host 接收、校验、脱敏，经 `EngineFactory` progress queue 转为 progress chunk，再由 mapper 统一输出 SSE `tool.call.progress`。
- 如果 MCP server 不发送 progress notification，agent engine 已基于本地耗时产生兜底状态：默认 5s 后“正在处理”、15s 后“正在查询并整理结果”。配置项：`AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_ENABLED=0` 可关闭；`AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_INITIAL_MS` / `AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_EXTENDED_MS` 可调整阈值。
- 本地 elapsed-time fallback 只发送 agent engine 自生成的 `safeDisplayMessage`，不携带工具 input、SQL、rows、tool args、用户 query 或虚假百分比；一旦 MCP server 已发送标准 progress notification，agent engine 会立即清理本地 fallback timer，由 MCP progress 接管。
- Streamable HTTP 必须保持当前流式解析 `text/event-stream` 的实现；如果退回只等 `resp.text()`，progress 会在工具完成后才到达，失去意义。

#### 9.4.1 为什么不用工具最终结果携带 progress

不能把 progress 塞进 `structuredContent` 最终结果里。

原因：

- 最终结果只有工具结束后才可见，无法解决长等待期间用户无反馈的问题；
- progress 是执行态事件，不是业务答案；
- 如果混入最终结果，模型可能把阶段信息当成答案内容复述。

#### 9.4.2 为什么不用模型自己生成“正在查询”

不能依赖模型自己编造进度。

原因：

- 模型不知道工具真实执行到哪一步；
- 编造进度会造成虚假确定性；
- 不能用于性能诊断和超时定位。

#### 9.4.3 验收门阀

必须新增/保留测试。

已覆盖：

1. MCP request 注入 `_meta.progressToken`。
2. 收到 `notifications/progress` 后能分发给当前 tool call 的 `onProgress`。
3. progress chunk 能映射为 SSE `tool.call.progress`。
4. 无 `id` 的未知 notification 不影响 pending response。
5. `ToolService` 能把 `toolCallId/onProgress` 透传给 MCP bridge。
6. `EngineFactory` 能在工具执行期间产出 progress chunk。
7. assistant SDK 能消费 `tool-call-progress-v1`，写入 reasoning/tool timeline。
8. progress message 包含 SQL / MCP URI / raw JSON 时，不进入 `display.text`，也不写入 assistant 正文。
9. 应用对话 UI 能把安全 `progressText` 展示在 thinking 单行、feed、prose、steps 工具卡路径。
10. 应用对话 UI 对疑似 SQL / MCP URI 的 progress 文案做二次兜底拒绝。
11. `ask_business_data` 在应用对话 UI 中展示为“业务问数”，不退回英文工具名或泛化“调用工具”。
12. Streamable HTTP `text/event-stream` 响应能实时解析 progress，不能等 response 完成后一次性处理。
13. progressToken 不属于当前 active tool call 时丢弃。
14. progress 非单调递增时丢弃。
15. 工具完成/失败后 progressToken 状态清理；同 token 下一次调用可重新开始。
16. MCP server 不发 progress 时，`EngineFactory` 能在工具执行等待期间产生本地安全 progress chunk；该 chunk 不包含用户 query、工具参数、SQL、rows 或虚假百分比。
17. MCP progress notification 被忽略时已有 debug 级观测日志：无效 token、非当前 token、非单调 progress 均记录 reason/progressToken/progress/lastProgress，不记录原始 message、SQL、tool args 或 rows。

仍需覆盖：

1. 超时、取消场景下 progressToken 清理需要补独立回归测试。
2. 跨仓库真实端到端对话验证：调用 `ask_business_data` 期间页面实际出现“正在查询并整理结果”等安全状态，最终答案不含 SQL/MCP URI/tool args。

### 9.5 工具参数脱敏

必须覆盖：

- SSE 事件；
- tool event；
- debug log；
- persisted tool event；
- prompt/prefetch context；
- error details。

敏感字段：

```text
sql
connection
session_id
round_num
trace_id
tenant_id
token
api_key
authorization
password
```

SQL 正则：

```text
\bSELECT\b[\s\S]+\bFROM\b
\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bALTER\b
```

处理：

```json
{
  "sql": "[REDACTED_SQL]",
  "connection": "[REDACTED]",
  "purpose": "查询风险单元信息"
}
```

### 9.5 接地预取安全

当前 `renderPrefetchOutput()` 存在对象 stringify 风险。

改造：

- 接地预取结果必须走同一投影器。
- 不再把 raw tool result JSON.stringify 后注入模型上下文。
- 对高风险工具预取结果，只注入安全摘要或业务语义字段。

### 9.6 最终回答 guard

新增：

```text
packages/agent/engine/src/bc/session/final-answer-visibility-guard.ts
```

必须检测：

- `mcp://`
- 历史 `mcp.biz-ontology.query_database` 引用
- `"sql":`
- `SELECT ... FROM`
- fenced SQL block
- `connection=`
- `session_id`
- `round_num`
- 大段 JSON tool args
- raw internal field names

处理策略：

1. 对局部确定敏感内容执行替换。
2. 如果替换后答案仍不可读，触发安全重写。
3. 如果无法重写为可信业务结果，返回业务化失败说明或澄清问题。

业务用户可见失败说明：

```text
这次查询没有得到可安全展示的业务结果。你可以换一种更具体的问法，例如“按固有风险等级统计风险单元数量”。
```

开发者诊断信息进入日志，不进入普通用户回答：

```text
tool result missing safe structuredContent / outputSchema
```

### 9.7 流式输出安全缓冲

事实风险：

- 如果流式 token 已经发出 SQL，再做最终 guard 已经太晚。

要求：

- 本轮调用过敏感 MCP 工具时，最终回答启用安全缓冲。
- 缓冲期间前端可显示“正在整理查询结果”。
- guard 通过后再发送最终业务回答。
- 非敏感聊天仍可保持原流式体验。

### 9.8 自定义智能体覆盖

实现不得只改内置 descriptor。

必须覆盖：

- 内置智能体；
- 用户自定义智能体；
- 动态接入 MCP；
- descriptor 中显式配置工具；
- grounding prefetch；
- session recall 中可能回放的 tool event。

---

## 10. 用户体验设计

### 10.1 正常回答

用户：

```text
帮我查固有风险等级
```

可接受回答：

```text
查询到 5 个风险单元，其中较大风险 1 个、一般风险 4 个。

| 风险单元 | 固有风险等级 |
|---|---|
| 制冷机房 | 较大风险 |
| 配电室 | 一般风险 |
```

### 10.2 歧义回答

用户：

```text
风险等级怎么样？
```

可接受回答：

```text
这个问题有两种常见理解：查看风险等级明细，或按等级统计数量。你想看哪一种？
```

### 10.3 无法翻译

可接受回答：

```text
查询到了风险等级字段，但当前缺少可靠字典映射，因此只能确认原始值为 3，不能判断它对应的业务等级。
```

### 10.4 查询失败

可接受回答：

```text
这次没有得到可安全展示的查询结果。你可以补充查询对象、时间范围或统计口径后再试。
```

不可接受回答：

```text
Provider returned missing outputSchema.
```

不可接受回答：

```text
SELECT id, unit_name FROM ai_sm_risk_unit WHERE ...
```

---

## 11. 性能设计

### 11.1 当前问题

用户反馈：

- 当前问数基本约 1 分钟才有答案；
- 复杂问题更久；
- 答案经常不准确。

这是用户侧事实反馈，但具体瓶颈尚未量化。

### 11.2 必须打点

`cube-ai-project`：

- turn_total_ms；
- model_planning_ms；
- tool_call_count；
- mcp_call_total_ms；
- final_generation_ms；
- guard_ms；
- stream_buffer_ms。

`biz-ontology-platform`：

- intent_parse_ms；
- semantic_match_ms；
- verified_query_match_ms；
- query_plan_ms；
- sql_generate_ms；
- sql_validate_ms；
- sql_execute_ms；
- result_projection_ms；
- total_ms。

### 11.3 优化方向

必须实现：

- 高频问题命中 verified query / query template；
- 常用指标查询计划缓存；
- 语义匹配缓存；
- SQL 执行超时和慢查询日志；
- 大结果分页/摘要；
- 模糊问题先澄清，不跑大查询；
- 高层工具一次返回业务结果，减少 agent 多轮工具调用。
- Chat 场景复杂问数当前不做异步 taskId；用户在对话里等待最终答案。
- 后端必须产生阶段事件和耗时打点；普通用户前端只展示粗粒度状态，例如“思考中 / 正在查询 / 正在整理结果”。
- 详细阶段名、SQL、工具参数、内部错误只进入 debug/audit，不进入普通用户聊天气泡。

### 11.4 性能验收

由于当前没有基线日志，以下是目标门阀，实施前需先采集基线确认是否调整：

- 简单高频问数：p50 ≤ 8s，p95 ≤ 20s。
- 中等动态问数：p50 ≤ 15s，p95 ≤ 40s。
- 复杂问数：当前阶段同步等待，不转异步任务；等待期间用户侧必须有粗粒度进度反馈。
- 复杂问数必须有服务端硬超时保护，禁止无限等待或拖垮连接池。
- 单轮工具调用次数：简单问题不超过 2 次。
- verified query 命中问题：不得走多轮 SQL 反复试错。

已确认：

- Chat 场景不返回异步 taskId。
- 当前没有独立管理端承接异步结果，因此复杂任务也应同步等待最终答案。
- 不能告诉用户“进入异步任务了但当前拿不到结果”。

默认值已确认：

- Chat 总同步等待上限默认 60 秒。
- SQL executor 单条 SQL 执行上限默认 30 秒。
- 两者都必须可配置，不能写死。

配置命名已确认采用长路径：

```yaml
business_query:
  timeouts:
    chat_total_ms: 60000
    sql_statement_ms: 30000
    llm_plan_ms: 8000
```

进度提示建议：

```text
0-5s：展示“思考中”
5s：提示“正在理解你的问题”
15s：提示“正在查询并整理结果”
30s：提示“查询较复杂，仍在处理”
60s：硬超时，返回业务化失败说明，不泄露 SQL/内部错误
```

内部阶段事件建议：

```text
domain_routing
semantic_recall
plan_building
policy_validating
sql_executing
result_projecting
answer_composing
```

注意：

- 内部阶段事件用于 trace、SLA、性能定位和测试断言。
- 普通用户界面不需要也不应该展示完整内部阶段。
- 仅靠“思考中”可以降低 UI 复杂度，但不能替代后端阶段打点；否则无法定位“1 分钟等待”到底卡在语义召回、LLM fallback、SQL 执行还是最终组织答案。

---

## 12. 准确性设计

### 12.1 eval 集

必须建立业务问数 eval 集。

已确认：

> 首批 eval case 50 条，覆盖正常问数、指标聚合、tenant/deleted 基础数据边界、澄清和安全泄漏。完整权限/审计治理后置。

> 首批 eval 以“风险管控”业务域为主，补充少量跨域、歧义和安全泄漏 case。

当前资产审计事实：

- `biz-ontology-platform/ontology_backup` 不是完整业务资产来源；该目录当前未包含“风险管控”。
- 用户指出历史/完整定义配置位于 `/Users/ghy/test/bizont-kaihe/ontology`。
- 已核实 `/Users/ghy/test/bizont-kaihe/ontology/风险管控` 存在。
- 为避免运行调试直接依赖原始目录，当前已复制独立调试资产副本到 `/Users/ghy/work/biz-ontology-platform/ontology_workspaces/bizont-kaihe/ontology`。
- 风险管控资产统计：
  - 24 个实体 YAML。
  - 20 条 `_question_bank.yaml` 问题。
  - 23 条 entity `query_examples`。
  - 核心实体包括 `SmRiskUnit`（风险单元）、`SmRiskObject`（风险对象）、`SmRiskAssessmentRecord`（风险评估记录）、`SmRiskControlMeasure`（风险管控措施）、`SmRiskWarningRecord`（风险预警记录）等。

修正结论：

- 风险管控域存在；此前“当前本地 `ontology_backup` 未发现风险管控”的判断只说明搜索范围不完整，不能作为域不存在的证据。
- 首批 50 条 eval 应以仓库内独立调试副本 `/Users/ghy/work/biz-ontology-platform/ontology_workspaces/bizont-kaihe/ontology/风险管控` 作为运行时事实来源；原始 `/Users/ghy/test/bizont-kaihe/ontology/风险管控` 只作为复制来源。
- 实施前需要明确该完整资产目录如何同步或挂载到 `biz-ontology-platform` 运行环境，避免开发、测试、生产使用不同本体资产。
- 当前决策：不把完整本体资产直接复制进 `biz-ontology-platform/ontology` 覆盖平台自带 examples/索引；风险管控调试副本放在 `biz-ontology-platform/ontology_workspaces/bizont-kaihe/ontology`，但产品默认配置不自动绑定该目录。
- `business_query.ontology` 必须使用 root + domains 映射结构，不能只保留单个 `risk_control_path`；产品默认模板保持通用 fail-closed：

```yaml
business_query:
  ontology:
    root: ./ontology
    # domains 是可路由候选域清单；不允许配置全局固定默认域。
    domains: {}
```

- 风险管控本地调试必须通过独立样例或部署配置显式开启，例如 `config.business-query.bizont-kaihe.example.yaml`：

```yaml
business_query:
  ontology:
    root: ./ontology_workspaces/bizont-kaihe/ontology
    domains:
      risk_control:
        connection: 风险管控
        path: 风险管控
        description: 风险管控业务域
```

- 当前验证事实：默认配置下 `domains={}`，不绑定任何业务域；显式加载 `config.business-query.bizont-kaihe.example.yaml` 时，`risk_control` 只作为候选域 key，platform 在每次 `ask_business_data` 调用中按用户问题路由到 `connection=风险管控/path=风险管控`，并加载 24 个风险管控实体。
- 强制规则：不允许再引入 `business_query.ontology.default_domain` 或 `BIZ_BUSINESS_QUERY_DOMAIN` 这类固定业务域选择入口；风险管控只能作为本地验证/部署配置中的候选域，不能成为产品运行时隐式默认域。
- 强制规则：生产代码、产品默认模板和脚本不得写死 `风险管控`、`risk_control`、`bizont-kaihe`、`/Users/ghy/test`、`SmRisk*`；这些业务域/客户/调试资产名称只允许出现在部署配置、独立 example、测试、文档、本体资产中。

已确认分布方向：

```text
主体：风险管控业务域
补充：跨域识别 / 歧义澄清 / 安全泄漏防护
总数：50 条
```

已确认数量结构：

```text
20 条：风险管控正常业务问数
10 条：风险管控聚合 / 指标 / TopN / 趋势
8 条：tenant / deleted / display_policy / 安全边界
6 条：跨域或歧义 / 需要澄清
6 条：安全泄漏防护（SQL / MCP URI / raw id / raw code / 内部错误）
```

每条用例包含：

```yaml
- id: risk_normal_001
  domain: 风险管控
  category: normal
  question: "..."
  caller_context:
    tenant_id: "1"
    user_id: "..."
  expected:
    intent: "detail|aggregate|topn|trend|compare|clarify"
    domains: ["风险管控"]
    entities: []
    metrics: []
    dimensions: []
    filters: []
    presentation:
      required_fields: []
      forbidden_fields: []
      forbidden_patterns:
        - sql
        - mcp_uri
        - raw_id
        - raw_code
  fixture: null
  verified_by: "manual"
```

字段要求：

- `id` 必须稳定，作为回归测试、失败报告、人工复核的唯一标识。
- `domain` / `category` 用于统计不同业务域和问题类型的通过率，不能只看总分。
- `caller_context` 用于验证 tenant、用户权限、上下文映射和 access policy。
- `expected.intent/domains/entities/metrics/dimensions/filters` 用于验证语义解析和查询计划。
- `expected.presentation` 用于验证最终用户可见内容，不允许 SQL、MCP URI、raw id/code、内部错误泄漏。
- `fixture` 可为空；当用例需要结果值精确校验时必须绑定 fixture 或 verified query。
- `verified_by` 必须标记人工确认来源；AI 生成但未审核的 case 不得进入合入门阀。
```

eval 样例来源与确认流程已确认：

```text
现有 YAML / _question_bank.yaml / entity.query_examples
  ↓
抽取首批 50 条候选 eval
  ↓
标记 verified_by: pending_manual_review
  ↓
人工确认或修正问题、预期实体、指标、过滤条件、展示字段、禁止泄漏断言
  ↓
标记 verified_by: manual
  ↓
进入合入门阀
```

要求：

- 可以复用现有 `_question_bank.yaml` 和 entity `query_examples`，但它们只能作为候选来源。
- `review_state=ai`、`confidence=0.0` 或无人工确认记录的样例不得直接进入门阀。
- AI 可以辅助补齐 expected 字段，但必须保持 `pending_manual_review`，直到人工确认。
- 进入门阀的 case 必须具备可执行断言，不能只是自然语言描述。

### 12.2 准确率指标

不得只用模型自评。

至少包括：

- domain_match：业务域路由是否正确；
- intent_match：意图是否正确；
- entity_match：实体是否正确；
- metric_match：指标是否正确；
- dimension_match：维度是否正确；
- filter_match：过滤条件是否正确；
- non_business_query_rejection：非问数问题是否被正确拦截；
- result_match：结果是否和 fixture / verified query 一致；
- presentation_safety：展示是否安全；
- latency：耗时是否达标。

已确认合格门阀：

```text
安全泄漏类 = 100%
non_business_query_rejection = 100%
domain_match = 100%
intent_match ≥ 90%
entity_match ≥ 90%
metric_match ≥ 85%
dimension_match ≥ 85%
filter_match ≥ 85%
presentation_safety ≥ 95%
SQL/MCP URI/raw SQL 泄漏 = 0
raw id/code 非授权展示 = 0
```

说明：

- 不采用单一总分掩盖严重缺陷。
- 安全泄漏不得按 80%/90% 计分，必须 100%；完整权限/审计专项不纳入本轮。
- SQL/MCP URI/raw SQL 泄漏是 0 容忍。
- metric/dimension 首轮允许低于 intent/entity，但不得低于门阀。

### 12.3 失败沉淀

线上失败问题必须可沉淀为：

- 新同义词；
- 新枚举映射；
- 新指标；
- 新查询模板；
- 新 verified query；
- 新 eval case；
- 禁止回答规则。

---

## 13. 安全边界

### 13.1 普通用户禁止看到

默认禁止进入普通用户最终回答：

- SQL 原文；
- MCP URI；
- tool args JSON；
- connection；
- session_id；
- round_num；
- trace_id；
- tenant_id；
- deleted；
- raw id；
- raw `*_id`；
- raw `*_code`；
- join key；
- 数据库表名；
- 数据库列名；
- 栈信息；
- provider error 原文；
- API key / token / header。

### 13.2 允许展示的例外

以下情况可以展示类似 ID/编号：

- 该字段本身是业务用户可理解编号，例如“工单编号”“设备编号”；
- 语义层明确标记 `display: true`；
- 用户明确要求查看编号；
- 当前用户有权限；
- 字段 label 已翻译成人类可读名称。

### 13.3 管理员/开发者可见

管理员/开发者可以通过受控诊断查看：

- SQL 指纹；
- SQL 原文；
- raw columns；
- raw row sample；
- tool args；
- traceId；
- 执行计划；
- 耗时分解。

但这些不得混入普通聊天最终回答。

---

## 14. 测试计划

### 14.1 biz-ontology-platform 单元测试

必须新增/增强：

- `backend/tests/test_business_query_tool_schema.py`
- `backend/tests/test_query_result_semantic_projection.py`
- `backend/tests/test_mcp_display_payload.py`
- `backend/tests/test_mcp_tool_compat.py`
- `backend/tests/test_query_database_removed_from_mcp.py`
- `backend/tests/test_business_query_eval_cases.py`

必须覆盖：

1. 高层业务问数工具声明 `outputSchema`。
2. 正常查询返回 `status=answered`。
3. `content` 只包含安全摘要。
4. `structuredContent.answer.rows` 不含 raw id/code。
5. `_meta["cube.ai/audit"]` 可含 SQL 指纹。
6. `_meta` 不被复制到 `content`。
7. 有 `*_text` 时优先使用 text。
8. 有 enum mapping 时翻译。
9. 无 enum mapping 时不编造。
10. 歧义问题返回 `needs_clarification`。
11. SQL 校验失败返回安全错误，不泄漏 SQL。
12. 旧 SDK fallback 仍不返回 raw result。

### 14.2 cube-ai-project 单元测试

必须新增/增强：

- `packages/agent/engine/src/bc/tools/tool-result-visibility.test.ts`
- `packages/agent/engine/src/bc/tools/tool-argument-redaction.test.ts`
- `packages/agent/engine/src/bc/session/final-answer-visibility-guard.test.ts`
- `packages/agent/engine/src/bc/tools/handlers/mcp-handler.test.ts`
- `packages/agent/engine/src/bc/tachu/engine-factory.test.ts`
- `packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts`

必须覆盖：

1. MCP raw `content` 含 SQL 时，模型输出不含 SQL。
2. MCP `structuredContent.answer` 安全时，模型只收到 answer。
3. `_meta` 不进入模型输出。
4. `query_database` 不出现在 MCP tools/list。
5. 历史配置引用 `query_database` 时 fail closed，并提示迁移。
6. `argumentsPreview.sql` 被脱敏。
7. grounding prefetch 不 stringify raw object。
8. 最终回答含 `mcp://` 时被拦截。
9. 流式输出在敏感工具后进入安全缓冲。
10. 自定义 agent 也受工具可见性规则约束。

### 14.3 跨仓库集成测试

必须覆盖：

1. 复现原始泄漏场景。
2. 改造后同样问题最终回答不含 SQL/MCP URI/tool args。
3. 问“固有风险等级”返回业务字段和翻译值。
4. 问“按固有风险等级统计数量”返回聚合结果。
5. 问歧义问题返回澄清。
6. 缺失枚举映射时不编造。
7. 慢查询被记录耗时分解。
8. verified query 命中时结果稳定。

### 14.4 biz-ontology-platform 前端测试

必须新增/增强：

- `frontend/src/tests/views/EvalPage.test.ts`
- `frontend/src/tests/views/EvalReviewFlow.test.ts`
- `frontend/src/tests/views/BusinessDomainPage.test.ts`
- `frontend/src/tests/views/OntologyEditorPage.test.ts`
- `frontend/src/tests/views/WorkbenchPage.test.ts`
- `frontend/src/tests/api/businessQuery.test.ts`
- `frontend/src/tests/router/deprecatedRoutes.test.ts`
- `backend/tests/test_business_query_chat_service.py`

必须覆盖：

1. question bank 中 `review_state=ai` / `pending_manual_review` 不显示为已验证。
2. verified query 的 Accept/Edit/Dismiss 状态变更正确。
3. eval case 展示分类、人工确认状态、expected、fixture、安全断言。
4. eval 失败详情能展示泄漏类型，但不把 SQL/raw args 放到普通用户结果区。
5. business domain 页面能展示 semantic index fresh/dirty/failed 状态。
6. ontology editor 能编辑或展示 access policy、display policy、metric catalog、synonyms/enums。
7. workbench 调试问数走新 business query API，不出现旧 `query_database` / `resolve_business_query` 入口。
8. 普通用户视角下不展示任意 SQL 输入框、SQL 原文、MCP URI、tool args JSON。
9. 内部问数对话页先执行 platform `ask_business_data` 主链路，LLM 只消费安全投影；LLM 失败或输出命中内部细节 guard 时回退结构化摘要。

---

## 15. 合入门阀

### 15.1 通用门阀

不满足任一项，不允许合入：

- 普通用户最终回答中出现 SQL。
- 普通用户最终回答中出现 `mcp://`。
- 普通用户最终回答中出现 tool args JSON。
- 普通用户最终回答中出现未翻译 raw code。
- 普通用户最终回答中出现无业务含义 raw id。
- `query_database` 仍作为 MCP 工具存在。
- 高层业务问数工具没有 `outputSchema`。
- 缺失枚举映射时编造业务含义。
- 测试没有覆盖自定义智能体场景。
- 没有性能打点。
- 没有 eval case。
- 前端仍存在普通用户可触达的旧 SQL/MCP 问数入口。
- 前端把候选 question / AI 生成 question 显示成已验证。
- 前端没有展示 semantic index dirty/failed 或 eval 安全断言状态。

### 15.2 cube-ai-project 命令门阀

2026-08-17 本轮复验：

```bash
cd /Users/ghy/work/cube-ai-project
bun --cwd=packages/agent/engine run typecheck
bun test packages/agent/engine/src/bc/tools/tool-result-visibility.test.ts \
  packages/agent/engine/src/bc/session/final-answer-visibility-guard.test.ts \
  packages/agent/engine/src/bc/tachu/engine-factory.test.ts \
  packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts \
  packages/agent/engine/src/bc/tools/handlers/mcp-handler.test.ts \
  packages/agent/engine/src/bc/session/session.service.test.ts
```

结果：

- `@cube-ai/agent-engine` typecheck 通过。
- 关键测试通过：98 pass / 0 fail / 287 expect calls。

必须通过：

```bash
bun run typecheck
bun test
```

涉及 agent engine 的关键测试必须单独通过。

### 15.3 biz-ontology-platform 命令门阀

必须通过项目既有测试命令。

建议：

```bash
pytest
```

如果项目启用 ruff/mypy，也必须通过对应命令。

前端必须通过项目既有测试命令。`biz-ontology-platform/frontend/package.json` 当前已定义 `typecheck`、`test:run`，门阀命令为：

```bash
pnpm --dir frontend typecheck
pnpm --dir frontend build
pnpm --dir frontend test:run
```

2026-08-14 实施验证事实：

- `pnpm --dir frontend typecheck` 已通过。
- `pnpm --dir frontend build` 已通过。
- `pnpm --dir frontend test:run` 已通过；存在 Element Plus 组件/指令未 stub 的 Vue warning，但退出码为 0。
- 构建前发现 build mode 会把 `src/tests/**` 纳入应用构建类型检查，导致测试别名/测试导入问题阻断生产构建；已调整 app tsconfig 排除测试目录，测试仍由 vitest 门阀覆盖。
- MCP stdio/http 启动依赖必须来自 backend 运行环境；`backend/requirements.txt` 已补充 `mcp/sqlglot/jieba`，避免只安装 backend requirements 后 MCP 工具服务缺运行包。
- 本仓库存在本地 `mcp/` 目录，Python 会把它当作 namespace package；MCP stdio/http 入口导入官方 MCP SDK 时必须避免本地目录遮蔽，否则会出现 `mcp.server` 指向本仓库文件或找不到 SDK 的启动错误。

2026-08-17 本轮复验：

```bash
cd /Users/ghy/work/biz-ontology-platform
python3 -m pytest backend/tests/test_business_query_legacy_question_bank_disabled.py \
  backend/tests/test_business_query_service.py \
  backend/tests/test_business_query_semantic_index.py \
  backend/tests/test_business_query_eval_runner.py \
  backend/tests/test_business_query_mcp_contract.py \
  backend/tests/test_mcp_display_payload.py \
  backend/tests/test_mcp_tool_compat.py \
  backend/tests/test_query_database_tenant_rewrite.py
npm --prefix frontend run typecheck
npm --prefix frontend run test:run -- src/tests/api/businessDomain.test.ts src/tests/router/businessQueryRoutes.test.ts
npm --prefix frontend run test:run -- src/tests/router/businessQueryRoutes.test.ts
```

结果：

- 后端问数关键测试通过：43 passed / 0 failed。
- 前端 typecheck 通过。
- 前端 API/路由测试通过；单独路由测试 1 test passed。
- pytest cache warning 与 Vite/Vitest 沙箱 EPERM 属于当前执行环境写入限制；非沙箱真实测试退出码为 0。

### 15.4 ghcloud-new 应用对话前端命令门阀

必须验证真实业务对话 UI 的 thinking/tool card 安全展示，不只验证 cube SDK。

2026-08-17 本轮复验：

```bash
cd /Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app
bun test src/views/assistant/assistant-tool-payload-visibility.test.ts \
  src/views/assistant/assistant-tool-labels.test.ts \
  src/views/assistant/assistant-thinking-mode.test.ts
bun run build
```

结果：

- 相关测试通过：100 pass / 0 fail / 236 expect calls。
- 构建通过；存在既有资源路径、CSS 伪类、chunk size warning。
- 沙箱内构建因 Vite 写 `node_modules/.vite-temp` EPERM；非沙箱真实构建退出码为 0。

验证点：

- `ask_business_data` 展示为业务化工具名。
- 普通用户可见 tool card 不直接展示 tool args/output/error raw payload。
- tool payload 展示通过 policy registry 或服务端 `displayPayload` / `safeDisplay`，共享 formatter 不写死新增工具分支。
- raw payload 只能通过显式 debug 开关查看。

### 15.5 人工验收门阀

必须用以下人工问题验收：

```text
帮我查固有风险等级
按固有风险等级统计风险单元数量
风险等级怎么样？
查一下风险单元明细
证实方法有哪些？（非问数/知识库问题，用于确认不会误走问数）
```

每个回答必须检查：

- 是否答到业务问题；
- 是否没有 SQL；
- 是否没有 MCP URI；
- 是否没有 raw id/code；
- 是否有必要澄清；
- 是否没有编造枚举；
- 耗时是否记录。

---

## 16. 迁移策略

### 16.1 对现有智能体

- 扫描 descriptor 和自定义 agent 配置中使用 `mcp.biz-ontology.query_database` 的地方。
- 普通 agent 替换为高层业务问数工具。
- `query_database` 引用必须移除；不得以管理员/调试 agent 名义继续保留 MCP 暴露入口。

### 16.2 对现有前端

- 前端不承担主安全职责，但必须与后端安全语义一致。
- 前端可根据结构化业务结果渲染表格，但只能使用后端投影后的用户可见字段。
- 前端可显示业务化澄清问题。
- 前端不得显示开发诊断提示给普通用户。
- 前端必须移除或隐藏旧 `query_database` / `resolve_business_query` 普通入口。
- QuestionBank / Eval / BusinessDomain / OntologyEditor / Workbench 页面必须同步支持 candidate、verified、eval、policy、semantic index 等新状态。

### 16.3 对现有日志

- SQL 原文可以继续进入受控服务端日志。
- 日志必须注意脱敏和访问控制。
- 用户会话消息不得保存 SQL 泄漏内容。

### 16.4 对现有测试数据

- 如果历史数据存在 raw id/code，改造后应通过语义投影过滤。
- 不要求重建全部数据。
- 但 eval fixtures 需要覆盖这些历史形态。

---

## 17. 已确认项与待确认项

### 17.1 已确认项

- 新增 `ask_business_data` 作为普通 agent 唯一默认问数入口。
- `resolve_business_query` 本次重构物理清理，不保留兼容入口。
- `query_database` MCP tool 物理删除；SQL executor 完全重写为 platform 内部 service，旧实现只作为安全约束和测试参考。
- 问数核心能力归属 `biz-ontology-platform` 平台服务/领域服务层，MCP 只做薄 adapter。
- 现有 YAML / 本体资产必须复用，不能另起一套脱离 YAML 的语义层。
- `_question_bank.yaml` 可作为 verified query 候选来源，但不能把 `review_state=ai`、`confidence=0.0` 的样例直接视为 verified。
- platform 不固定读取某个 header；每个入口 adapter 通过 ContextMapper 映射成标准 CallerContext。
- AccessPolicy 采用 connection/domain 级 `_access_policy.yaml` + entity override。
- AccessPolicy 默认 fail closed；实体无 tenant/deleted 字段时必须显式声明 `not_applicable` 才允许不过滤。
- AI/系统可生成 `suggested_access_policy`，但运行时只认人工确认/明确配置后的 `access_policy`。
- AccessPolicy 合并优先级为 global default deny → connection policy → domain override → entity override。
- 默认隐藏技术 id/code；业务编号必须通过 `display_policy` 显式允许展示。
- `display_policy` 采用 connection/domain 默认 + entity override。
- 新增 connection/domain 级 `_metrics.yaml`；简单指标可派生，复杂指标必须显式配置。
- 拆分 `_question_bank.yaml` / `_verified_queries.yaml` / `_eval_set.yaml`。
- `_verified_queries.yaml` 可以保存 SQL，但 SQL 必须是 `audit_only`。
- 规则/索引/verified query/metrics catalog 优先生成 BusinessQueryPlan；LLM 只在低置信、复杂表达或歧义场景生成 plan 草案；SQL 永远由 platform 生成。
- LLM fallback 使用 platform 内部专用 scene：`business_query_plan`；该 scene 只生成 `BusinessQueryPlan` 草案或澄清问题，不生成 SQL，也不生成最终答案。
- Chat 场景复杂问数当前不做异步 taskId；复杂任务同步等待最终答案，但必须有进度反馈和服务端硬超时保护。
- 长耗时同步等待期间，后端必须有 progress/status 阶段事件和耗时打点；普通用户前端默认只展示粗粒度“思考中 / 正在查询 / 正在整理结果”，详细阶段只进入 debug/audit。
- progress/status 采用标准事件链路：MCP `notifications/progress` → `McpBridgeService` 按 progressToken 分发 callback → `EngineFactory` progress queue → progress chunk → SSE `tool.call.progress`；不能作为 `ask_business_data` 私有返回字段。
- MCP 工具调用时必须注入标准 `_meta.progressToken`；收到 progress notification 后必须按 `toolCallId` 关联、校验、限流、脱敏和清理。
- Chat 总同步等待默认 60 秒、单条 SQL 默认 30 秒，均必须可配置。
- agent 不绑定业务域；platform 必须在语义匹配阶段快速识别业务域，避免全局散查。
- 业务域快速识别采用关键词 + 轻量语义索引召回；LLM 只做低置信 fallback。
- 轻量语义索引通过 `SemanticVectorRepository` / `VectorStorePort` 保存 embedding；Qdrant 是首个生产 adapter，派生 JSON 只作为词法索引和构建状态，不承担向量召回。
- 配置命名采用当前模板事实路径：`business_query.semantic_index.repository`，可选值 `memory|qdrant`；Qdrant 细节归属 `business_query.semantic_index.qdrant`。不再同时引入 `vector_repository.adapter`，避免双路径配置。
- `biz-ontology-platform` 单独配置 embedding 模型与凭据，使用 Qwen 嵌入模型。
- embedding 模型固定 `qwen3.7-text-embedding`，默认维度 1024，调用方式使用阿里云百炼/DashScope 同步 embedding 接口。
- document embedding 不加 instruct；query embedding 使用固定 instruct，并通过 eval 验证是否保留。
- 首个 Qdrant adapter 使用全局一个集合 `biz_ontology_semantic_index`，通过 payload filter 做 environment / tenant / connection / domain / entity / asset_type 隔离。
- YAML 变更只标记 semantic index dirty，后台 job 异步重建向量索引；失败必须可重试，查询时必须感知 dirty/failed 状态。
- 索引 dirty/failed 时按配置决定；默认 keyword-only 降级，高风险领域可配置 fail closed。
- 首批 eval case 50 条，覆盖正常问数、指标聚合、tenant/deleted 基础数据边界、澄清和安全泄漏。
- eval 采用分指标门阀；安全泄漏 100%，SQL/MCP/raw 泄漏 0 容忍。完整权限/审计专项后置。
- 风险管控完整本体资产位于 `/Users/ghy/test/bizont-kaihe/ontology/风险管控`，首批风险管控 eval 应优先基于该目录抽取候选。

### 17.2 grill-me 使用状态

用户要求使用 `/grill-me` 做范围确认。当前仓库中 `.agents/skills/grill-me/SKILL.md` 已存在，并已按技能要求读取。

处理方式：

- 后续继续按 grill-me 方式逐问确认。
- 每轮只确认一个设计分支。
- 已确认项必须同步写回本文档。
- 未确认项不得写成既定实现。

### 17.3 已确认但实现必须遵守的细节

1. progress/status 事件字段：
   - 已确认承载链路：MCP `notifications/progress` → agent 内部 `ToolExecutionEvent(type=tool-progress)` → SSE `tool.call.progress`。
   - spike 已完成：当前仓库无法读取 `@tachu/core` 本地类型定义，不把本阶段实现绑定到修改上游 Tachu 类型；当前实现由 `EngineFactory` 同级编排层桥接为 `type:"progress"` chunk。
   - 已确认 SSE 事件名：`tool.call.progress`。
   - 已确认 payload schema：`tool-call-progress-v1`。
   - 2026-08-14 实现事实：`packages/contracts/src/sse/events.ts` 已新增 `ToolProgressEventSchema`，`packages/agent/engine/src/bc/session/tachu-sse-mapper.ts` 已支持把 Tachu `type:"progress"` chunk 映射为 `tool.call.progress`，`packages/agent/engine/src/bc/tools/{tool.service.ts,handlers/mcp-handler.ts,mcp-bridge.service.ts}` 已支持在 `tools/call` 注入 `_meta.progressToken` 并分发 `notifications/progress` callback，`packages/agent/engine/src/bc/tools/mcp-bridge.service.ts` 已对 Streamable HTTP `text/event-stream` 响应体做流式解析，`packages/agent/engine/src/bc/tachu/engine-factory.ts` 已在工具执行期间把 callback 转成 progress chunk，并在 MCP server 不发 progress 时提供本地 elapsed-time fallback（默认 5s/15s；`AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_ENABLED`、`AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_INITIAL_MS`、`AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_EXTENDED_MS` 可配置），`packages/agent/sdk-client-assistant` 已消费 `tool-call-progress-v1` 并更新 reasoning/tool timeline，`/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app` 已把安全 `progressText` 接入真实应用对话 thinking UI。
   - 已确认用户可见文案字段：`display.text`。
   - 已确认机器可读状态字段：`status`。

2. LLM fallback 的模型选择：
   - 已确认：允许 fallback，但最多一次。
   - 已确认：单次 plan 草案生成默认超时 8 秒，必须可配置。
   - 已确认：只生成 BusinessQueryPlan 草案或澄清问题，不生成最终 SQL。
   - 已确认：失败、超时或低置信后返回澄清，不继续猜测。
   - 已确认：使用 platform 内部专用 scene：`business_query_plan`。
   - 说明：该 scene 是用途配置入口；实际 provider/model 由 platform LLM 路由配置解析，不作为问数业务流程硬编码。

### 17.4 待确认项

以下问题没有确认前，不得把对应内容写死为已确认业务事实；但可以实现候选生成、人工确认、评测运行和门阀报告流程。

1. 首批 eval 50 条样例：
   - 已确认覆盖方向：以风险管控业务域为主，覆盖正常问数、指标聚合、tenant/deleted 基础数据边界、澄清和安全泄漏，并补充少量跨域 case。完整权限/审计治理后置。
   - 已确认数量结构：20 条风险管控正常业务问数；10 条风险管控聚合/指标/TopN/趋势；8 条 tenant/deleted/display_policy/安全边界；6 条跨域或歧义/需要澄清；6 条安全泄漏防护。
   - 已确认 eval case 字段结构：`id/domain/category/question/caller_context/expected/fixture/verified_by`。
   - 已确认来源流程：从现有 YAML、`_question_bank.yaml`、entity `query_examples` 抽取候选，先标记 `pending_manual_review`，人工确认后才可进入合入门阀。
   - 待补充：具体问题文本、期望指标、期望过滤条件、期望展示字段、禁止泄漏断言。该项通过实现后的候选生成与人工 review 闭环完成，不阻塞框架与页面落地。

---

## 18. 风险、成本与偏差提醒

### 18.1 风险

- 过早隐藏字段可能导致模型缺少回答事实。
- 语义层不完整时，动态问数覆盖面会受限。
- verified query 质量差会反向降低准确性。
- 枚举映射缺失会导致大量“无法翻译”提示。
- 安全缓冲会牺牲部分流式体验。
- 两仓库联动改造，测试成本高。

### 18.2 成本

- 需要维护语义层元数据。
- 需要沉淀 eval 集。
- 需要建立慢查询和错误闭环。
- 需要给管理员/开发者提供受控诊断入口。
- 需要更新现有 agent descriptor 和自定义工具接入规则。

### 18.3 容易忽略的偏差

- 只用少量成功 demo 判断准确性，会高估系统能力。
- 只测高频问题，会低估歧义问题风险。
- 只测内置 agent，会漏掉自定义 agent。
- 只测最终完整响应，会漏掉流式中途泄漏。
- 只测正常结果，会漏掉错误栈/provider error 泄漏。
- 把 SQL 执行慢误判为模型慢，会导致优化方向错误。

---

## 19. 实施检查清单

实现前：

- [ ] 阅读本文档。
- [ ] 逐条审计本文所有“必须实现 / 新增 / 删除 / 改造 / 门阀”，确认均能追溯到第 4.3 / 4.4 节的技术依据。
- [ ] 对无法追溯依据的条目，先改成“待调研 / 待确认 / 实现候选方案”，不得直接实现。
- [ ] 确认第 17 节待确认项不会被实现为“已确认业务事实”；eval 具体样例通过候选生成与人工 review 闭环确认。
- [ ] 确认两个仓库当前分支和未提交改动。
- [ ] 补充/确认第一批 eval case。

实现中：

- [ ] 新增实现项时，同步补充对应技术依据；否则不允许写入“必须实现”。
- [ ] 先改 biz 高层问数工具和安全返回。
- [ ] 再改 cube MCP host 可见性和投影。
- [ ] 再改最终回答 guard。
- [ ] 每次改动同步更新本文档。

实现后：

- [x] 跑 biz 后端关键测试。
- [x] 跑 biz frontend `pnpm run typecheck`。
- [x] 跑 biz frontend `pnpm run build`。
- [x] 跑 biz frontend `pnpm run test:run`。
- [x] 跑 cube `bun run typecheck`。
- [x] 跑 cube progress 链路关键测试。
- [x] 跑应用对话前端关键测试与 `bun run build`。
- [ ] 跑跨仓库复现场景。
- [ ] 人工验收第 15.4 节问题。
- [ ] 检查最终回答泄漏门阀。
- [ ] 检查性能打点。

2026-08-14 启动探针事实：

- `biz-ontology-platform` MCP stdio 入口可构造 `Server`。
- `biz-ontology-platform` MCP HTTP 入口可构造 `Starlette`。
- `biz-ontology-platform` FastAPI 入口可构造 `FastAPI`，当前路由数 15。
- `apps/ai-center` 在当前 `.env` 下无法完成真实启动：`REDIS_URL` 指向 `192.168.0.243:6379` 且连接被拒绝；临时设置 `AGENTIC_ENGINE_NODE_ID=0` 跳过 SFID Redis lease 后，又因 `AGENTIC_ENGINE_MYSQL_URL` 指向 `192.168.0.243:3306` 且连接被拒绝而停在 domain migrations。
- 结论：当前未完成真实端到端对话验收，阻塞条件是 `.env` 指向的 Redis/MySQL 不可达。基础设施可达后，必须继续执行真实 agent 对话：调用 `ask_business_data`，确认 progress/status 展示安全文案，最终答案不含 SQL/MCP URI/tool args/raw id/code。

---

## 20. 最终设计判断

这个改造不是“让模型别说 SQL”，而是把问数系统从低层工具调用升级为受治理的业务问数链路。

成熟产品给出的事实方向是：

- 使用语义层约束动态问数；
- 使用 verified queries/evals 提升准确性和防回归；
- 使用 host 侧通道隔离控制模型可见内容；
- 使用业务化展示，不把底层 SQL 和 raw fields 直接给最终用户。

因此本系统的正确边界是：

- `biz-ontology-platform` 负责业务语义、SQL 安全、结果投影、问数评估。
- `cube-ai-project` 负责工具可见性、模型上下文投影、最终回答 guard、自定义 agent 全覆盖。
- prompt 只负责表达风格和辅助约束，不承担安全职责。

只要其中任一层缺失，SQL/MCP URI/raw data 泄漏问题都会复发。
