# ADR-0006: Tool/MCP 是 engine 编排域，非第四能力包；Tool Handler 为可复制薄适配，运行时各自装配

- **Status**: Accepted
- **Date**: 2026-06-05
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: tool, mcp, engine, boundary, credentials, scope

## Context

`CONTEXT.md` 早期把 `tool/MCP` 与 LLM/flow/kb/embedding 并列为「AI 基础能力」，但 ADR-0002 的能力包清单里没有 tool/mcp 包。`/grill-with-docs` rubber-duck 指出这是潜在「无主地带」：engine 管「tool 编排」、llm-core 管「tool-call」，边界未定。

代码证据（cube-agentic-engine）：`engine/src/bc/tools` 已是成熟限界上下文 —— `tool.service`（注册/执行）+ 闭集 `HANDLER_KINDS`（http/shell/sql/vector/memory/openapi/mcp/llm/flow/flowList/knowledge/clock/qwenImage）+ 每个 `handlers/*-handler.ts` + `mcp-bridge.service`（MCP stdio JSON-RPC 连接池 + consent）+ descriptor（在 contracts）+ grant/consent/shell-blacklist 安全。各 handler 本就是「tool-call → 能力」的薄适配：`flow-handler`→FlowInvokerPort、`knowledge-handler`→KnowledgeQueryPort、`llm-handler`→LlmProviderPort 等。

## Decision

**Tool/MCP 不是与 flow/kb 同级的可移植能力包；它是 engine 的 tool 编排域。**

1. **Tool 编排归 engine**：注册 / descriptor / 派发 / consent / grant / 安全，是 agent 运行时核心，服务 engine 本身，**不抽共享能力包**（不建 `@cube-ai/tools`）。
2. **Tool Handler = 薄适配模式**：handler 把 tool 调用适配到某能力 port，依赖 contracts port、**不复制能力实现**。这是一种**可复制的模式而非共享代码**。
3. **运行时各自装配**：tool 编排不在运行时间共享。engine 有自己的；**未来若去掉 Langflow、flow 需要工具时，flow 自建同构的 handler 薄适配**，绝不依赖 engine 的 tool bc。flow 当前用到的工具在 LF 侧实现，非本轮关注。
4. **tool-call vs tool 编排 边界**：`LlmProviderPort` 只产出/解析 wire 层 `tool_call`（OpenAI function-calling 格式）；查 descriptor、派发、consent、执行、回灌属 engine **Tool 编排**。无无主地带。
5. **MCP 桥接归 engine**：连接外部 MCP server（stdio/sse/http）与 registry/consent 紧耦合，留在 engine tool bc。**MCP server 凭据（env/headers）是 Tool 凭据，归 engine grant/安全，与 ADR-0003 的 LLM 凭据边界是两类、不混。**
6. **flow 自带 MCP 随 flow-core 收编、不并入 engine tool bc**（cube-ai 服务拆分后新增事实，**经源码勘察订正**）：

   > **事实订正**：早前版本称「flow 作 MCP server 对外暴露 flows，是 flow 的第 3 个面」。对 `cube-ai/server/flow` 的源码勘察（grep `McpServer`/`setRequestHandler`/`registerTool` 全仓 = 0）证明 **flow 并不暴露 MCP server**。其 `mcp/` 实为两个方向，**都是 MCP 客户端/同步行为，无服务端**。详见 [`../migration/inventory/flow.md §6/§16`](../migration/inventory/flow.md)。

   cube-ai flow 的 `mcp/` 是**两个方向**——(a) **flow 作 MCP 客户端探测外部 MCP server**（`mcp-tools.controller` 的 `/mcp/tools-list` + `mcp-list-tools-sdk`，经 StreamableHTTP/SSE 拉取外部 MCP 的工具列表，用于设计器选填）；(b) **flow 把外部 MCP 配置同步注入 Langflow**（`lf-mcp-server-sync` 推送前把 `MCPTools` 节点幂等 `POST /api/v2/mcp/servers` 注册进 LF；`lf-mcp-tool-options-enrich` 填实时工具列表）。二者皆 **flow 自用**，随 flow 整套迁入 `flow-core`（ADR-0004/0012），与 engine 的 tool/descriptor **各自装配**（印证「运行时各自装配」）。

   因此 **flow 对外只有两个面**：`FlowInvokerPort`（被 engine 编排）+ 直达 SSE（前端）——**不含 MCP server 面**。**engine↔flow 不经 MCP 回环**：engine 进程内调 flow **只走 `FlowInvokerPort`**；engine 自己的 mcp-bridge 连外部 MCP 是 engine-domain。两边共用的仅 MCP SDK（协议传输），不抽共享包。cube-ai `assistant`（玩具）的 tools 不迁（ADR-0012 D1）。

## Consequences

- **Positive**：杜绝误抽 `@cube-ai/tools` 共享包或让 flow 反向依赖 engine tool bc；tool→能力 经 port，依赖方向与 ADR-0002 一致；tool 凭据与 LLM 凭据各归其主，安全边界清晰。
- **Negative**：未来 flow 自建工具装配会与 engine 的 handler 有「模式重复」（非代码复用）——这是刻意取舍，换取运行时解耦。
- **Neutral**：`CONTEXT.md` 中「AI 基础能力」列举的 tool/MCP 应理解为「engine 在 turn 内提供的能力」，而非可被上层独立调用的可移植 port 能力。

## Options Considered

- **Tool/MCP 升为独立能力包 `@cube-ai/tools`（与 flow/kb 同级）**：表面对称，但 tool 编排与 agent 运行时（session/turn/consent/grant）强耦合，抽出会制造 engine↔tools 双向牵连，且无第二个消费者。否。
- **现在就建 `ToolInvokerPort` 把工具执行暴露给外部消费者**：为「外部直接调平台工具」预留，但当前工具只由 LLM 在 turn 内触发，无此需求；过早升格徒增表面。记为 **open question**，有真实外部调用需求时再定。否（本轮）。
- **engine 与 flow 共享一个 tool 装配层**：省去模式重复，但把两个运行时绑死、违反「运行时各自装配」。否。

## Open Questions

- 是否最终需要 `ToolInvokerPort`（把平台注册工具暴露给外部消费者）——待出现真实「turn 外直接调工具」需求再裁定。
