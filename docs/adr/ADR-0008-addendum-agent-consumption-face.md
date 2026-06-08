# ADR-0008 Addendum: Agent 消费面路由 — `/v1/*` 为 canonical

- **Status**: Accepted
- **Date**: 2026-06-06
- **Parent**: [ADR-0008 — 前端消费 seam](./ADR-0008-frontend-consumption-seam.md)
- **Tags**: frontend, sdk, routing, agent-engine

## Context

ADR-0008 路由表将 agent（chat）消费面写作 `/engine/*`（sessions / turns(SSE) / …）。  
`agent-engine` 在 cube-agentic-engine 时期已对外暴露 **`/v1/*`**（sessions、turns、SSE events、files、grants、tools、jobs），`@cube-ai/agent-sdk-client*` 全族硬编码该前缀。  
`apps/ai-console` 的 vue-router 使用 **`/agent`** 作为 **UI 领域路由**（页面导航），并非 HTTP API 命名空间。

若强行把 SDK 与 engine 迁到 `/engine/*`，会破坏现有 wire 契约与已拷贝 SDK 测试矩阵，且与 OpenAI 兼容 `/v1/*` LLM 网关路径族混在同一 `/v1` 根下已由 ADR-0003 约定。

## Decision

1. **Agent 消费面 HTTP canonical = engine `/v1/*`**  
   - SDK（`@cube-ai/agent-sdk-client` 及 `-vue` / `-assistant` / `-mock`）继续以 `baseUrl + /v1/...` 为唯一消费面。  
   - ai-center 单进程内 agent-engine SessionModule 等控制器保持 `/v1/*`，**不**加 `/engine` 或 `/agent` HTTP 前缀。

2. **`/agent` 仅 UI 路由**  
   - `apps/ai-console` 的 `/agent` 路由页只负责挂载 Assistant UI（`provideAssistant` + SDK）。  
   - 页面内 SDK 仍直连同一 origin 的 `/v1/*`；**禁止**把 `/agent` 当作 API pathPrefix。

3. **ADR-0008 路由表勘误**  
   - 表内「agent（chat）| `/engine/*`」在实现层等价于 **「agent-engine `/v1/*`（非 LLM 网关段）」**。  
   - LLM OpenAI 兼容网关仍为 `/v1/chat/completions`、`/v1/embeddings`（llm-core provider BC，ADR-0003）。

## Consequences

- **Positive**：零 SDK breaking change；ai-console 领域 UI 路由与 HTTP seam 解耦；与 engine 集成测试 / mock engine 路径一致。  
- **Negative**：ADR-0008 原文 `/engine/*` 与实现 `/v1/*` 字面不一致，需本 addendum 作权威勘误。  
- **Neutral**：Ingress 仍可按 `/v1/*` 对 agent 消费面限流；未来若需 `/engine` alias，应作为可选网关 rewrite，而非 SDK 默认。

## Verification

- `agent-sdk-client*` 请求路径仍为 `/v1/sessions` 等（grep + 单测）。  
- `ai-console` `/agent` 页使用 `createAgenticClient({ baseUrl })` 无 `/agent` pathPrefix。  
- ai-console 核心流测试：`provideAssistant` → 建 session → SSE 收到 `turn-completed-v1`（mock engine）。
