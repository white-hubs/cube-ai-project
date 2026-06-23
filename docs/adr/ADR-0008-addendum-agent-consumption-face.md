# ADR-0008 Addendum: 四域两轴路由规整 —— 域×面前缀方案（取代 `/v1/*` canonical 决议）

- **Status**: Accepted
- **Date**: 2026-06-17
- **Parent**: [ADR-0008 — 前端消费 seam](./ADR-0008-frontend-consumption-seam.md)
- **Tags**: frontend, sdk, routing, agent-engine, domain-routing

## Context

本 addendum 旧版（2026-06-06）将 agent 消费面 canonical 定为 engine `/v1/*`，并声明 `/agent` 仅为前端验证沙箱的 UI 路由、禁止作 API pathPrefix。该决议在两个方面已与代码事实和命名空间一致性要求产生偏离：

1. **路径实现漂移**：ai-center 代码实际以裸路径注册控制器（`/sessions`、`/jobs` 等），并由装配期 helper 统一施加域前缀；旧决议所称「保持 `/v1/*`」既非实现路径，也与 LLM OpenAI 兼容网关（ADR-0003）共享同一 `/v1` 根造成歧义。
2. **跨域命名空间一致性**：flow、kb、llm 管理面已分别挂载 `/flow/console/*`、`/kb/console/*`、`/llm/console/*`；agent 单独保持 `/v1/*` 破坏了四域一致的命名空间格局。

旧版 addendum 的「`/v1/*` canonical」与「`/agent` 仅 UI」两项决议均已作废；本 addendum 以**四域两轴前缀规整**（下称「两轴方案」）替代，成为新的权威记录。

## Decision

### 1. 两轴路由：域×面

所有 HTTP 路径按**领域（domain）× 面（plane）** 两个维度组织：

- **消费面（client plane）**：`/{domain}/{resource}`
- **管理面（console plane）**：`/{domain}/console/{resource}`

四个领域前缀：`/agent`、`/flow`、`/kb`、`/llm`。

典型路径示例：

| 领域 | 消费面（client） | 管理面（console） |
|---|---|---|
| agent | `/agent/sessions` `/agent/jobs` `/agent/grants` `/agent/files` `/agent/mcp/descriptor` | `/agent/console/agents` `/agent/console/skills` `/agent/console/rules` |
| flow | `/flow/run` `/flow/webhook` `/flow/files` | `/flow/console/flows` `/flow/console/studio` `/flow/console/components` `/flow/console/mcp` `/flow/console/execution` `/flow/console/custom-component-templates` |
| kb | `/kb/search` | `/kb/console/documents` `/kb/console/directories` |
| llm | `/llm/providers` | `/llm/console/*`（providers / models CRUD / 远程同步 / 连通测试） |

### 2. `/v1/*` LLM OpenAI 兼容网关豁免（ADR-0003 不变）

`/v1/chat/completions`、`/v1/embeddings` 等 OpenAI 兼容路径**维持顶层 `/v1/*`**，不加域前缀。这是 ADR-0003 确立的 LLM 网关面，与本两轴方案正交，不受影响。

### 3. 装配期前缀挂载机制

ai-center 装配期（`src/routes/`）使用 helper 函数重写各 BC 控制器的 `@Controller` 基址，统一施加域+面前缀。**旧的 `domain-path-rewrite` 中间件已删除**，`ctx.path` 即真实外部路径，日志天然携带域信息，无需中间件剥前缀再还原。

各能力包控制器以裸路径注册内部路由，由 ai-center 装配层统一决定外部挂载点。

### 4. SDK 侧对齐

- **console SDK 默认 pathPrefix**：各 `<domain>-sdk-console` 的默认基路径加 `/console` 段，与管理面路径对齐。
- **agent 消费 SDK baseUrl**：`@cube-ai/agent-sdk-client*` 的 `baseUrl` 从原 `/api`（或裸 origin）改为 `/api/agent`（即 `{origin}/agent`），消费面路径 `/agent/sessions` 等。
- `ai-sdk-playground` 可在 composable 面板验证 `provideAssistant`；agent 消费 SDK `baseUrl` 为 `/api/agent`（即 `{origin}/agent`），消费面路径 `/agent/sessions` 等。

### 5. 本 addendum 取代旧版的范围

本 addendum 明确取代旧版（2026-06-06）的以下两项决议：

- ~~Agent 消费面 HTTP canonical = engine `/v1/*`~~  
- ~~`/agent` 仅 UI 路由，禁止作 API pathPrefix~~

上述内容**全部失效**，以本文「两轴方案」为准。

## Consequences

- **Positive**：四域命名空间一致，消费/管理面在路径层自描述；`domain-path-rewrite` 中间件删除后链路更短，`ctx.path` 即外部路径，日志/监控无歧义；SDK pathPrefix 与外部路径 1:1 对应，前端集成更直观；Ingress 可按 `/{domain}/*` 精确限流/灰度，按 `/{domain}/console/*` 收紧管理面权限。
- **Negative**：SDK 消费基路径变更为 `/agent`（原 `/v1`），前端及集成方需同步更新 `baseUrl` 配置；旧 `/v1/*` agent 路径引用（文档、脚本、集成测试）须全面排查。
- **Neutral**：LLM 网关 `/v1/*` 豁免不变；各能力包控制器注册路径本身不变，仅 ai-center 装配层挂载点变化。

## Verification

- `domain-routes.test.ts`：覆盖四域消费面与管理面路由冒烟（`/agent/sessions`、`/agent/console/agents`、`/flow/run`、`/flow/console/flows`、`/kb/search`、`/kb/console/documents`、`/llm/providers`、`/llm/console/*`）。
- `agent-sdk-client*` 请求基路径为 `/agent/...`（grep + 单测）。
- `ai-sdk-playground` composable runner 中 `provideAssistant` 的 `baseUrl` 不再含 `/v1`。
- LLM 网关端点 `/v1/chat/completions` 仍可达（ADR-0003 豁免不变）。
