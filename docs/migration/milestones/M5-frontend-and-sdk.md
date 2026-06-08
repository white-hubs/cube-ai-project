# M5 — 前端 & SDK 家族

> 渐进式披露：先读 [`../README.md`](../README.md) §4。事实地基：[`../inventory/agent-engine.md`](../inventory/agent-engine.md)（§2/§8 SDK 现状与重命名）、[`../inventory/ghcloud.md`](../inventory/ghcloud.md)（§7 gateway façade、§10 深相对 import）。权威：ADR-0008（前端 seam、gateway façade 退役、SDK 命名）。

**Goal**：建立 SDK 家族（`<domain>-sdk-<face>`），搭新前端工程，以**单 origin、领域路由**消费 ai-center 三域（agent/flow/kb）+ llm 管理面，退役 ghcloud gateway façade 与深相对 import。

**Architecture**：SDK 只走 HTTP/SSE、只依赖 `contracts`（不 import 后端包）；前端按 `/agent /flow /kb /llm` 领域路由直连 ai-center 单 origin。

**依赖**：M2（agent 域）、M3（kb 域）、M4（flow 域）。 **被依赖**：M6（cutover）。

## Entry 准则
- M2/M3/M4 Exit 全绿（三域后端经 ai-center 单进程可用）。

## Exit 准则
- SDK 家族 typecheck + 测试绿；新前端能在单 origin 下跑通三域核心流（会话/SSE、flow 管理与运行、kb 文档与检索、llm catalog 管理）。
- gateway façade（`@ghcloud/cube-ai-application-service`）在新前端不被引用；深相对 import 清零。

---

## Task M5.T1 — SDK 重命名

> 来源：`inventory/agent-engine.md §2/§8`。

**Files**: Create `packages/agent-sdk-client/`、`agent-sdk-client-vue/`、`agent-sdk-client-assistant/`、`agent-sdk-client-mock/`（从 engine `agentic-sdk-*` copy）

**Steps**
- [ ] copy `agentic-sdk-core`→`agent-sdk-client`、`-vue`→`agent-sdk-client-vue`、`-assistant`→`agent-sdk-client-assistant`、`-mock`→`agent-sdk-client-mock`。
- [ ] import 从 `@cube-ai/agentic-contracts`→`@cube-ai/contracts`；保持「只走 HTTP/SSE、不 import 后端包」。

**验收**：4 个 SDK typecheck + 自带测试绿（sdk-* 共 ~2930 测试 LOC）。

## Task M5.T2 — flow/kb/llm SDK

> 来源：`inventory/ghcloud.md §7`（façade 1:1 控制器 → 拆领域 SDK）。

**Files**: Create `packages/flow-sdk-client/`、`flow-sdk-console/`、`kb-sdk-client/`、`kb-sdk-console/`、`llm-sdk-console/`

**Steps**
- [ ] 按 flow-core/kb-core/llm-core 的对外 HTTP 面，定义各 SDK 的 client（运行面）与 console（管理面）。client 仅依赖 contracts wire schema。
- [ ] llm 仅有 console（catalog 管理），无独立 client（调用经 agent/flow 内部）。

**验收**：各 SDK typecheck 绿；针对各域一条最小请求（mock server）跑通。

## Task M5.T3 — 新前端工程脚手架

**Files**: Create `apps/ai-console/`（或既定前端工程名；单 origin、领域路由）

**Steps**
- [ ] Bun + 前端框架（沿用 Vue，配合 agent-sdk-client-vue），HTML import 范式（参照 CLAUDE.md）。
- [ ] 路由 `/agent /flow /kb /llm`；统一鉴权头注入（host 身份，M6 联调）。

**验收**：前端起得来；空壳路由可达。

## Task M5.T4 — 前端接 agent 域

**Steps**
- [ ] 用 `agent-sdk-client(-vue)` 接会话/SSE/工具/推理树（复用 engine SDK 的 AssistantStore/reasoning-tree）。

**验收**：前端可建会话、发消息、看 SSE 流式与工具调用。

## Task M5.T5 — 前端接 flow/kb/llm 管理面

> 替代 ghcloud 前端三模块（flow-editor/model-management/knowledge-*）。

**Steps**
- [ ] flow：列表/编辑/运行/监控（经 flow-sdk）。kb：文档目录/上传/分段/检索测试（经 kb-sdk）。llm：catalog provider/model 管理（经 llm-sdk-console）。
- [ ] 替代 `inventory/ghcloud.md §10` 中前端深 import 的 knowledge 文档来源（改走 kb-sdk）。

**验收**：三域管理面核心流在新前端跑通（对接 ai-center 单进程）。

## Task M5.T6 — 退役 gateway façade + 消除深相对 import

> 来源：`inventory/ghcloud.md §7/§10`、ADR-0008。

**Steps**
- [ ] 新前端不引用 `@ghcloud/cube-ai-application-service`（façade）与 `GatewayProxy`。
- [ ] 不携带 `../../../../knowledge-document/service` 等深相对 import（改 kb-sdk）。
- [ ] grep 新前端无深相对 import、无 façade 引用。

**验收**：grep=0；前端经单 origin 领域路由访问。

## Task M5.T7 — typecheck/测试 + entry/exit

**Steps**
- [ ] SDK + 前端 typecheck/测试绿。
- [ ] 勾选 `PROGRESS.md` M5；写会话日志；指针移 M6。

---

## 本里程碑风险
- **SDK 必须零后端依赖**（ADR-0008）：只依赖 contracts，否则前端把后端拖进 bundle。
- **agent SDK 的 assistant 应用域**（`agent-sdk-client-assistant`）是 engine 自带的会话前端能力，**与 cube-ai 玩具 assistant 无关**（别混淆）。
- 前端鉴权头与 host 身份（M6）联调：M5 可先用开发态身份，M6 切 host。

## 决策记录
- （T3）前端工程名与框架细节：`apps/ai-console`（Bun HTML import + Vue 3 + vue-router；`bun run --filter @cube-ai/ai-console dev`）
